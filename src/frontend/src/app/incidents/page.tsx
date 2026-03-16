'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { fetchIncidents } from '@/lib/api';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Filter, X, FileText, Upload, ClipboardList } from 'lucide-react';

interface IncidentSummary {
    incident_id: number;
    region_id: number;
    verification_status: string;
    incident_nonsensitive_details: {
        notification_dt: string;
        barangay: string;
        general_category: string;
        alarm_level: string;
    }
}

export default function IncidentsPage() {
    const { role, assignedRegionId, loading: authLoading } = useUserProfile();
    const searchParams = useSearchParams();

    const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
    const [loading, setLoading] = useState(true);

    const categoryFilter = searchParams.get('category');
    const fromFilter = searchParams.get('from');
    const toFilter = searchParams.get('to');
    const regionFilter = searchParams.get('region');

    useEffect(() => {
        if (!authLoading) loadIncidents();
    }, [authLoading, categoryFilter, fromFilter, toFilter, regionFilter, assignedRegionId]);

    const loadIncidents = async () => {
        setLoading(true);
        try {
            const regionId = assignedRegionId ?? (regionFilter ? parseInt(regionFilter) : undefined);
            const data = await fetchIncidents({
                region_id: regionId,
                category: categoryFilter ?? undefined,
                from: fromFilter ?? undefined,
                to: toFilter ?? undefined,
                type: searchParams.get('type') ?? undefined,
            });
            setIncidents((data as IncidentSummary[]) || []);
        } catch (err) {
            console.error("Unexpected error", err);
        } finally {
            setLoading(false);
        }
    };

    const hasFilters = categoryFilter || fromFilter || toFilter || regionFilter;

    if (authLoading) return (
        <div className="p-8 text-center">
            <Loader2 className="animate-spin inline-block" style={{ color: 'var(--text-muted)' }} /> Loading...
        </div>
    );

    return (
        <div className="space-y-6">
            {/* Encoder & Validator Actions */}
            {(role === 'ENCODER' || role === 'VALIDATOR') && (
                <div className="card">
                    <div className="card-header">{role === 'ENCODER' ? 'Encoder' : 'Validator'} Actions</div>
                    <div className="card-body">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <Link href="/incidents/triage" className="group flex items-center gap-3 p-3 rounded-lg border hover:shadow-md hover:border-blue-300 transition-all" style={{ borderColor: 'var(--border-color)' }}>
                                <div className="p-2 bg-amber-100 text-amber-700 rounded-lg group-hover:bg-amber-600 group-hover:text-white transition-colors">
                                    <ClipboardList className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Triage Queue</h4>
                                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Promote citizen reports</p>
                                </div>
                            </Link>

                            {role === 'ENCODER' && (
                                <Link href="/incidents/create" className="group flex items-center gap-3 p-3 rounded-lg border hover:shadow-md hover:border-blue-300 transition-all" style={{ borderColor: 'var(--border-color)' }}>
                                    <div className="p-2 bg-red-100 text-red-700 rounded-lg group-hover:bg-red-600 group-hover:text-white transition-colors">
                                        <FileText className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Manual Entry</h4>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Create single report</p>
                                    </div>
                                </Link>
                            )}

                            {role === 'ENCODER' && (
                                <Link href="/incidents/import" className="group flex items-center gap-3 p-3 rounded-lg border hover:shadow-md hover:border-blue-300 transition-all" style={{ borderColor: 'var(--border-color)' }}>
                                    <div className="p-2 bg-blue-100 text-blue-700 rounded-lg group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                        <Upload className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>Import Data</h4>
                                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Bulk upload (CSV/XLSX)</p>
                                    </div>
                                </Link>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Incidents Table Card */}
            <div className="card overflow-hidden">
                <div className="card-header flex flex-col md:flex-row md:items-center justify-between gap-3">
                    <h2 className="text-base font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
                        Incidents List
                        {assignedRegionId && <span className="text-xs font-normal px-2 py-0.5 rounded bg-gray-100" style={{ color: 'var(--text-secondary)' }}>Region {assignedRegionId}</span>}
                    </h2>

                    {hasFilters && (
                        <div className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }}>
                            <Filter className="w-3 h-3" />
                            <span className="font-medium">Active:</span>
                            {categoryFilter && <span className="bg-white px-1.5 rounded border">{categoryFilter}</span>}
                            {searchParams.get('type') && <span className="bg-white px-1.5 rounded border">{searchParams.get('type')}</span>}
                            {regionFilter && !assignedRegionId && <span className="bg-white px-1.5 rounded border">Region {regionFilter}</span>}
                            {(fromFilter || toFilter) && <span className="bg-white px-1.5 rounded border">{fromFilter || '...'} to {toFilter || '...'}</span>}
                            <Link href="/incidents" className="ml-1 hover:bg-orange-200 rounded p-0.5"><X className="w-3.5 h-3.5" /></Link>
                        </div>
                    )}
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid var(--border-color)' }}>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>ID</th>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Date</th>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Region</th>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Category</th>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Location</th>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Status</th>
                                <th className="p-3 text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm" style={{ color: 'var(--text-primary)' }}>
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center">
                                        <Loader2 className="animate-spin inline-block mb-2 w-5 h-5" style={{ color: 'var(--text-muted)' }} /><br />
                                        <span style={{ color: 'var(--text-muted)' }}>Loading incidents...</span>
                                    </td>
                                </tr>
                            ) : incidents.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center">
                                        <Filter className="w-8 h-8 mx-auto mb-2" style={{ color: 'var(--text-muted)' }} />
                                        <p style={{ color: 'var(--text-secondary)' }}>No incidents found.</p>
                                        {hasFilters && <Link href="/incidents" className="text-xs font-bold hover:underline mt-1 inline-block" style={{ color: 'var(--bfp-maroon)' }}>Clear Filters</Link>}
                                    </td>
                                </tr>
                            ) : (
                                incidents.map((inc) => (
                                    <tr key={inc.incident_id} className="border-b hover:bg-gray-50 transition-colors" style={{ borderColor: 'var(--border-color)' }}>
                                        <td className="p-3 font-mono text-xs">{inc.incident_id}</td>
                                        <td className="p-3 whitespace-nowrap">{new Date(inc.incident_nonsensitive_details.notification_dt).toLocaleDateString()}</td>
                                        <td className="p-3">Region {inc.region_id}</td>
                                        <td className="p-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium 
                                                ${inc.incident_nonsensitive_details.general_category === 'STRUCTURAL' ? 'bg-orange-100 text-orange-800' :
                                                    inc.incident_nonsensitive_details.general_category === 'NON_STRUCTURAL' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                                                {inc.incident_nonsensitive_details.general_category}
                                            </span>
                                        </td>
                                        <td className="p-3">{inc.incident_nonsensitive_details.barangay}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide
                                                ${inc.verification_status === 'VERIFIED' ? 'bg-green-100 text-green-700 border border-green-200' :
                                                    inc.verification_status === 'REJECTED' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}`}>
                                                {inc.verification_status}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <Link href={`/incidents/${inc.incident_id}`}
                                                className="text-xs font-medium px-3 py-1 rounded border hover:bg-gray-50 transition-colors"
                                                style={{ color: 'var(--bfp-maroon)', borderColor: 'var(--border-color)' }}>
                                                View
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="px-4 py-3 text-center text-sm font-medium" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>
                    Showing {incidents.length} records
                </div>
            </div>
        </div>
    );
}
