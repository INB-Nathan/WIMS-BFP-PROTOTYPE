'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  FileText,
  AlertTriangle,
  Shield,
  Upload,
  Globe,
  Eye,
  EyeOff,
} from 'lucide-react';

// ── Types
type Urgency = 'urgent' | 'advisory' | 'general';
type Severity = 'critical' | 'high' | 'moderate' | 'low';
type EmergencyStatus = 'ongoing' | 'contained' | 'monitoring' | 'resolved';

interface Announcement {
  id: number;
  title: string;
  body: string;
  urgency: Urgency;
  image_path: string | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

interface Emergency {
  id: number;
  title: string;
  location: string;
  description: string;
  severity: Severity;
  status: EmergencyStatus;
  promoted_from_incident_id: number | null;
  published: boolean;
  published_at: string | null;
  created_at: string;
}

type TabType = 'announcements' | 'emergencies';

// ── Form modal component
function FormModal({
  open,
  onClose,
  onSave,
  title,
  children,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSave: () => void;
  title: string;
  children: React.ReactNode;
  loading: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">✕</button>
        </div>
        <div className="px-6 py-4 space-y-4">{children}</div>
        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">Cancel</button>
          <button
            onClick={onSave}
            disabled={loading}
            className="px-4 py-2 text-sm rounded-lg text-white font-medium"
            style={{ backgroundColor: 'var(--bfp-maroon, #C62828)' }}
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin inline" /> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminInformationPage() {
  const { user } = useAuth();
  const router = useRouter();
  const role = (user as { role?: string })?.role;

  const [tab, setTab] = useState<TabType>('announcements');
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [emergencies, setEmergencies] = useState<Emergency[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<Announcement | Emergency | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formUrgency, setFormUrgency] = useState<Urgency>('general');
  const [formSeverity, setFormSeverity] = useState<Severity>('moderate');
  const [formStatus, setFormStatus] = useState<EmergencyStatus>('ongoing');
  const [formLocation, setFormLocation] = useState('');
  const [formPublished, setFormPublished] = useState(false);
  const [formImage, setFormImage] = useState<File | null>(null);
  const [formImagePreview, setFormImagePreview] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'SYSTEM_ADMIN') { router.replace('/dashboard'); return; }
  }, [role, router]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [annRes, emRes] = await Promise.all([
        fetch('/api/admin/information/announcements'),
        fetch('/api/admin/information/emergencies'),
      ]);
      if (annRes.ok) setAnnouncements(await annRes.json());
      if (emRes.ok) setEmergencies(await emRes.json());
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openCreate = (t: TabType) => {
    setEditing(null);
    setFormTitle('');
    setFormBody('');
    setFormUrgency('general');
    setFormSeverity('moderate');
    setFormStatus('ongoing');
    setFormLocation('');
    setFormPublished(false);
    setFormImage(null);
    setFormImagePreview(null);
    setModalOpen(true);
  };

