/**
 * VPS Diagnostic Extension
 *
 * SSH-based tools for diagnosing WIMS-BFP deploy failures on the production VPS.
 * Requires SSH key-based auth (no password prompts).
 *
 * Host: 194.233.81.162, user: wims
 * Deploy dir: /opt/wims-bfp
 * Compose dir: /opt/wims-bfp/src
 *
 * All tools gracefully handle connection failures and timeout gracefully.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const VPS_HOST = "194.233.81.162";
const VPS_USER = "wims";
const VPS_REMOTE = `${VPS_USER}@${VPS_HOST}`;
const COMPOSE_DIR = "/opt/wims-bfp/src";
const APP_DIR = "/opt/wims-bfp";

// ---------------------------------------------------------------------------
// SSH helpers
// ---------------------------------------------------------------------------

type SshResult = { ok: true; stdout: string; stderr: string } | { ok: false; error: string; hint?: string };

async function ssh(
  pi: ExtensionAPI,
  command: string,
  timeoutMs = 30_000,
): Promise<SshResult> {
  try {
    const result = await pi.exec("ssh", [
      "-o", "ConnectTimeout=10",
      "-o", "StrictHostKeyChecking=accept-new",
      VPS_REMOTE,
      command,
    ], { timeout: timeoutMs });

    if (result.code !== 0) {
      const stderr = result.stderr?.trim() || "";
      const stdout = result.stdout?.trim() || "";

      if (stderr.includes("Connection refused") || stderr.includes("Connection timed out")) {
        return { ok: false, error: `Cannot connect to ${VPS_HOST}`, hint: "Check if VPS is running and network is reachable" };
      }
      if (stderr.includes("Permission denied")) {
        return { ok: false, error: "SSH authentication failed", hint: "Check SSH key and that wims user exists on VPS" };
      }
      return { ok: false, error: stderr || stdout || `SSH exited with code ${result.code}` };
    }

    return { ok: true, stdout: result.stdout?.trim() || "", stderr: result.stderr?.trim() || "" };
  } catch (err) {
    if (err instanceof Error) {
      if (err.message.includes("ENOENT")) {
        return { ok: false, error: "ssh client not found", hint: "Install OpenSSH client" };
      }
      return { ok: false, error: err.message };
    }
    return { ok: false, error: "Unknown SSH error" };
  }
}

async function composeCmd(pi: ExtensionAPI, args: string[], timeoutMs = 120_000): Promise<SshResult> {
  const cmd = `cd ${COMPOSE_DIR} && docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production ${args.map(a => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`;
  return ssh(pi, cmd, timeoutMs);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI): void {
  // ---- Tool: vps_ssh ----
  pi.registerTool({
    name: "vps_ssh",
    label: "VPS SSH",
    description: `Run an arbitrary bash command on the production VPS (${VPS_HOST}) via SSH. Returns stdout and stderr.`,
    promptSnippet: `Run a command on the VPS at ${VPS_HOST}`,
    parameters: Type.Object({
      command: Type.String({ description: "Bash command to execute on the VPS" }),
      timeout: Type.Optional(Type.Number({ description: "Timeout in ms (default: 60000)", default: 60_000 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ctx.ui.setStatus("vps", `SSH: ${VPS_REMOTE}`);
      const result = await ssh(pi, params.command, params.timeout || 60_000);

      if (!result.ok) {
        ctx.ui.setStatus("vps", `SSH error: ${VPS_REMOTE}`);
        return {
          content: [{ type: "text", text: `SSH Error: ${result.error}${result.hint ? `\nHint: ${result.hint}` : ""}` }],
          details: { host: VPS_HOST, command: params.command },
          isError: true,
        };
      }

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim() || "(no output)";
      return {
        content: [{ type: "text", text: output }],
        details: { host: VPS_HOST, command: params.command, stdout: result.stdout, stderr: result.stderr },
      };
    },
  });

  // ---- Tool: vps_compose_ps ----
  pi.registerTool({
    name: "vps_compose_ps",
    label: "VPS Compose Status",
    description: "List all Docker Compose containers and their current state on the VPS. Shows health, status, and port mappings for every service.",
    promptSnippet: "Check VPS compose container statuses",
    parameters: Type.Object({
      all: Type.Optional(Type.Boolean({ description: "Show stopped containers too (default: false)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ctx.ui.setStatus("vps", "Checking compose status...");
      const args = params.all ? ["ps", "-a"] : ["ps"];
      const result = await composeCmd(pi, args);

      if (!result.ok) {
        ctx.ui.setStatus("vps", "Compose status failed");
        return {
          content: [{ type: "text", text: `Failed to get compose status: ${result.error}` }],
          details: {},
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: result.stdout || "(all containers running)" }],
        details: { containers: result.stdout },
      };
    },
  });

  // ---- Tool: vps_compose_logs ----
  pi.registerTool({
    name: "vps_compose_logs",
    label: "VPS Compose Logs",
    description: "Fetch logs from a specific Docker Compose service on the VPS. Supports tail count and follow (latest only).",
    promptSnippet: "Get VPS compose service logs",
    parameters: Type.Object({
      service: Type.String({ description: "Service name (e.g. backend, keycloak, postgres, nginx, ollama, celery-worker, redis, suricata)" }),
      lines: Type.Optional(Type.Number({ description: "Number of recent lines (default: 50)", default: 50 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ctx.ui.setStatus("vps", `Fetching logs: ${params.service}...`);
      const result = await composeCmd(pi, ["logs", "--tail", String(params.lines || 50), params.service]);

      if (!result.ok) {
        ctx.ui.setStatus("vps", "Log fetch failed");
        return {
          content: [{ type: "text", text: `Failed to get logs for ${params.service}: ${result.error}` }],
          details: { service: params.service },
          isError: true,
        };
      }

      return {
        content: [{ type: "text", text: result.stdout || "(no logs)" }],
        details: { service: params.service, lines: params.lines || 50 },
      };
    },
  });

  // ---- Tool: vps_compose_up ----
  pi.registerTool({
    name: "vps_compose_up",
    label: "VPS Compose Up",
    description: "Start or restart the Docker Compose stack on the VPS. Optionally rebuild images. Runs with --wait and reports which service fails.",
    promptSnippet: "Run docker compose up on the VPS",
    parameters: Type.Object({
      build: Type.Optional(Type.Boolean({ description: "Rebuild images (default: false)" })),
      service: Type.Optional(Type.String({ description: "Specific service to restart (default: all)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ctx.ui.setStatus("vps", "Running compose up...");
      const args = ["up", "-d", "--wait", "--wait-timeout", "600"];
      if (params.build) args.push("--build");
      if (params.service) args.push(params.service);

      const result = await composeCmd(pi, args, 300_000);
      if (!result.ok) {
        // Try to get which service failed
        const psCheck = await composeCmd(pi, ["ps", "--status", "unhealthy"]);
        const unhealthyOutput = psCheck.ok && psCheck.stdout ? `\n\nUnhealthy services:\n${psCheck.stdout}` : "";

        ctx.ui.setStatus("vps", "Compose up failed");
        return {
          content: [{
            type: "text",
            text: `Compose up failed: ${result.error}${unhealthyOutput}`,
          }],
          details: { service: params.service || "all", build: !!params.build },
          isError: true,
        };
      }

      ctx.ui.setStatus("vps", "VPS compose stack up");
      return {
        content: [{ type: "text", text: result.stdout || "Compose stack started successfully" }],
        details: { service: params.service || "all" },
      };
    },
  });

  // ---- Tool: vps_deploy_check ----
  pi.registerTool({
    name: "vps_deploy_check",
    label: "VPS Deploy Health Check",
    description: "Run the full post-deploy health check suite on the VPS: backend /health, nginx gateway, Keycloak discovery, frontend route, public API, and Ollama model. Reports which check fails.",
    promptSnippet: "Run deploy health checks on the VPS",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      ctx.ui.setStatus("vps", "Running deploy health checks...");

      const script = `
        set -uo pipefail
        failures=0

        check() {
          local name="$1"
          shift
          echo "=== $name ==="
          if "$@"; then
            echo "PASS"
          else
            echo "FAIL"
            failures=$((failures + 1))
          fi
        }

        check "Backend /health" curl -fsS -o /dev/null http://localhost:8000/health
        check "Nginx gateway /health" curl -fsS -o /dev/null https://wimsbfp.tech/health
        check "Keycloak discovery" curl -fsS -o /dev/null https://wimsbfp.tech/auth/realms/bfp/.well-known/openid-configuration
        check "Frontend route" curl -fsS -o /dev/null https://wimsbfp.tech/login
        check "Public API route" curl -fsS -o /dev/null https://wimsbfp.tech/api/public/emergency-services
        check "Ollama model" sh -c "docker exec wims-ollama ollama list | grep -q 'qwen2.5:1.5b'"

        echo "=== System resources ==="
        echo "CPU:"
        grep 'model name' /proc/cpuinfo | head -1 || true
        echo "Cores: $(nproc)"
        echo "RAM:"
        free -h | grep Mem || true
        echo "Disk:"
        df -h / | tail -1 || true
        echo "Failures: $failures"
        exit 0
      `;

      const result = await ssh(pi, script, 60_000);
      if (!result.ok) {
        ctx.ui.setStatus("vps", "Health checks failed to run");
        return {
          content: [{ type: "text", text: `Failed to run health checks: ${result.error}` }],
          details: {},
          isError: true,
        };
      }

      // Parse PASS/FAIL results
      const lines = result.stdout.split("\n");
      const results: Record<string, string> = {};
      let currentCheck = "";
      for (const line of lines) {
        const checkMatch = line.match(/^=== (.+) ===$/);
        if (checkMatch) {
          currentCheck = checkMatch[1];
          continue;
        }
        if (line.trim() === "PASS") results[currentCheck] = "✅ pass";
        else if (line.trim() === "FAIL") results[currentCheck] = "❌ FAIL";
      }

      const allPass = Object.values(results).length > 0 && Object.values(results).every(v => v === "✅ pass");
      return {
        content: [{ type: "text", text: result.stdout }],
        details: {
          host: VPS_HOST,
          all_checks_passed: allPass,
          check_results: results,
        },
      };
    },
  });

  // ---- Tool: vps_compose_down ----
  pi.registerTool({
    name: "vps_compose_down",
    label: "VPS Compose Down",
    description: "Stop and remove the Docker Compose stack on the VPS. Optionally remove volumes and images.",
    promptSnippet: "Stop the VPS compose stack",
    parameters: Type.Object({
      volumes: Type.Optional(Type.Boolean({ description: "Remove volumes (default: false)" })),
      images: Type.Optional(Type.Boolean({ description: "Remove images (default: false)" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      ctx.ui.setStatus("vps", "Stopping compose stack...");
      const args = ["down"];
      if (params.volumes) args.push("-v");
      if (params.images) args.push("--rmi", "all");

      const result = await composeCmd(pi, args, 120_000);
      if (!result.ok) {
        ctx.ui.setStatus("vps", "Compose down failed");
        return {
          content: [{ type: "text", text: `Compose down failed: ${result.error}` }],
          details: {},
          isError: true,
        };
      }

      ctx.ui.setStatus("vps", "VPS compose stack stopped");
      return {
        content: [{ type: "text", text: result.stdout || "Compose stack stopped" }],
        details: {},
      };
    },
  });

  // Status line on session start
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.setStatus("vps", `VPS: ${VPS_REMOTE}`);
  });
}
