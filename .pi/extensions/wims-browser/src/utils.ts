import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { BrowserArtifactInfo, BrowserRetentionConfig, ViewportSize } from "./types.js";

const DEFAULT_MAX_BYTES = 32 * 1024;
const DEFAULT_MAX_LINES = 400;

export function parseViewport(input: string | undefined, fallback: ViewportSize): ViewportSize {
  if (!input) return fallback;
  const match = /^(\d{2,5})x(\d{2,5})$/i.exec(input.trim());
  if (!match) return fallback;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
  return { width, height };
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

function safePrefix(prefix: string): string {
  return prefix.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "artifact";
}

/** Compute a unique artifact path in outputDir without writing anything. */
export async function resolveArtifactPath(outputDir: string, prefix: string, extension: string): Promise<string> {
  await ensureDir(outputDir);
  return join(outputDir, `${safePrefix(prefix)}-${Date.now()}.${extension}`);
}

export async function writeOutputFile(outputDir: string, prefix: string, extension: string, content: string): Promise<string> {
  const filePath = await resolveArtifactPath(outputDir, prefix, extension);
  await writeFile(filePath, content, "utf8");
  return filePath;
}

export function truncateText(text: string, maxBytes = DEFAULT_MAX_BYTES, maxLines = DEFAULT_MAX_LINES): { text: string; truncated: boolean } {
  const lines = text.split("\n");
  let selected = lines.slice(0, maxLines).join("\n");
  let truncated = lines.length > maxLines;
  while (Buffer.byteLength(selected, "utf8") > maxBytes && selected.length > 0) {
    selected = selected.slice(0, Math.max(0, selected.length - 256));
    truncated = true;
  }
  if (!truncated) return { text: selected, truncated: false };
  return {
    text: `${selected.trimEnd()}\n\n[Output truncated. Use saved artifact for the full result.]`,
    truncated: true,
  };
}

export function resolveOutputDir(cwd: string, configured?: string): string {
  return resolve(cwd, configured ?? ".pi/browser");
}

export function parsePositiveInt(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const value = Number.parseInt(input.trim(), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parsePositiveBytes(input: string | undefined, fallback: number): number {
  if (!input) return fallback;
  const normalized = input.trim().toLowerCase();
  const match = /^(\d+)(b|kb|mb|gb)?$/.exec(normalized);
  if (!match) return fallback;
  const numericPart = match[1];
  if (!numericPart) return fallback;
  const value = Number.parseInt(numericPart, 10);
  const unit = match[2] ?? "b";
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 * 1024,
    gb: 1024 * 1024 * 1024,
  };
  return value * (multipliers[unit] ?? 1);
}

export async function listArtifacts(outputDir: string): Promise<BrowserArtifactInfo[]> {
  await ensureDir(outputDir);
  const entries = await readdir(outputDir, { withFileTypes: true });
  const artifacts: BrowserArtifactInfo[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(outputDir, entry.name);
    const stats = await stat(path);
    artifacts.push({ path, size: stats.size, modifiedMs: stats.mtimeMs });
  }
  artifacts.sort((a, b) => b.modifiedMs - a.modifiedMs);
  return artifacts;
}

export async function pruneArtifacts(
  outputDir: string,
  retention: BrowserRetentionConfig,
): Promise<{ removed: BrowserArtifactInfo[]; remaining: BrowserArtifactInfo[]; bytesFreed: number }> {
  const artifacts = await listArtifacts(outputDir);
  const now = Date.now();
  const maxAgeMs = retention.maxAgeDays * 24 * 60 * 60 * 1000;
  const keep: BrowserArtifactInfo[] = [];
  const removed: BrowserArtifactInfo[] = [];

  for (const artifact of artifacts) {
    const isExpired = maxAgeMs > 0 && now - artifact.modifiedMs > maxAgeMs;
    if (isExpired) {
      removed.push(artifact);
    } else {
      keep.push(artifact);
    }
  }

  let totalBytes = keep.reduce((sum, artifact) => sum + artifact.size, 0);
  while (keep.length > retention.maxArtifacts || totalBytes > retention.maxBytes) {
    const artifact = keep.pop();
    if (!artifact) break;
    totalBytes -= artifact.size;
    removed.push(artifact);
  }

  for (const artifact of removed) {
    await rm(artifact.path, { force: true });
  }

  return {
    removed,
    remaining: keep,
    bytesFreed: removed.reduce((sum, artifact) => sum + artifact.size, 0),
  };
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${bytes}B`;
}