  const openEdit = (item: Announcement | Emergency, t: TabType) => {
    setEditing(item);
    setFormTitle(item.title);
    setFormBody('body' in item ? item.body : '');
    setFormUrgency('urgency' in item ? item.urgency : 'general');
    setFormSeverity('severity' in item ? item.severity : 'moderate');
    setFormStatus('status' in item ? item.status : 'ongoing');
    setFormLocation('location' in item ? item.location : '');
    setFormPublished(item.published);
    setFormImage(null);
    setFormImagePreview('image_path' in item && item.image_path ? item.image_path : null);
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const isAnnouncement = tab === 'announcements';
      const endpoint = isAnnouncement
        ? '/api/admin/information/announcements'
        : '/api/admin/information/emergencies';
      const method = editing ? 'PUT' : 'POST';
      const url = editing ? `${endpoint}/${editing.id}` : endpoint;

      const body: Record<string, unknown> = isAnnouncement
        ? { title: formTitle, body: formBody, urgency: formUrgency, published: formPublished }
        : { title: formTitle, description: formBody, location: formLocation, severity: formSeverity, status: formStatus, published: formPublished };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error('Save failed');
      toast.success(editing ? 'Updated' : 'Created');
      setModalOpen(false);
      fetchData();
    } catch { toast.error('Failed to save'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number, t: TabType) => {
    if (!confirm('Delete this item?')) return;
    try {
      const endpoint = t === 'announcements'
        ? `/api/admin/information/announcements/${id}`
        : `/api/admin/information/emergencies/${id}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success('Deleted');
      fetchData();
    } catch { toast.error('Failed to delete'); }
  };

  const urgencyColor = (u: Urgency) =>
    u === 'urgent' ? 'text-red-600 bg-red-50' : u === 'advisory' ? 'text-orange-600 bg-orange-50' : 'text-blue-600 bg-blue-50';

  const severityColor = (s: Severity) =>
    s === 'critical' ? 'text-red-700 bg-red-100' : s === 'high' ? 'text-orange-700 bg-orange-100' : s === 'moderate' ? 'text-yellow-700 bg-yellow-100' : 'text-green-700 bg-green-100';

  if (role !== 'SYSTEM_ADMIN') return null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--bfp-maroon, #C62828)' }}>Information Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage announcements and emergencies for the civilian feed</p>
        </div>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-600">SYSTEM ADMIN</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b">
        {(['announcements', 'emergencies'] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              tab === t ? 'border-red-600 text-red-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'announcements' ? <FileText className="w-4 h-4 inline mr-1" /> : <AlertTriangle className="w-4 h-4 inline mr-1" />}
            {t}
          </button>
        ))}
      </div>

      {/* Create button */}
      <div className="mb-4">
        <button
          onClick={() => openCreate(tab)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg"
          style={{ backgroundColor: 'var(--bfp-maroon, #C62828)' }}
        >
          <Plus className="w-4 h-4" />
          {tab === 'announcements' ? 'New Announcement' : 'New Emergency'}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--bfp-maroon, #C62828)' }} />
        </div>
      ) : tab === 'announcements' ? (
        <div className="space-y-3">
          {announcements.map((a) => (
            <div key={a.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium truncate">{a.title}</h4>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${urgencyColor(a.urgency)}`}>{a.urgency}</span>
                  {a.published ? <Eye className="w-4 h-4 text-green-500" title="Published" /> : <EyeOff className="w-4 h-4 text-gray-400" title="Draft" />}
                </div>
                <p className="text-sm text-gray-500 truncate mt-1">{a.body.slice(0, 100)}</p>
                {a.image_path && <span className="text-xs text-blue-500 mt-1"><Upload className="w-3 h-3 inline mr-1" />Has image</span>}
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button onClick={() => openEdit(a, 'announcements')} className="p-2 text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(a.id, 'announcements')} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {announcements.length === 0 && <p className="text-center py-8 text-gray-400">No announcements yet</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {emergencies.map((e) => (
            <div key={e.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium truncate">{e.title}</h4>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${severityColor(e.severity)}`}>{e.severity}</span>
                  <span className="text-xs text-gray-500">{e.status}</span>
                  {e.published ? <Eye className="w-4 h-4 text-green-500" /> : <EyeOff className="w-4 h-4 text-gray-400" />}
                </div>
                <p className="text-sm text-gray-500 truncate mt-1">{e.location} — {e.description.slice(0, 80)}</p>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button onClick={() => openEdit(e, 'emergencies')} className="p-2 text-gray-400 hover:text-gray-600"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(e.id, 'emergencies')} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
          {emergencies.length === 0 && <p className="text-center py-8 text-gray-400">No emergencies yet</p>}
        </div>
      )}

      {/* Form Modal */}
      <FormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSave={handleSave}
        title={editing ? `Edit ${tab === 'announcements' ? 'Announcement' : 'Emergency'}` : `New ${tab === 'announcements' ? 'Announcement' : 'Emergency'}`}
        loading={saving}
      >
        <label className="block">
          <span className="text-sm font-medium">Title *</span>
          <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" />
        </label>

        {tab === 'announcements' ? (
          <>
            <label className="block">
              <span className="text-sm font-medium">Body *</span>
              <textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} rows={4} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Urgency</span>
              <select value={formUrgency} onChange={(e) => setFormUrgency(e.target.value as Urgency)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                <option value="general">General</option>
                <option value="advisory">Advisory</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="block">
              <span className="text-sm font-medium">Image (JPEG/PNG, optional)</span>
              <input type="file" accept="image/jpeg,image/png" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) { setFormImage(f); setFormImagePreview(URL.createObjectURL(f)); }
              }} className="w-full mt-1 text-sm" />
              {formImagePreview && <img src={formImagePreview} alt="Preview" className="mt-2 max-h-32 rounded" />}
            </label>
          </>
        ) : (
          <>
            <label className="block">
              <span className="text-sm font-medium">Location *</span>
              <input value={formLocation} onChange={(e) => setFormLocation(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Description *</span>
              <textarea value={formBody} onChange={(e) => setFormBody(e.target.value)} rows={4} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm" />
            </label>
            <div className="flex gap-3">
              <label className="flex-1">
                <span className="text-sm font-medium">Severity</span>
                <select value={formSeverity} onChange={(e) => setFormSeverity(e.target.value as Severity)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="moderate">Moderate</option>
                  <option value="low">Low</option>
                </select>
              </label>
              <label className="flex-1">
                <span className="text-sm font-medium">Status</span>
                <select value={formStatus} onChange={(e) => setFormStatus(e.target.value as EmergencyStatus)} className="w-full mt-1 px-3 py-2 border rounded-lg text-sm">
                  <option value="ongoing">Ongoing</option>
                  <option value="contained">Contained</option>
                  <option value="monitoring">Monitoring</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
            </div>
          </>
        )}

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={formPublished} onChange={(e) => setFormPublished(e.target.checked)} className="rounded" />
          <span className="text-sm font-medium">Published {formPublished ? <Globe className="w-3 h-3 inline text-green-500" /> : null}</span>
        </label>
      </FormModal>
    </div>
  );
}
