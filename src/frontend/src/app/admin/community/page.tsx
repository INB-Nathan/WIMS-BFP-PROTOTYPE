'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { type CommunityContentType } from '@/lib/api/community';
import {
  archiveCommunityContent, createCommunityDraft, fetchAdminCommunityContent,
  publishCommunityContent, updateCommunityDraft, type CommunityContentAdminItem,
  type CommunityDraftPayload,
} from '@/lib/api/adminCommunity';
import { ApiRequestError } from '@/lib/api/transport';

type Draft = CommunityContentAdminItem | (CommunityDraftPayload & { content_id: string; lifecycle_status: string });
const emptyForm: CommunityDraftPayload = { content_type: 'SAFETY_ARTICLE', title_en: '', body_en: '', title_uk: '', body_uk: '', slug: '', expires_at: '', urgent_banner: false, metadata_json: null, last_reviewed_at: '' };

export default function CommunityAdminPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === 'SYSTEM_ADMIN';
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<Draft | null>(null);
  const [form, setForm] = useState<CommunityDraftPayload>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [metadataText, setMetadataText] = useState('');
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  useEffect(() => {
    if (!isAdmin) { setLoading(false); return; }
    setLoading(true); setLoadError(null);
    fetchAdminCommunityContent()
      .then((items) => setDrafts(items))
      .catch((error) => {
        const text = error instanceof Error ? error.message : 'Unable to load community content.';
        setLoadError(text);
      })
      .finally(() => setLoading(false));
  }, [isAdmin]);

  const setField = (key: keyof CommunityDraftPayload, value: unknown) => setForm((old) => ({ ...old, [key]: value }));
  useEffect(() => {
    setMetadataText(form.metadata_json ? JSON.stringify(form.metadata_json, null, 2) : '');
  }, [form.metadata_json]);

  const normalizedPayload = () => ({
    ...form,
    // Blank optional localized fields become explicit nulls: null clears an
    // existing backend value, while omission means "leave unchanged" for PATCH.
    title_uk: form.title_uk?.trim() || null,
    body_uk: form.body_uk?.trim() || null,
    expires_at: form.expires_at || null,
    last_reviewed_at: form.last_reviewed_at || null,
  });
  const showError = (error: unknown) => {
    const text = error instanceof ApiRequestError && error.status === 409
      ? 'This content changed elsewhere (conflict 409). Reload the latest draft before trying again.'
      : error instanceof Error ? error.message : 'The request could not be completed.';
    setMessage({ type: 'error', text });
  };

  const save = async (action: 'draft' | 'publish' | 'archive') => {
    if (!isAdmin) return;
    setBusy(true); setMessage(null);
    try {
      let result: { content_id: string; lifecycle_status: string };
      let parsedMetadata: Record<string, unknown> | null = null;
      if (metadataText.trim()) {
        try {
          const parsed: unknown = JSON.parse(metadataText);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Metadata must be a JSON object.');
          parsedMetadata = parsed as Record<string, unknown>;
        } catch (error) {
          setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Metadata must be valid JSON.' });
          return;
        }
      }
      const payload = { ...normalizedPayload(), metadata_json: parsedMetadata };
      if (action === 'draft') {
        result = selected
          ? await updateCommunityDraft(selected.content_id, Object.fromEntries(
            Object.entries(payload).filter(([key]) => key !== 'content_type'),
          ) as Omit<CommunityDraftPayload, 'content_type'>)
          : await createCommunityDraft(payload);
        const id = result.content_id;
        const draft = { ...form, content_id: id, lifecycle_status: result.lifecycle_status };
        setDrafts((old) => old.some((item) => item.content_id === id) ? old.map((item) => item.content_id === id ? draft : item) : [...old, draft]);
        setSelected(draft); setMessage({ type: 'success', text: 'Draft saved.' });
      } else if (action === 'publish') {
        if (!selected) return;
        const publishFields = {
          title_en: form.title_en, body_en: form.body_en, title_uk: form.title_uk, body_uk: form.body_uk,
          metadata_json: payload.metadata_json, urgent_banner: form.urgent_banner,
          expires_at: payload.expires_at, last_reviewed_at: payload.last_reviewed_at,
        };
        result = await publishCommunityContent(selected.content_id, publishFields);
        setDrafts((old) => old.map((item) => item.content_id === selected.content_id ? { ...item, lifecycle_status: result.lifecycle_status } : item));
        setMessage({ type: 'success', text: 'Content published.' });
      } else {
        if (!selected) return;
        result = await archiveCommunityContent(selected.content_id);
        setDrafts((old) => old.map((item) => item.content_id === selected.content_id ? { ...item, lifecycle_status: result.lifecycle_status } : item));
        setMessage({ type: 'success', text: 'Content archived.' });
      }
    } catch (error) { showError(error); } finally { setBusy(false); }
  };

  if (authLoading || loading) return <main className="mx-auto max-w-5xl p-6" aria-busy="true"><p role="status">Loading Community Safety Hub CMS…</p></main>;
  if (!isAdmin) return <main className="mx-auto max-w-5xl p-6"><p role="status">Access restricted.</p></main>;
  if (loadError) return <main className="mx-auto max-w-5xl p-6"><p role="alert">{loadError}</p></main>;

  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <header><h1 className="text-2xl font-bold">Community Safety Hub CMS</h1><p className="mt-1 text-sm text-gray-600">Manage plain-text safety content. Server authorization remains authoritative.</p></header>
    {message && <p role="alert" className={message.type === 'error' ? 'rounded border border-red-300 p-3 text-red-700' : 'rounded border border-green-300 p-3 text-green-700'}>{message.text}</p>}
    <div className="grid gap-6 lg:grid-cols-[18rem_1fr]">
      <aside aria-label="Content list" className="rounded border p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Content</h2><button type="button" className="rounded border px-2 py-1 text-sm" onClick={() => { setSelected(null); setForm(emptyForm); setMessage(null); }}>New</button></div>
        {drafts.length === 0 ? <p className="text-sm text-gray-600">No community content yet.</p> : <ul className="space-y-2">{drafts.map((draft) => <li key={draft.content_id}><button type="button" className="w-full rounded border p-2 text-left" onClick={() => { setSelected(draft); setForm(draft); }}>{draft.title_en || 'Untitled'} <span className="block text-xs text-gray-500">{draft.lifecycle_status}</span></button></li>)}</ul>}
      </aside>
      <form className="space-y-4 rounded border p-5" onSubmit={(event) => { event.preventDefault(); void save('draft'); }}>
        <h2 className="text-lg font-semibold">{selected ? 'Edit content' : 'Create draft'}</h2>
        <label className="block text-sm font-medium">Content type<select aria-label="Content type" className="mt-1 block w-full rounded border p-2" value={form.content_type} onChange={(e) => setField('content_type', e.target.value as CommunityContentType)}><option value="SAFETY_ARTICLE">Safety article</option><option value="ANNOUNCEMENT">Announcement</option><option value="EVENT">Event</option></select></label>
        {([['title_en','English title'],['title_uk','Ukrainian title'],['slug','Slug']] as const).map(([key,label]) => <label key={key} className="block text-sm font-medium">{label}<input required={key === 'title_en'} className="mt-1 block w-full rounded border p-2" value={String(form[key] ?? '')} onChange={(e) => setField(key, e.target.value)} /></label>)}
        {([['body_en','English body'],['body_uk','Ukrainian body']] as const).map(([key,label]) => <label key={key} className="block text-sm font-medium">{label}<textarea required={key === 'body_en'} rows={5} className="mt-1 block w-full rounded border p-2" value={String(form[key] ?? '')} onChange={(e) => setField(key, e.target.value)} /></label>)}
        <label className="block text-sm font-medium">Metadata JSON<textarea aria-label="Metadata JSON" rows={3} className="mt-1 block w-full rounded border p-2 font-mono text-sm" value={metadataText} onChange={(e) => setMetadataText(e.target.value)} /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Expires at<input type="datetime-local" className="mt-1 block w-full rounded border p-2" value={String(form.expires_at ?? '')} onChange={(e) => setField('expires_at', e.target.value)} /></label><label className="text-sm font-medium">Last reviewed at<input type="datetime-local" className="mt-1 block w-full rounded border p-2" value={String(form.last_reviewed_at ?? '')} onChange={(e) => setField('last_reviewed_at', e.target.value)} /></label></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(form.urgent_banner)} onChange={(e) => setField('urgent_banner', e.target.checked)} /> Urgent banner</label>
        <div className="flex flex-wrap gap-2"><button disabled={busy} className="rounded bg-blue-700 px-4 py-2 text-white" type="submit">{busy ? 'Saving…' : 'Save draft'}</button>{selected && <><button disabled={busy} type="button" className="rounded bg-green-700 px-4 py-2 text-white" onClick={() => void save('publish')}>Publish</button><button disabled={busy} type="button" className="rounded border border-red-600 px-4 py-2 text-red-700" onClick={() => void save('archive')}>Archive</button></>}</div>
        <section aria-label="Plain text preview" className="rounded bg-gray-50 p-4"><h3 className="font-semibold">Preview</h3><h4 className="mt-2 font-bold">{form.title_en || 'Untitled'}</h4><p className="whitespace-pre-wrap">{form.body_en || 'No body yet.'}</p></section>
      </form>
    </div>
  </main>;
}
