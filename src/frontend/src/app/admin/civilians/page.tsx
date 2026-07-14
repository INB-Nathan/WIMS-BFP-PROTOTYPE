'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Search,
  XCircle,
  CheckCircle,
  Shield,
  UserX,
  UserCheck,
  History,
  Loader2,
} from 'lucide-react';

interface Civilian {
  user_id: string;
  keycloak_id: string;
  name: string;
  email: string | null;
  trust_score: number;
  badge: string;
  status: 'active' | 'suspended';
  report_count: number;
  last_active: string | null;
  date_added: string;
}

export default function AdminCiviliansPage() {
  const { user } = useAuth();
  const router = useRouter();
  const role = (user as { role?: string })?.role;

  const [civilians, setCivilians] = useState<Civilian[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    if (role !== 'SYSTEM_ADMIN') {
      router.replace('/dashboard');
      return;
    }
  }, [role, router]);

  const fetchCivilians = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await fetch(`/api/admin/civilians?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setCivilians(data.civilians || data || []);
    } catch {
      toast.error('Failed to load civilians');
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    fetchCivilians();
  }, [fetchCivilians]);

  const toggleStatus = async (userId: string, currentStatus: string) => {
    const action = currentStatus === 'suspended' ? 'activate' : 'suspend';
    if (action === 'suspend' && !confirm('Suspend this reporter? They will be unable to submit reports.')) {
      return;
    }
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/admin/civilians/${userId}/${action}`, { method: 'POST' });
      if (!res.ok) throw new Error('Action failed');
      toast.success(action === 'suspend' ? 'Reporter suspended' : 'Reporter activated');
      fetchCivilians();
    } catch {
      toast.error('Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  const badgeColor = (badge: string) => {
    switch (badge) {
      case 'GUARDIAN': return 'text-purple-600 bg-purple-50';
      case 'TRUSTED': return 'text-green-600 bg-green-50';
      case 'REGULAR': return 'text-blue-600 bg-blue-50';
      default: return 'text-gray-500 bg-gray-50';
    }
  };

  if (role !== 'SYSTEM_ADMIN') return null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--bfp-maroon, #C62828)' }}>Civilian Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage civilian reporter accounts</p>
        </div>
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-medium text-gray-600">SYSTEM ADMIN</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-200"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg text-sm"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--bfp-maroon, #C62828)' }} />
        </div>
      ) : civilians.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <UserX className="w-12 h-12 mx-auto mb-3 text-gray-300" />
          <p className="text-lg font-medium">No civilian reporters found</p>
          <p className="text-sm">Try adjusting your search or filter</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 font-medium text-gray-600">Trust</th>
                <th className="px-4 py-3 font-medium text-gray-600">Badge</th>
                <th className="px-4 py-3 font-medium text-gray-600">Reports</th>
                <th className="px-4 py-3 font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {civilians.map((c) => (
                <tr key={c.user_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{c.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="font-mono font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {c.trust_score}
                    </span>
                    <span className="text-gray-400 text-xs">/100</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor(c.badge)}`}>
                      {c.badge}
                    </span>
                  </td>
                  <td className="px-4 py-3">{c.report_count}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                      c.status === 'active' ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'
                    }`}>
                      {c.status === 'active' ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : (
                        <XCircle className="w-3 h-3" />
                      )}
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleStatus(c.user_id, c.status)}
                        disabled={actionLoading === c.user_id}
                        className={`text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                          c.status === 'suspended'
                            ? 'bg-green-50 text-green-700 hover:bg-green-100'
                            : 'bg-red-50 text-red-700 hover:bg-red-100'
                        }`}
                      >
                        {actionLoading === c.user_id ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : c.status === 'suspended' ? (
                          <><UserCheck className="w-3 h-3 inline mr-1" />Activate</>
                        ) : (
                          <><UserX className="w-3 h-3 inline mr-1" />Suspend</>
                        )}
                      </button>
                      <button
                        onClick={() => router.push(`/admin/civilians/${c.user_id}/audit`)}
                        className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100"
                        title="View audit trail"
                      >
                        <History className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
