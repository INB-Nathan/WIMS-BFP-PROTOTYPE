import test from "node:test";
import assert from "node:assert/strict";
import type { Static, TSchema } from "@sinclair/typebox";
import extensionFactory from "../src/index.js";

interface RegisteredTool<TParams extends TSchema = TSchema> {
  name: string;
  label: string;
  description: string;
  parameters: TParams;
  execute: (
    toolCallId: string,
    params: Static<TParams>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<unknown>;
}

class MockPiApi {
  readonly flags = new Map<string, { description?: string; type: "boolean" | "string"; default?: boolean | string }>();
  readonly commands = new Map<string, { description?: string; handler: (args: string, ctx: unknown) => Promise<void> }>();
  readonly tools = new Map<string, RegisteredTool>();
  readonly handlers = new Map<string, Array<(event: unknown, ctx: unknown) => Promise<void>>>();

  registerFlag(name: string, options: { description?: string; type: "boolean" | "string"; default?: boolean | string }): void {
    this.flags.set(name, options);
  }

  getFlag(name: string): boolean | string | undefined {
    return this.flags.get(name)?.default;
  }

  registerCommand(name: string, options: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> }): void {
    this.commands.set(name, options);
  }

  registerTool(tool: RegisteredTool): void {
    this.tools.set(tool.name, tool);
  }

  on(event: string, handler: (event: unknown, ctx: unknown) => Promise<void>): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }
}

const EXPECTED_TOOLS = [
  "browser_start",
  "browser_navigate",
  "browser_reload",
  "browser_go_back",
  "browser_go_forward",
  "browser_viewport",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_select",
  "browser_press_key",
  "browser_wait_for",
  "browser_screenshot",
  "browser_console",
  "browser_network",
  "browser_trace_start",
  "browser_trace_stop",
  "browser_tab_select",
  "browser_tab_close",
  "browser_offline",
  "browser_online",
  "browser_set_geolocation",
  "browser_clear_geolocation",
  "browser_set_permissions",
  "browser_close",
];

const OMITTED_TOOLS = [
  "browser_evaluate",
  "browser_tabs",
  "browser_video_start",
  "browser_video_stop",
  "browser_video_status",
  "browser_run_summary",
];

test("extension registers the approved QA tool surface and flags", () => {
  const api = new MockPiApi();
  extensionFactory(api as never);

  for (const name of EXPECTED_TOOLS) {
    assert.ok(api.tools.has(name), `missing tool ${name}`);
  }
  for (const name of OMITTED_TOOLS) {
    assert.equal(api.tools.has(name), false, `tool ${name} must not be registered`);
  }

  const expectedFlags = [
    "browser-output-dir",
    "browser-viewport",
    "browser-retention-max-artifacts",
    "browser-retention-max-bytes",
    "browser-retention-max-days",
    "browser-timeout-action",
    "browser-timeout-navigation",
  ];
  for (const name of expectedFlags) {
    assert.ok(api.flags.has(name), `missing flag ${name}`);
  }
  assert.equal(api.flags.has("browser-storage-state"), false, "storage-state flag must not exist");
  assert.equal(api.flags.has("browser-record-video"), false, "video flag must not exist");
  assert.equal(api.flags.has("browser-engine"), false, "engine flag must not exist");
  assert.equal(api.commands.size, 0, "no slash commands should be registered");

  assert.ok(api.handlers.has("session_shutdown"), "session_shutdown handler required");
  assert.ok(api.handlers.has("session_tree"), "session_tree handler required");
});

test("browser_close on an idle extension reports already closed without a browser", async () => {
  const api = new MockPiApi();
  extensionFactory(api as never);
  const tool = api.tools.get("browser_close");
  assert.ok(tool);

  const ctx = { ui: { notify: () => undefined, setStatus: () => undefined }, cwd: process.cwd() };
  const result = await tool.execute("1", {}, undefined, undefined, ctx);
  const typed = result as { content: Array<{ type: string; text: string }> };
  assert.match(typed.content[0]?.text ?? "", /already closed/);
});

test("browser_network tool schema does not expose route-mocking or download parameters", () => {
  const api = new MockPiApi();
  extensionFactory(api as never);
  const network = api.tools.get("browser_network");
  assert.ok(network);
  const schema = network.parameters as { properties?: Record<string, unknown> };
  assert.ok(schema.properties);
  assert.deepEqual(Object.keys(schema.properties).sort(), ["includeStatic"]);
});
