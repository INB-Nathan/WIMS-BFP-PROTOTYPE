// supabase/functions/tests/analytics-summary.test.ts
import { assertEquals, assert } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { handler } from "../analytics-summary/index.ts";
import { buildFakeJwt } from "./_testUtils.ts";

const ANALYST_ID = "e9e77e2b-058a-4e56-bdf2-e4cec7504486"; // analyst_nhq UUID

Deno.test({
  name: "analytics-summary – analyst gets aggregates",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const jwt = buildFakeJwt(ANALYST_ID);

    const body = {
      from_date: "2026-02-01T00:00:00Z",
      to_date: "2026-02-28T23:59:59Z", // Fixed valid date
      region_id: 1,
    };

    const req = new Request("http://localhost/functions/v1/analytics-summary", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify(body),
    });

    const res = await handler(req);
    const text = await res.text();
    console.log("TEST analytics-summary OK status", res.status);
    console.log("TEST analytics-summary OK body", text);

    assertEquals(res.status, 200);

    const json = JSON.parse(text);
    assertEquals(json.status, "OK");
    assert("total_incidents" in json);
    assert(Array.isArray(json.by_region));
    assert(Array.isArray(json.by_alarm_level));
    assert(Array.isArray(json.by_general_category));
  }
});

Deno.test({
  name: "analytics-summary – encoder is forbidden",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const ENCODER_ID = "31f9c3ac-2ff0-4553-89b1-80593b16b6fa";
    const jwt = buildFakeJwt(ENCODER_ID);

    const req = new Request("http://localhost/functions/v1/analytics-summary", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ region_id: 1 }),
    });

    const res = await handler(req);
    const text = await res.text();
    console.log("TEST analytics-summary forbidden status", res.status);
    console.log("TEST analytics-summary forbidden body", text);

    assertEquals(res.status, 403);

    const json = JSON.parse(text);
    assertEquals(json.error_code, "FORBIDDEN");
  }
});
