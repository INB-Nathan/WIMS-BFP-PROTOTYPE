'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabaseClient';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Loader2, Filter, X, FileText, Upload } from 'lucide-react';

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
    const supabase = createClient();

    // Read filters from URL
    const categoryFilter = searchParams.get('category');
    const fromFilter = searchParams.get('from');
    const toFilter = searchParams.get('to');
    const regionFilter = searchParams.get('region');
    // We can also have a 'status' param if needed

    useEffect(() => {
        if (!authLoading) {
            fetchIncidents();
        }
    }, [authLoading, categoryFilter, fromFilter, toFilter, regionFilter, assignedRegionId]);

    const fetchIncidents = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('fire_incidents')
                .select(`
                    incident_id,
                    region_id,
                    verification_status,
                    incident_nonsensitive_details!inner (
                        notification_dt,
                        barangay,
                        general_category,
                        alarm_level
                    )
                `)
                .order('incident_id', { ascending: false })
                .limit(100); // Increased limit for visibility

            // 1. Role-based Region Lock
            if (assignedRegionId) {
                query = query.eq('region_id', assignedRegionId);
            } else if (regionFilter) {
                // If not locked to a region, allow filter
                query = query.eq('region_id', parseInt(regionFilter));
            }

            // 2. Category Filter (Inner Join filter)
            if (categoryFilter) {
                query = query.eq('incident_nonsensitive_details.general_category', categoryFilter);
            }

            // 2.1 Sub-Type Filter (e.g. "Apartment Building")
            // We'll search across multiple fields (incident_type, sub_category, specific_type) since mapping isn't strict in mock
            const typeFilter = searchParams.get('type');
            if (typeFilter) {
                // Construct a text search or exact match on multiple columns if possible. 
                // For now, simpler exact match on occupancy_type or general_category extension
                // NOTE: PostgREST OR syntax on joined tables can be tricky.
                // Let's assume simpler: filter on `incident_type` or `occupancy_type`
                // Since these are in `incident_nonsensitive_details`, we need to use the relationship alias if present, 
                // or apply standard filters. However, Supabase complex filtering on joined tables often requires 
                // !inner join which we have.
                // Let's try matching `specific_type` or `occupancy_type`
                query = query.eq('incident_nonsensitive_details.incident_type', typeFilter);
            }

            // 3. Date Filters
            if (fromFilter) {
                query = query.gte('incident_nonsensitive_details.notification_dt', fromFilter);
            }
            if (toFilter) {
                // Add time to include the full end day
                query = query.lte('incident_nonsensitive_details.notification_dt', `${toFilter}T23:59:59`);
            }

            const { data, error } = await query;

            if (error) {
                console.error("Error fetching incidents", error);
            } else {
                setIncidents(data as any);
            }
        } catch (err) {
            console.error("Unexpected error", err);
        } finally {
            setLoading(false);
        }
    };

    const hasFilters = categoryFilter || fromFilter || toFilter || regionFilter;

    if (authLoading) return <div className="p-8 text-center"><Loader2 className="animate-spin inline-block" /> Loading...</div>;

    return (
        <div className="space-y-6">

            {/* Encoder Actions (Accessible here too) */}
            {role === 'ENCODER' && (
                <div className="p-6 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="text-lg font-bold text-blue-900 mb-4">Encoder Actions</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Manual Entry Card */}
                        <Link href="/incidents/create" className="group block bg-white p-4 rounded-lg shadow-sm border border-blue-100 hover:shadow-md hover:border-blue-300 transition-all">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-100 text-red-700 rounded-full group-hover:bg-red-600 group-hover:text-white transition-colors">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-gray-800">Manual Entry</h4>
                                    <p className="text-xs text-gray-600">Create single report</p>
                                </div>
                            </div>
                        </Link>

                        {/* Import Data Card */}
                        <Link href="/incidents/import" className="group block bg-white p-4 rounded-lg shadow-sm border border-blue-100 hover:shadow-md hover:border-blue-300 transition-all">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-blue-100 text-blue-700 rounded-full group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                    <Upload className="w-5 h-5" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-gray-800">Import Data</h4>
                                    <p className="text-xs text-gray-600">Bulk upload (CSV/XLSX)</p>
                                </div>
                            </div>
                        </Link>
                    </div>
                </div>
            )}

            <div className="bg-white p-6 rounded shadow space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <h2 className="text-xl font-bold flex items-center gap-2 text-gray-900">
                        Incidents List
                        {assignedRegionId && <span className="text-sm font-normal text-gray-500 bg-gray-100 px-2 py-1 rounded">Region {assignedRegionId}</span>}
                    </h2>

                    {/* Active Filters Display */}
                    {hasFilters && (
                        <div className="flex items-center gap-2 text-sm bg-red-50 text-red-800 px-3 py-1.5 rounded border border-red-100">
                            <Filter className="w-3 h-3" />
                            <span className="font-medium">Active Filters:</span>
                            <div className="flex gap-2">
                                {categoryFilter && <span className="bg-white px-1.5 rounded border border-red-200">{categoryFilter}</span>}
                                {searchParams.get('type') && <span className="bg-white px-1.5 rounded border border-red-200">{searchParams.get('type')}</span>}
                                {regionFilter && !assignedRegionId && <span className="bg-white px-1.5 rounded border border-red-200">Region {regionFilter}</span>}
                                {(fromFilter || toFilter) && <span className="bg-white px-1.5 rounded border border-red-200">{fromFilter || '...'} to {toFilter || '...'}</span>}
                            </div>
                            <Link href="/incidents" className="ml-2 hover:bg-red-200 rounded p-0.5">
                                <X className="w-4 h-4" />
                            </Link>
                        </div>
                    )}
                </div>

                <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-200 text-black border-b-2 border-gray-400 uppercase text-xs font-black tracking-wider rounded-t-lg">
                            <tr>
                                <th className="p-3 border-r border-gray-300">ID</th>
                                <th className="p-3 border-r border-gray-300">Date</th>
                                <th className="p-3 border-r border-gray-300">Region</th>
                                <th className="p-3 border-r border-gray-300">Category</th>
                                <th className="p-3 border-r border-gray-300">Location</th>
                                <th className="p-3 border-r border-gray-300">Status</th>
                                <th className="p-3">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="text-sm text-gray-900 font-medium">
                            {loading ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-900 font-bold">
                                        <Loader2 className="animate-spin inline-block mb-2 w-6 h-6 text-black" /> <br />
                                        Loading incidents...
                                    </td>
                                </tr>
                            ) : incidents.length === 0 ? (
                                <tr>
                                    <td colSpan={7} className="p-8 text-center text-gray-900 font-bold bg-gray-50/50">
                                        <div className="flex flex-col items-center justify-center">
                                            <Filter className="w-8 h-8 text-gray-700 mb-2" />
                                            <p>No incidents found matching current filters.</p>
                                            {hasFilters && <Link href="/incidents" className="text-red-700 font-black hover:underline mt-1 text-xs">Clear Filters</Link>}
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                incidents.map((inc) => (
                                    <tr key={inc.incident_id} className="border-b border-gray-300 hover:bg-gray-100 transition-colors">
                                        <td className="p-3 font-mono text-xs">{inc.incident_id}</td>
                                        <td className="p-3 whitespace-nowrap">
                                            {new Date(inc.incident_nonsensitive_details.notification_dt).toLocaleDateString()}
                                        </td>
                                        <td className="p-3">Region {inc.region_id}</td>
                                        <td className="p-3">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium 
                                            ${inc.incident_nonsensitive_details.general_category === 'STRUCTURAL' ? 'bg-orange-100 text-orange-800' :
                                                    inc.incident_nonsensitive_details.general_category === 'NON_STRUCTURAL' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}
                                        `}>
                                                {inc.incident_nonsensitive_details.general_category}
                                            </span>
                                        </td>
                                        <td className="p-3">{inc.incident_nonsensitive_details.barangay}</td>
                                        <td className="p-3">
                                            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide
                                            ${inc.verification_status === 'VERIFIED' ? 'bg-green-100 text-green-700 border border-green-200' :
                                                    inc.verification_status === 'REJECTED' ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-yellow-100 text-yellow-700 border border-yellow-200'}
                                        `}>
                                                {inc.verification_status}
                                            </span>
                                        </td>
                                        <td className="p-3">
                                            <Link href={`/incidents/${inc.incident_id}`} className="text-red-600 hover:text-red-800 font-medium text-xs border border-red-200 px-3 py-1 rounded hover:bg-red-50">
                                                View Details
                                            </Link>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                <div className="text-sm text-black font-bold text-center pt-2">
                    Showing last {incidents.length} records.
                </div>
            </div>
        </div>
    );
}
