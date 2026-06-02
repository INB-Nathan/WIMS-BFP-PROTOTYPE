import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import * as path from "node:path";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "project_context",
    label: "Project Context",
    description:
      "Gather project context before building (pre-build recon: reads wiki, routing guide, relevant source files), " +
      "or verify wiki compliance after changes (checks system-wiki/log.md and synthesis pages were updated).",
    parameters: Type.Object({
      mode: Type.String({
        description: '"gather" — pre-build reconnaissance. "verify" — post-build wiki compliance check.',
      }),
      task: Type.Optional(
        Type.String({
          description: "Task description. Required for gather mode. e.g. 'Fix issue #199 — restrict CORS origins in nginx'",
        }),
      ),
      changedFiles: Type.Optional(
        Type.Array(
          Type.String(),
          { description: "Files that were changed. Required for verify mode." },
        ),
      ),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      if (params.mode === "gather") {
        return await gatherContext(ctx.cwd, params.task || "");
      } else if (params.mode === "verify") {
        return await verifyWiki(ctx.cwd, params.changedFiles || []);
      }
      return {
        content: [{ type: "text", text: `Unknown mode: ${params.mode}. Use "gather" or "verify".` }],
        isError: true,
      };
    },
  });
}

// ─── Gather Mode ────────────────────────────────────────────────────────────

interface SubsystemRoute {
  keywords: string[];
  wikiPages: string[];
  sourceDirs: string[];
  description: string;
}

const SUBSYSTEM_ROUTES: SubsystemRoute[] = [
  {
    keywords: ["auth", "session", "user", "keycloak", "login", "sso", "role", "permission"],
    wikiPages: [
      "security/security-baseline",
      "backend/api-route-map",
      "backend/services",
      "backend/utilities-and-tasks",
      "subsystems/admin-hub",
    ],
    sourceDirs: ["src/backend/api/routes/admin.py", "src/backend/api/routes/sessions.py", "src/backend/api/routes/user.py", "src/backend/auth.py"],
    description: "Auth, session, user admin, Keycloak",
  },
  {
    keywords: ["incident", "crud", "offline", "import", "regional", "afor"],
    wikiPages: [
      "concepts/frs-module-map",
      "backend/api-route-map",
      "frontend/route-map",
      "frontend/frontend-infrastructure",
      "database/sql-init-files",
      "subsystems/regional-dashboard",
    ],
    sourceDirs: ["src/backend/api/routes/regional.py", "src/backend/api/routes/incidents.py"],
    description: "Incident CRUD, AFOR import, offline sync",
  },
  {
    keywords: ["validation", "triage", "duplicate", "validator", "promote", "queue"],
    wikiPages: [
      "backend/api-route-map",
      "backend/services",
      "database/sql-init-files",
      "subsystems/validator-hub",
    ],
    sourceDirs: ["src/backend/api/routes/triage.py", "src/backend/api/routes/regional.py"],
    description: "Validation/triage workflow, duplicate detection",
  },
  {
    keywords: ["immutable", "audit", "correction", "archive", "immutable record"],
    wikiPages: [
      "security/security-baseline",
      "backend/utilities-and-tasks",
      "database/sql-init-files",
      "gaps/frs-codebase-gap-register",
    ],
    sourceDirs: ["src/postgres-init/17_immutable_records.sql"],
    description: "Immutable records, audit trails, corrections",
  },
  {
    keywords: ["analytics", "reporting", "dashboard", "stat", "aggregate", "mv", "materialized view", "analyst"],
    wikiPages: [
      "frontend/route-map",
      "frontend/frontend-infrastructure",
      "backend/api-route-map",
      "backend/services",
      "database/sql-init-files",
    ],
    sourceDirs: ["src/backend/api/routes/analytics.py", "src/backend/main.py"],
    description: "Analytics, reporting, materialized views",
  },
  {
    keywords: ["public", "anonymous", "submission", "civilian", "report", "dmz", "rate limit"],
    wikiPages: [
      "security/security-baseline",
      "architecture/infrastructure-config",
      "gaps/frs-codebase-gap-register",
      "subsystems/civilian-reporting-phase2",
    ],
    sourceDirs: ["src/backend/api/routes/public_dmz.py", "src/backend/api/routes/triage.py"],
    description: "Public anonymous incident submission, civilian reporting",
  },
  {
    keywords: ["reference", "ref", "geography", "region", "province", "city", "barangay"],
    wikiPages: [
      "database/schema-overview",
      "database/sql-init-files",
    ],
    sourceDirs: ["src/backend/api/routes/ref.py"],
    description: "Reference data (geography tables)",
  },
  {
    keywords: ["infrastructure", "docker", "ci", "nginx", "cors", "deploy", "compose"],
    wikiPages: [
      "architecture/infrastructure-config",
      "architecture/pwa-tests-cicd",
    ],
    sourceDirs: ["src/docker-compose.yml", "src/nginx/", "src/Dockerfile"],
    description: "Infrastructure, Docker, CI/CD, nginx",
  },
  {
    keywords: ["rls", "row level security", "policy", "m15", "row-level", "row level"],
    wikiPages: [
      "database/sql-init-files",
      "security/security-baseline",
      "database/schema-overview",
    ],
    sourceDirs: ["src/postgres-init/", "src/backend/database.py", "src/backend/auth.py"],
    description: "Row-level security (RLS), M15",
  },
  {
    keywords: ["celery", "task", "background", "beat", "worker", "async task"],
    wikiPages: [
      "backend/backend-infrastructure",
      "backend/utilities-and-tasks",
    ],
    sourceDirs: ["src/backend/tasks/", "src/backend/celery_config.py"],
    description: "Celery background tasks",
  },
  {
    keywords: ["frontend", "ui", "component", "page", "next", "react", "dashboard page"],
    wikiPages: [
      "frontend/route-map",
      "frontend/frontend-infrastructure",
      "frontend/components-deep",
    ],
    sourceDirs: ["src/frontend/src/app/", "src/frontend/src/components/"],
    description: "Frontend pages and components",
  },
  {
    keywords: ["encrypt", "crypto", "aes", "gcm", "pii", "secret", "key"],
    wikiPages: [
      "security/security-baseline",
      "backend/services",
    ],
    sourceDirs: ["src/backend/services/encryption.py", "src/backend/auth.py"],
    description: "Encryption, PII, secrets management",
  },
  {
    keywords: ["suricata", "ids", "intrusion", "network", "monitor", "eve"],
    wikiPages: [
      "architecture/infrastructure-config",
    ],
    sourceDirs: ["src/suricata/", "src/backend/tasks/suricata.py"],
    description: "Suricata IDS/network monitoring",
  },
];

