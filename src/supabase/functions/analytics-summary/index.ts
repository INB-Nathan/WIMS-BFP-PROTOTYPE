import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

interface AnalyticsRequest {
    from_date?: string;
    to_date?: string;
    region_id?: number;
    province_id?: number;
    city_id?: number;
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
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
}

// Helper to decode base64url (JWT payload)
function base64UrlDecode(input: string): string {
    const padded = input.padEnd(Math.ceil(input.length / 4) * 4, "=");
    const base64 = padded.replace(/-/g, "+").replace(/_/g, "/");
    return atob(base64);
}

export async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

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
        const assignedRegion = userProfile.assigned_region_id;

        // Allow ADMIN, SYSTEM_ADMIN, ANALYST
        // ALSO Allow VALIDATOR/ENCODER if they are NHQ (assigned_region_id is NULL)
        const isNHQ = !assignedRegion;
        const isPrivileged = ["ANALYST", "ADMIN", "SYSTEM_ADMIN"].includes(userRole);

        if (!isPrivileged && !(isNHQ && ["ENCODER", "VALIDATOR"].includes(userRole))) {
            return errorResponse(
                403,
                "FORBIDDEN",
                "You do not have permission to view the analytics dashboard.",
            );
        }

        // 4. Parse Body (Optional)
        let payloadBody: AnalyticsRequest = {};
        if (req.method === "POST") {
            try {
                const rawBody = await req.text();
                payloadBody = JSON.parse(rawBody);
            } catch {
                // ignore malformed body; treat as no filters
            }
        }

        // 5. Build Query
        let query = supabaseAdmin.from("fire_incidents").select(`
      region_id,
      region:ref_regions(region_name),
      created_at,
      incident_nonsensitive_details!inner (
        alarm_level,
        general_category,
        city_id,
        city:ref_cities!inner (
            province_id
        )
      )
    `);

        if (payloadBody.from_date) {
            query = query.gte("created_at", payloadBody.from_date);
        }
        if (payloadBody.to_date) {
            query = query.lte("created_at", payloadBody.to_date);
        }

        // Region Filter:
        // If user is restricted to a region, FORCE that region.
        // If user is NHQ/Privileged, use their requested region_id (if any).
        if (assignedRegion) {
            query = query.eq("region_id", assignedRegion);
        } else if (payloadBody.region_id) {
            query = query.eq("region_id", payloadBody.region_id);
        }

        // Province/City Filters (applied to inner join table)
        if (payloadBody.province_id) {
            // Filter via the nested relation to city -> province
            // Supabase filtering on nested resources:
            // We need to use external filter syntax or embedded?
            // "incident_nonsensitive_details.city.province_id" might work if enabled, but usually tricky.
            // A safer way is ensuring `!inner` on city and filtering there.
            // PostgREST syntax for nested filter: `incident_nonsensitive_details.city.province_id=eq.123`
            // But JS library abstraction:
            // We can filter on the *top level* referencing the nested path?
            // Actually, best current practice for deep filtering:
            // Just use the filter builder on the top level resource with dot notation for the embedded resource.
            query = query.eq("incident_nonsensitive_details.city.province_id", payloadBody.province_id);
        }
        if (payloadBody.city_id) {
            query = query.eq("incident_nonsensitive_details.city_id", payloadBody.city_id);
        }

        const { data: rawData, error: fetchError } = await query;

        if (fetchError) {
            return errorResponse(
                500,
                "FETCH_FAILED",
                "Failed to fetch analytics data",
                fetchError,
            );
        }

        // 6. Aggregate Data
        const total_incidents = rawData?.length || 0;

        const regionMap = new Map<string, number>();
        const alarmMap = new Map<string, number>();
        const categoryMap = new Map<string, number>();

        rawData?.forEach((row: any) => {
            // Region
            const regName = row.region?.region_name || `Region ${row.region_id}`;
            regionMap.set(regName, (regionMap.get(regName) || 0) + 1);

            // Nonsensitive Details
            const detailsRaw = row.incident_nonsensitive_details;
            const details = Array.isArray(detailsRaw) ? detailsRaw[0] : detailsRaw;

            if (details) {
                const alarm = details.alarm_level || "Unknown";
                alarmMap.set(alarm, (alarmMap.get(alarm) || 0) + 1);

                const cat = details.general_category || "Unknown";
                categoryMap.set(cat, (categoryMap.get(cat) || 0) + 1);
            }
        });

        const by_region = Array.from(regionMap.entries()).map(([name, count]) => ({
            region_name: name,
            count,
        }));
        const by_alarm_level = Array.from(alarmMap.entries()).map(
            ([level, count]) => ({ alarm_level: level, count }),
        );
        const by_general_category = Array.from(categoryMap.entries()).map(
            ([cat, count]) => ({ general_category: cat, count }),
        );

        // 7. Audit Log
        const { error: auditError } = await supabaseAdmin
            .from("system_audit_trails")
            .insert({
                user_id: userId,
                action_type: "GET_ANALYTICS_SUMMARY",
                table_affected: "fire_incidents",
                ip_address: req.headers.get("x-forwarded-for") || "unknown",
                user_agent: req.headers.get("user-agent") || "unknown",
            });

        if (auditError) console.error("Audit log error", auditError);

        // 8. Return Response
        return new Response(
            JSON.stringify({
                status: "OK",
                filters: payloadBody,
                total_incidents,
                by_region,
                by_alarm_level,
                by_general_category,
            }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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
