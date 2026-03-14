import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface CommitIncidentRequest {
    incident_id: number;
    decision: "VERIFY" | "REJECT" | "MERGE";
    comments?: string;
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
                "Only VALIDATORS or ADMINS can commit incidents.",
            );
        }

        // 4. Parse Body
        let payloadBody: CommitIncidentRequest;
        try {
            const rawBody = await req.text();
            payloadBody = JSON.parse(rawBody);
        } catch {
            return errorResponse(400, "INVALID_JSON", "Invalid JSON body");
        }

        if (!payloadBody.incident_id || !payloadBody.decision) {
            return errorResponse(
                400,
                "MISSING_FIELDS",
                "incident_id and decision are required.",
            );
        }

        // 5. Fetch Target Incident
        const { data: targetInc, error: incError } = await supabaseAdmin
            .from("fire_incidents")
            .select("incident_id, region_id, verification_status")
            .eq("incident_id", payloadBody.incident_id)
            .single();

        if (incError || !targetInc) {
            return errorResponse(404, "INCIDENT_NOT_FOUND", "Incident not found.");
        }

        // 6. Enforce Region Access (Validators)
        if (userRole === "VALIDATOR" && targetInc.region_id !== userRegion) {
            return errorResponse(
                403,
                "REGION_MISMATCH",
                "Cannot verify incidents outside your assigned region.",
            );
        }

        // 7. Determine New Status
        let newStatus: string;
        if (payloadBody.decision === "VERIFY") {
            newStatus = "VERIFIED";
        } else if (payloadBody.decision === "REJECT") {
            newStatus = "REJECTED";
        } else if (payloadBody.decision === "MERGE") {
            newStatus = "VERIFIED"; // See assumptions in logic
        } else {
            return errorResponse(
                400,
                "INVALID_DECISION",
                "Decision must be VERIFY, REJECT, or MERGE.",
            );
        }

        const previousStatus = targetInc.verification_status;

        // 8. Update Incident Status
        const { error: updateError } = await supabaseAdmin
            .from("fire_incidents")
            .update({
                verification_status: newStatus,
                updated_at: new Date().toISOString(),
            })
            .eq("incident_id", payloadBody.incident_id);

        if (updateError) {
            return errorResponse(
                500,
                "UPDATE_FAILED",
                "Failed to update incident status.",
                updateError,
            );
        }

        // 9. Insert Verification History
        const historyComment =
            payloadBody.decision === "MERGE"
                ? `[MERGED] ${payloadBody.comments || ""}`
                : payloadBody.comments;

        const { error: historyError } = await supabaseAdmin
            .from("incident_verification_history")
            .insert({
                incident_id: payloadBody.incident_id,
                action_by_user_id: userId,
                previous_status: previousStatus,
                new_status: newStatus,
                comments: historyComment,
            });

        if (historyError) {
            console.error("Failed to insert verification history", historyError);
        }

        // 10. Audit Log
        const { error: auditError } = await supabaseAdmin
            .from("system_audit_trails")
            .insert({
                user_id: userId,
                action_type: "COMMIT_INCIDENT",
                table_affected: "fire_incidents",
                record_id: payloadBody.incident_id,
                ip_address: req.headers.get("x-forwarded-for") || "unknown",
                user_agent: req.headers.get("user-agent") || "unknown",
            });

        if (auditError) console.error("Audit log error", auditError);

        // 11. Success Response
        return new Response(
            JSON.stringify({
                status: "OK",
                incident_id: payloadBody.incident_id,
                new_status: newStatus,
                message: `Incident ${payloadBody.decision}ED successfully.`,
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