function matchSubsystems(task: string): SubsystemRoute[] {
  const lower = task.toLowerCase();
  const matched: SubsystemRoute[] = [];
  for (const route of SUBSYSTEM_ROUTES) {
    if (route.keywords.some((kw) => lower.includes(kw))) {
      matched.push(route);
    }
  }
  return matched;
}

async function gatherContext(cwd: string, task: string): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }> {
  const lines: string[] = [];
  const details: Record<string, unknown> = {};

  // 1. Task
  lines.push(`# Project Context — ${task}\n`);

  // 2. Identify matched subsystems
  const matched = matchSubsystems(task);
  if (matched.length === 0) {
    // Fallback: read core pages and a generic set
    lines.push("**No specific subsystem matched. Reading core context.**\n");
    details.matchedSubsystems = "none (using default core pages)";
  } else {
    lines.push(`**Matched subsystems:** ${matched.map((m) => m.description).join(", ")}\n`);
    details.matchedSubsystems = matched.map((m) => m.description);
  }

  const allWikiPages = new Set<string>();
  const allSourceDirs = new Set<string>();
  for (const m of matched) {
    for (const wp of m.wikiPages) allWikiPages.add(wp);
    for (const sd of m.sourceDirs) allSourceDirs.add(sd);
  }

  // 3. Read core context files
  const coreFiles = [
    "AGENTS.md",
    "system-wiki/SCHEMA.md",
    "system-wiki/index.md",
    "system-wiki/mocs/system-map.md",
  ];

  lines.push("\n## Core Context\n");
  for (const file of coreFiles) {
    const fullPath = path.join(cwd, file);
    try {
      const content = await safeReadFile(fullPath, 60);
      lines.push(`### ${file}\n\`\`\`\n${content}\n\`\`\`\n`);
    } catch {
      lines.push(`*Could not read ${file}*\n`);
    }
  }

  // 4. Read relevant wiki subsystem pages
  if (allWikiPages.size > 0) {
    lines.push("\n## Subsystem Wiki Pages\n");
    for (const wp of allWikiPages) {
      const fullPath = path.join(cwd, "system-wiki", `${wp}.md`);
      try {
        const content = await safeReadFile(fullPath, 40);
        lines.push(`### system-wiki/${wp}.md\n\`\`\`\n${content}\n\`\`\`\n`);
      } catch {
        lines.push(`*Could not read system-wiki/${wp}.md*\n`);
      }
    }
  }

  // 5. Read relevant source files (check existence first, read first 30 lines)
  if (allSourceDirs.size > 0) {
    lines.push("\n## Source Files\n");
    for (const sd of allSourceDirs) {
      const fullPath = path.join(cwd, sd);
      try {
        // Use glob-style: if ends with / read dir listing, else read file
        if (sd.endsWith("/")) {
          const listing = await safeExec(`ls -1 "${fullPath}" 2>/dev/null | head -20`, cwd);
          lines.push(`### ${sd}\n\`\`\`\n${listing}\n\`\`\`\n`);
        } else {
          const content = await safeReadFile(fullPath, 30);
          lines.push(`### ${sd}\n\`\`\`\n${content}\n\`\`\`\n`);
        }
      } catch {
        lines.push(`*Could not read ${sd}*\n`);
      }
    }
  }

  // 6. Git context
  lines.push("\n## Git Context\n");
  try {
    const branch = await safeExec('git rev-parse --abbrev-ref HEAD', cwd);
    const status = await safeExec('git status --short | head -20', cwd);
    const diffStat = await safeExec('git diff --stat master..HEAD 2>/dev/null | head -20', cwd);
    lines.push(`**Branch:** ${branch}\n`);
    lines.push(`**Status:**\n\`\`\`\n${status}\n\`\`\`\n`);
    if (diffStat.trim()) {
      lines.push(`**Diff vs master:**\n\`\`\`\n${diffStat}\n\`\`\`\n`);
    }
  } catch {
    lines.push("*Git context unavailable*\n");
  }

  return {
    content: [{ type: "text", text: lines.join("") }],
    details: details,
  };
}

