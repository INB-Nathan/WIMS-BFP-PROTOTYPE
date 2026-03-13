import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface ConflictDetectionRequest {
    incident_id: number;
}

// Error Response Helper
function errorResponse(
    status: number,
    code: string,
    message: string,
    details?: any,
) {
    return new Response(
        JSON.stringify({ status: "ERROR", error_code: code, message, details }),
        { status, headers: { "Content-Type": "application/json" } },
    );
}

// Helper to decode base64url (JWT payload)
function base64UrlDecode(input: string): string {
    const padded = input.padEnd(Math.ceil(input.length / 4) * 4, "=");
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return atob(base64);
}

export async function handler(req: Request): Promise<Response> {
    try {
        // 1. Init Supabase Admin Client
        const supabaseAdmin = createClient(
            Deno.env.get("SUPABASE_URL") ?? "",
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
            {
                db: { schema: "wims" },
            },
        );

        // 2. Auth Check (Manual JWT Decode)
        const authHeader = req.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return errorResponse(
                401,
                "MISSING_AUTH",
                "Missing or invalid Authorization header",
            );
        }

        const token = authHeader.substring("Bearer ".length).trim();
        const parts = token.split(".");
        if (parts.length !== 3) {
            return errorResponse(401, "INVALID_TOKEN", "Malformed JWT");
        }

        let payload: { sub?: string };
        try {
            const payloadJson = base64UrlDecode(parts[1]);
            payload = JSON.parse(payloadJson);
        } catch (_e) {
            return errorResponse(
                401,
                "INVALID_TOKEN",
                "Unable to decode JWT payload",
            );
        }

        const userId = payload.sub;
        if (!userId) {
            return errorResponse(
                401,
                "INVALID_TOKEN",
                "JWT is missing subject (user id)",
            );
        }

        // 3. User Role Check
        const { data: userProfile, error: profileError } = await supabaseAdmin
            .from("users")
            .select("role, assigned_region_id")
            .eq("user_id", userId)
            .single();

        if (profileError || !userProfile) {
            return errorResponse(
                403,
                "PROFILE_NOT_FOUND",
                "User profile not found.",
                profileError,
            );
        }

        const userRole = userProfile.role;
        const userRegion = userProfile.assigned_region_id;

        if (!["VALIDATOR", "ADMIN", "SYSTEM_ADMIN"].includes(userRole)) {
            return errorResponse(
                403,
                "FORBIDDEN",
                "Only VALIDATORS or ADMINS can run conflict detection.",
            );
        }

        // 4. Parse Body
        let payloadBody: ConflictDetectionRequest;
        try {
            const rawBody = await req.text();
            payloadBody = JSON.parse(rawBody);
        } catch {
            return errorResponse(400, "INVALID_JSON", "Invalid JSON body");
        }
        const targetIncidentId = payloadBody.incident_id;

        if (!targetIncidentId) {
            return errorResponse(400, "MISSING_FIELD", "incident_id is required");
        }

        // 5. Fetch Target Incident Details
        const { data: targetInc, error: incError } = await supabaseAdmin
            .from("fire_incidents")
            .select(`
        incident_id, region_id, verification_status,
        incident_nonsensitive_details!inner (
          notification_dt, city_id, barangay, city:ref_cities(city_name)
        )
      `)
            .eq("incident_id", targetIncidentId)
            .single();

        if (incError || !targetInc) {
            return errorResponse(
                404,
                "INCIDENT_NOT_FOUND",
                "Target incident not found.",
            );
        }

        // Validator Region Check
        if (userRole === "VALIDATOR" && targetInc.region_id !== userRegion) {
            return errorResponse(
                403,
                "REGION_MISMATCH",
                "Cannot check incidents outside your assigned region.",
            );
        }

        // Handle potential array or object for 1:1 relationship
        const details = targetInc.incident_nonsensitive_details;
        const detailsObj = Array.isArray(details) ? details[0] : details;

        if (!detailsObj || !detailsObj.notification_dt) {
            return errorResponse(
                400,
                "INVALID_DATA",
                "Incident lacks notification date or details for comparison.",
            );
        }

        const targetDate = new Date(detailsObj.notification_dt);
        const timeWindowHours = 2;
        const minDate = new Date(
            targetDate.getTime() - timeWindowHours * 60 * 60 * 1000,
        );
        const maxDate = new Date(
            targetDate.getTime() + timeWindowHours * 60 * 60 * 1000,
        );

        // 6. Search for Duplicates
        const { data: duplicates, error: dupError } = await supabaseAdmin
            .from("fire_incidents")
            .select(`
        incident_id, verification_status,
        incident_nonsensitive_details!inner (
          notification_dt, city_id, barangay, city:ref_cities(city_name)
        )
      `)
            .eq("region_id", targetInc.region_id)
            .neq("incident_id", targetIncidentId)
            .gte(
                "incident_nonsensitive_details.notification_dt",
                minDate.toISOString(),
            )
            .lte(
                "incident_nonsensitive_details.notification_dt",
                maxDate.toISOString(),
            )
            .eq("incident_nonsensitive_details.city_id", detailsObj.city_id)
            .limit(20);

        if (dupError) {
            return errorResponse(
                500,
                "SEARCH_FAILED",
                "Failed to search duplicates",
                dupError,
            );
        }

        const potentialDuplicates: any[] = [];
        if (duplicates) {
            for (const potential of duplicates) {
                const potDetailsRaw = potential.incident_nonsensitive_details;
                const potDetails = Array.isArray(potDetailsRaw)
                    ? potDetailsRaw[0]
                    : potDetailsRaw;

                // Loose barangay match
                if (
                    potDetails.barangay &&
                    detailsObj.barangay &&
                    potDetails.barangay
                        .toLowerCase()
                        .includes(detailsObj.barangay.toLowerCase().substring(0, 5))
                ) {
                    const cityField = (potDetails as any).city;
                    const cityName = Array.isArray(cityField)
                        ? cityField[0]?.city_name ?? "Unknown"
                        : cityField?.city_name ?? "Unknown";

                    potentialDuplicates.push({
                        incident_id: potential.incident_id,
                        notification_dt: potDetails.notification_dt,
                        city_name: cityName,
                        barangay: potDetails.barangay,
                        status: potential.verification_status,
                    });

                    // Optional: Flag in History
                    await supabaseAdmin
                        .from("incident_verification_history")
                        .insert({
                            incident_id: targetIncidentId,
                            action_by_user_id: userId,
                            previous_status: targetInc.verification_status,
                            new_status: targetInc.verification_status,
                            comments: `Potential duplicate flagged: Incident #${potential.incident_id} (${potDetails.barangay})`,
                        });
                }
            }
        }

        // 7. Audit Log
        const { error: auditError } = await supabaseAdmin
            .from("system_audit_trails")
            .insert({
                user_id: userId,
                action_type: "RUN_CONFLICT_DETECTION",
                table_affected: "fire_incidents",
                record_id: targetIncidentId,
                ip_address: req.headers.get("x-forwarded-for") || "unknown",
                user_agent: req.headers.get("user-agent") || "unknown",
            });

        if (auditError) console.error("Audit log error", auditError);

        // 8. Return Result
        return new Response(
            JSON.stringify({
                status: "OK",
                incident_id: targetIncidentId,
                potential_duplicates: potentialDuplicates,
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
        );
    } catch (err: any) {
        return errorResponse(
            500,
            "INTERNAL_ERROR",
            "Internal server error",
            err?.message ?? String(err),
        );
    }
}

if (import.meta.main) {
    serve(handler);
}

