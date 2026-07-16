/**
 * DraftManager — auto-save Report Wizard progress to localStorage after each
 * completed step, restore on /report entry, and expire after 24h of
 * inactivity. Issue #613.
 *
 * The draft stores only the wizard field values and the index of the last
 * incomplete step so the user can resume there. No PII beyond what the user
 * typed into the form (description, contact, landmark) — consistent with the
 * existing localStorage usage in the report flow.
 */

export const DRAFT_STORAGE_KEY = 'wims_report_wizard_draft_v1';
export const DRAFT_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ReportDraft {
  /** Step index the user should resume at (0-based). */
  stepIndex: number;
  /** Last saved timestamp (ms epoch) for expiry checks. */
  savedAt: number;
  latitude: number | null;
  longitude: number | null;
  landmark: string;
  photoPresent: boolean;
  category: string | null;
  observables: string[];
  description: string;
  contactName: string;
  contactPhone: string;
  notes: string;
}

export const EMPTY_DRAFT: Omit<ReportDraft, 'stepIndex' | 'savedAt'> = {
  latitude: null,
  longitude: null,
  landmark: '',
  photoPresent: false,
  category: null,
  observables: [],
  description: '',
  contactName: '',
  contactPhone: '',
  notes: '',
};

/** Save the current draft. `stepIndex` is the next step to resume at. */
export function saveDraft(draft: Omit<ReportDraft, 'savedAt'>): void {
  try {
    const record: ReportDraft = { ...draft, savedAt: Date.now() };
    localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // localStorage may be unavailable (private mode / quota) — non-fatal.
  }
}

/** Load a non-expired draft, or null if absent/expired/corrupt. */
export function loadDraft(): ReportDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ReportDraft>;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const savedAt = typeof parsed.savedAt === 'number' ? parsed.savedAt : 0;
    if (Date.now() - savedAt > DRAFT_EXPIRY_MS) {
      clearDraft();
      return null;
    }
    return {
      ...EMPTY_DRAFT,
      ...parsed,
      savedAt,
    } as ReportDraft;
  } catch {
    return null;
  }
}

/** Whether a usable (non-expired) draft exists. */
export function hasDraft(): boolean {
  return loadDraft() !== null;
}

/** Remove the stored draft (on successful submit or "Start fresh"). */
export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}

/** True when the draft is older than the 24h expiry window. */
export function isDraftExpired(draft: ReportDraft): boolean {
  return Date.now() - draft.savedAt > DRAFT_EXPIRY_MS;
}