// ─── Verify Mode ────────────────────────────────────────────────────────────

async function verifyWiki(cwd: string, changedFiles: string[]): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }> {
  const lines: string[] = [];
  const details: Record<string, unknown> = {};

  lines.push("# Wiki Compliance Check\n");

  // Check 1: Are there any modified wiki files?
  let modifiedWikiFiles: string[] = [];
  try {
    const raw = await safeExec('git diff --name-only 2>/dev/null', cwd);
    modifiedWikiFiles = raw.split("\n").filter((f) => f.startsWith("system-wiki/") && f.length > 0);
  } catch {
    // fallback
  }

  // Also check from the changedFiles param
  const paramWikiFiles = (changedFiles || []).filter((f) => f.startsWith("system-wiki/"));

  const allWikiChanges = [...new Set([...modifiedWikiFiles, ...paramWikiFiles])];

  if (allWikiChanges.length === 0) {
    lines.push("❌ **No system-wiki files were modified.**\n");
    lines.push("For non-trivial changes, you must update the relevant synthesis page and append to system-wiki/log.md.\n");
    details.compliant = false;
    details.issue = "No wiki files changed";
  } else {
    lines.push(`✅ **${allWikiChanges.length} system-wiki file(s) modified:**\n`);
    for (const f of allWikiChanges) {
      lines.push(`  - ${f}\n`);
    }
    details.modifiedWikiFiles = allWikiChanges;
  }

  // Check 2: Was system-wiki/log.md updated?
  const logUpdated = allWikiChanges.includes("system-wiki/log.md") || modifiedWikiFiles.includes("system-wiki/log.md");
  if (logUpdated) {
    lines.push("✅ **system-wiki/log.md** was updated.\n");
  } else {
    lines.push("⚠️ **system-wiki/log.md** was NOT updated. Append an entry describing the change.\n");
    if (!details.compliant) details.compliant = false;
    details.issue = details.issue ? `${details.issue}; log.md not updated` : "log.md not updated";
  }

  // Check 3: Is there a synthesis page update?
  const synthesisPages = allWikiChanges.filter(
    (f) => f.startsWith("system-wiki/") && !f.includes("raw/") && !f.includes("log.md") && !f.includes("gap"),
  );
  if (synthesisPages.length > 0) {
    lines.push(`✅ **Synthesis page(s) updated:** ${synthesisPages.join(", ")}\n`);
  } else {
    lines.push("⚠️ No synthesis page was updated. For non-trivial changes, update the relevant system-wiki synthesis page.\n");
    if (!details.compliant) details.compliant = false;
    details.issue = details.issue ? `${details.issue}; no synthesis page updated` : "no synthesis page updated";
  }

  // Check 4: Gap register?
  const gapFiles = allWikiChanges.filter((f) => f.includes("gap"));
  if (gapFiles.length > 0) {
    lines.push(`📋 **Gap register(s) updated:** ${gapFiles.join(", ")}\n`);
  }
  details.gapRegisterUpdated = gapFiles.length > 0;

  // Summary
  const compliant = logUpdated && synthesisPages.length > 0;
  if (compliant) {
    lines.push("\n---\n**✅ Wiki compliance: PASS**\n");
  } else {
    lines.push("\n---\n**❌ Wiki compliance: NEEDS ATTENTION** — see issues above.\n");
  }
  details.compliant = compliant;

  return {
    content: [{ type: "text", text: lines.join("") }],
    details,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function safeReadFile(filePath: string, maxLines: number): Promise<string> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.split("\n");
  const truncated = lines.slice(0, maxLines);
  let result = truncated.join("\n");
  if (lines.length > maxLines) {
    result += `\n... (${lines.length - maxLines} more lines)`;
  }
  return result;
}

function safeExec(command: string, cwd: string): string {
  try {
    return execSync(command, { cwd, encoding: "utf-8", timeout: 10_000 }).trim();
  } catch {
    return "";
  }
}
