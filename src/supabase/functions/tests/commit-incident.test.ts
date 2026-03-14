// supabase/functions/tests/commit-incident.test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler } from "../commit-incident/index.ts";
import { buildFakeJwt } from "./_testUtils.ts";

const VALIDATOR_ID = "46829e25-85ea-492a-a811-b4511c253f27"; // validator_ncr

Deno.test({
    name: "commit-incident – validator can verify incident",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const jwt = buildFakeJwt(VALIDATOR_ID);

        // Use an incident that exists and is in region 1; 1 or 2 from your upload-bundle tests
        const INCIDENT_ID = 1;

        const body = {
            incident_id: INCIDENT_ID,
            decision: "VERIFY" as const,
            comments: "Test verification",
        };

        const req = new Request("http://localhost/functions/v1/commit-incident", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify(body),
        });

        const res = await handler(req);
        const text = await res.text();
        console.log("TEST commit-incident VERIFY status", res.status);
        console.log("TEST commit-incident VERIFY body", text);

        assertEquals(res.status, 200);

        const json = JSON.parse(text);
        assertEquals(json.status, "OK");
        assertEquals(json.incident_id, INCIDENT_ID);
        assertEquals(json.new_status, "VERIFIED");
    }
});

Deno.test({
    name: "commit-incident – encoder is forbidden",
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
        const ENCODER_ID = "31f9c3ac-2ff0-4553-89b1-80593b16b6fa";
        const jwt = buildFakeJwt(ENCODER_ID);

        const body = {
            incident_id: 1,
            decision: "VERIFY" as const,
        };

        const req = new Request("http://localhost/functions/v1/commit-incident", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify(body),
        });

        const res = await handler(req);
        const text = await res.text();
        console.log("TEST commit-incident forbidden status", res.status);
        console.log("TEST commit-incident forbidden body", text);

        assertEquals(res.status, 403);

        const json = JSON.parse(text);
        assertEquals(json.error_code, "FORBIDDEN");
    }
});
