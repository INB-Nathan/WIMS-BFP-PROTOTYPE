/** Shared types for the WIMS browser QA extension. */

export interface ViewportSize {
  width: number;
  height: number;
}

export interface BrowserRetentionConfig {
  maxArtifacts: number;
  maxBytes: number;
  maxAgeDays: number;
}

export interface BrowserLaunchConfig {
  cwd: string;
  outputDir: string;
  viewport: ViewportSize;
  retention: BrowserRetentionConfig;
  actionTimeoutMs: number;
  navigationTimeoutMs: number;
}

export interface BrowserStatus {
  started: boolean;
  tabCount: number;
  currentTabIndex: number;
  currentUrl?: string;
  outputDir: string;
  tracingActive: boolean;
}

export interface InteractiveElementRef {
  ref: string;
  role: string;
  name: string;
  tagName: string;
  selector: string;
  description: string;
  disabled: boolean;
  pageIndex: number;
}

export interface SnapshotResult {
  text: string;
  refs: InteractiveElementRef[];
  aria: string;
  fullPath?: string;
}

export interface ConsoleEntry {
  pageId: string;
  pageIndex: number;
  level: "debug" | "info" | "warning" | "error";
  text: string;
  location?: string;
  timestamp: number;
  navigationId: number;
}

export interface NetworkEntry {
  pageId: string;
  pageIndex: number;
  url: string;
  method: string;
  resourceType: string;
  status?: number;
  ok: boolean;
  failureText?: string;
  blockedReason?: string;
  timestamp: number;
  navigationId: number;
}

export interface BrowserArtifactInfo {
  path: string;
  size: number;
  modifiedMs: number;
}

export interface TextResult {
  text: string;
  fullPath?: string;
  details?: Record<string, unknown>;
}
