import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// DTOs
interface BundleIncident {
  nonsensitive: {
    city_id: number;
    barangay?: string;
    notification_dt?: string;
    alarm_level?: string;
    general_category?: string;
    sub_category?: string;
    specific_type?: string;
    occupancy_type?: string;
    estimated_damage_php?: number;
    civilian_injured?: number;
    civilian_deaths?: number;
    firefighter_injured?: number;
    firefighter_deaths?: number;
    families_affected?: number;
    water_tankers_used?: number;
    foam_liters_used?: number;
    breathing_apparatus_used?: number;
  };
  sensitive: {
    street_address?: string;
    landmark?: string;
    caller_name?: string;
    caller_number?: string;
    narrative_report?: string;
    prepared_by_officer?: string;
    noted_by_officer?: string;
    disposition_status?: string;
    remarks?: string;
  };
}

interface UploadBundleRequest {
  region_id: number;
  incidents: BundleIncident[];
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
    // 1. Init Supabase Admin Client (service role, schema = wims)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        db: { schema: "wims" }, // use wims schema for all .from(...) calls
      },
    );

    // 2. Get userId from JWT in Authorization header
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

    // 3. Get Role and Region from wims.users
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
    const userRegionId = userProfile.assigned_region_id;

    // 4. Parse Request Body & Compute Checksum
    const rawBodyBuffer = await req.arrayBuffer();
    const rawBodyString = new TextDecoder().decode(rawBodyBuffer);

    const hashBuffer = await crypto.subtle.digest("SHA-256", rawBodyBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const checksumHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    let payloadBody: UploadBundleRequest;
    try {
      payloadBody = JSON.parse(rawBodyString);
    } catch (_e) {
      return errorResponse(
        400,
        "INVALID_JSON",
        "Request body is not valid JSON",
      );
    }

    // 5. Enforce Security Checks (Role = ENCODER, Region Match)
    if (userRole !== "ENCODER") {
      return errorResponse(
        403,
        "FORBIDDEN",
        "Only ENCODERS can upload bundles.",
      );
    }
    if (userRegionId !== payloadBody.region_id) {
      return errorResponse(
        403,
        "REGION_MISMATCH",
        `You cannot upload for region ${payloadBody.region_id}. Assigned: ${userRegionId}`,
      );
    }

    // 6. Insert into data_import_batches
    const { data: batchData, error: batchError } = await supabaseAdmin
      .from("data_import_batches")
      .insert({
        region_id: payloadBody.region_id,
        uploaded_by: userId,
        record_count: payloadBody.incidents.length,
        batch_checksum_hash: checksumHex,
        sync_status: "PENDING",
      })
      .select("batch_id")
      .single();

    if (batchError || !batchData) {
      return errorResponse(
        500,
        "BATCH_INSERT_FAIL",
        "Failed to create import batch",
        batchError,
      );
    }

    const batchId = batchData.batch_id;
    const createdIncidentIds: number[] = [];

    // 7. Process Incidents (Iterate and Insert)
    for (const item of payloadBody.incidents) {
      // Insert Fire Incident
      const { data: incData, error: incError } = await supabaseAdmin
        .from("fire_incidents")
        .insert({
          import_batch_id: batchId,
          encoder_id: userId,
          region_id: payloadBody.region_id,
          verification_status: "DRAFT",
        })
        .select("incident_id")
        .single();

      if (incError || !incData) {
        return errorResponse(
          500,
          "INCIDENT_INSERT_FAIL",
          "Failed to insert incident",
          incError,
        );
      }

      const incidentId = incData.incident_id;
      createdIncidentIds.push(incidentId);

      // Insert Non-Sensitive Details
      const { error: nsError } = await supabaseAdmin
        .from("incident_nonsensitive_details")
        .insert({
          incident_id: incidentId,
          ...item.nonsensitive,
        });

      if (nsError) {
        console.error("Non-sensitive insert error", nsError);
      }

      // Insert Sensitive Details
      const { error: sensError } = await supabaseAdmin
        .from("incident_sensitive_details")
        .insert({
          incident_id: incidentId,
          ...item.sensitive,
        });

      if (sensError) {
        console.error("Sensitive insert error", sensError);
      }
    }

    // 8. Audit Log
    const { error: auditError } = await supabaseAdmin
      .from("system_audit_trails")
      .insert({
        user_id: userId,
        action_type: "UPLOAD_BUNDLE",
        table_affected: "data_import_batches",
        record_id: batchId,
        ip_address: req.headers.get("x-forwarded-for") || "unknown",
        user_agent: req.headers.get("user-agent") || "unknown",
      });

    if (auditError) {
      console.error("Audit log error", auditError);
    }

    // 9. Success Response
    return new Response(
      JSON.stringify({
        status: "OK",
        batch_id: batchId,
        incident_ids: createdIncidentIds,
        message: "Bundle ingested successfully",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    return errorResponse(
      500,
      "INTERNAL_ERROR",
      "An unexpected error occurred",
      err?.message ?? String(err),
    );
  }
}

// Only start the HTTP server when running as main module (not during tests)
if (import.meta.main) {
  serve(handler);
}
