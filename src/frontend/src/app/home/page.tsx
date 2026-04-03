'use client';

import { useState, useEffect, useCallback } from 'react';
import { useUserProfile } from '@/lib/auth';
import { fetchIncidents } from '@/lib/api';
import Link from 'next/link';
import { Search, MapPin, Building, Users, Flame, CheckCircle } from 'lucide-react';

interface IncidentSummary {
    incident_id: number;
    region_id: number;
    verification_status: string;
    incident_nonsensitive_details: {
        notification_dt: string;
        barangay: string;
        general_category: string;
        alarm_level: string;
        specific_type: string;
        incident_type: string;
    }
}

export default function HomePage() {
    const { assignedRegionId, loading: authLoading } = useUserProfile();
    const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    const loadIncidents = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchIncidents({ region_id: assignedRegionId ?? undefined });
            setIncidents((data as unknown as IncidentSummary[]) || []);
        } catch (err) {
            console.error("Error fetching home incidents", err);
        } finally {
            setLoading(false);
        }
    }, [assignedRegionId]);

    useEffect(() => {
        // eslint-disable react-hooks/set-state-in-effect
        if (!authLoading) loadIncidents();
    }, [authLoading, assignedRegionId, loadIncidents]);

    const nonsensitive = (i: IncidentSummary) => i.incident_nonsensitive_details;
    const ongoingIncidents = incidents.filter(i =>
        ['DRAFT', 'PENDING'].includes(i.verification_status) ||
        (i.verification_status === 'VERIFIED' && new Date(nonsensitive(i).notification_dt).getTime() > Date.now() - 24 * 60 * 60 * 1000)
    ).filter(i =>
        nonsensitive(i).barangay?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        nonsensitive(i).specific_type?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const fireOutIncidents = incidents.filter(i =>
        i.verification_status === 'VERIFIED' || i.verification_status === 'REJECTED'
    ).filter(i =>
        nonsensitive(i).barangay?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        nonsensitive(i).specific_type?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    if (authLoading) return <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>Loading Operations Center...</div>;

    return (
        <div className="space-y-6">
            {/* Search Bar */}
            <div className="card">
                <div className="card-body flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div className="flex items-center gap-3 flex-1 w-full md:max-w-md px-4 py-2.5 rounded-lg" style={{ backgroundColor: '#f3f4f6' }}>
                        <span className="text-xs font-bold tracking-wider uppercase" style={{ color: 'var(--bfp-maroon)' }}>Operations</span>
                        <div className="w-px h-5 bg-gray-300" />
                        <input
                            type="text"
                            placeholder="Search location or type..."
                            className="bg-transparent outline-none flex-1 text-sm placeholder-gray-400"
                            style={{ color: 'var(--text-primary)' }}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="w-4 h-4 text-gray-400" />
                    </div>
                    <Link href="/incidents"
                        className="text-sm font-bold text-white px-5 py-2 rounded-lg transition-colors"
                        style={{ backgroundColor: '#16a34a' }}>
                        View All Logs
                    </Link>
                </div>
            </div>

            {/* Two Column Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* On-Going Column */}
                <div className="card overflow-hidden">
                    <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid #dc2626' }}>
                        <span className="flex items-center gap-2">
                            <Flame className="w-4 h-4 text-red-600" /> ON-GOING
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">{ongoingIncidents.length}</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                        {loading ? <div className="p-8 text-center text-gray-400">Loading...</div> :
                            ongoingIncidents.length === 0 ? <div className="p-8 text-center text-gray-400">No active operations.</div> :
                                ongoingIncidents.map((incident) => (
                                    <IncidentCard key={incident.incident_id} incident={incident} type="ongoing" />
                                ))
                        }
                    </div>
                </div>

                {/* Fire Out Column */}
                <div className="card overflow-hidden">
                    <div className="card-header flex items-center justify-between" style={{ borderLeft: '4px solid #16a34a' }}>
                        <span className="flex items-center gap-2">
                            <CheckCircle className="w-4 h-4 text-green-600" /> FIRE OUT
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-bold">{fireOutIncidents.length}</span>
                    </div>
                    <div className="divide-y" style={{ borderColor: 'var(--border-color)' }}>
                        {loading ? <div className="p-8 text-center text-gray-400">Loading...</div> :
                            fireOutIncidents.length === 0 ? <div className="p-8 text-center text-gray-400">No completed operations found.</div> :
                                fireOutIncidents.map((incident) => (
                                    <IncidentCard key={incident.incident_id} incident={incident} type="fireout" />
                                ))
                        }
                    </div>
                </div>
            </div>
        </div>
    );
}

function IncidentCard({ incident, type }: { incident: IncidentSummary, type: 'ongoing' | 'fireout' }) {
    return (
        <div className="p-4 hover:bg-gray-50 transition-colors text-sm">
            <div className="grid grid-cols-[20px_1fr] gap-2 mb-1">
                <MapPin className={`w-4 h-4 mt-0.5 ${type === 'ongoing' ? 'text-red-500' : 'text-green-500'}`} />
                <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Location</span>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>Region {incident.region_id}, {incident.incident_nonsensitive_details.barangay}</div>
                </div>
            </div>
            <div className="grid grid-cols-[20px_1fr] gap-2 mb-1">
                <Building className="w-4 h-4 text-blue-500 mt-0.5" />
                <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Establishment</span>
                    <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>{incident.incident_nonsensitive_details.specific_type || incident.incident_nonsensitive_details.general_category}</div>
                </div>
            </div>
            <div className="grid grid-cols-[20px_1fr] gap-2 mt-2">
                <Users className="w-4 h-4 mt-0.5" style={{ color: 'var(--text-muted)' }} />
                <div>
                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Alarm Level</span>
                    <div style={{ color: 'var(--text-primary)' }}>{incident.incident_nonsensitive_details.alarm_level}</div>
                </div>
            </div>
            <div className="flex items-center justify-between mt-3 pt-2" style={{ borderTop: '1px solid var(--border-color)' }}>
                <div className="flex items-center gap-2">
                    <div className={`w-2.5 h-2.5 rounded-full ${type === 'ongoing' ? 'bg-orange-500 animate-pulse' : 'bg-green-600'}`} />
                    <span className={`text-xs font-bold ${type === 'ongoing' ? 'text-orange-600' : 'text-green-700'}`}>
                        {type === 'ongoing' ? 'On-Going' : 'Fire Out'}
                    </span>
                </div>
                <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {new Date(incident.incident_nonsensitive_details.notification_dt).toLocaleString()}
                </span>
            </div>
        </div>
    );
}
