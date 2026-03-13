// supabase/functions/tests/conflict-detection.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler } from "../conflict-detection/index.ts";
import { buildFakeJwt } from "./_testUtils.ts";

const VALIDATOR_ID = "46829e25-85ea-492a-a811-b4511c253f27"; // validator_ncr UUID in wims.users

Deno.test({
  name: "conflict-detection – returns OK and a list (maybe empty)",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const jwt = buildFakeJwt(VALIDATOR_ID);

    // Use an existing incident_id; for now you can use 1 if your seed/ingest created it
    const targetIncidentId = 1;

    const req = new Request("http://localhost/functions/v1/conflict-detection", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ incident_id: targetIncidentId }),
    });

    const res = await handler(req);
    const text = await res.text();
    console.log("TEST conflict-detection OK status", res.status);
    console.log("TEST conflict-detection OK body", text);

    assertEquals(res.status, 200);

    const json = JSON.parse(text);
    assertEquals(json.status, "OK");
    assertEquals(json.incident_id, targetIncidentId);
    assert(Array.isArray(json.potential_duplicates));
  }
});

Deno.test({
  name: "conflict-detection – forbidden for encoder",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const ENCODER_ID = "31f9c3ac-2ff0-4553-89b1-80593b16b6fa";
    const jwt = buildFakeJwt(ENCODER_ID);

    const req = new Request("http://localhost/functions/v1/conflict-detection", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ incident_id: 1 }),
    });

    const res = await handler(req);
    const text = await res.text();
    console.log("TEST conflict-detection forbidden status", res.status);
    console.log("TEST conflict-detection forbidden body", text);

    assertEquals(res.status, 403);

    const json = JSON.parse(text);
    assertEquals(json.error_code, "FORBIDDEN");
  }
});
