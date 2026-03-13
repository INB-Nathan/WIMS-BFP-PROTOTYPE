'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabaseClient';
import Link from 'next/link';
import { Search, MapPin, Building, Users } from 'lucide-react';

// Types
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
    const { role, assignedRegionId, loading: authLoading } = useUserProfile();
    const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const supabase = createClient();

    useEffect(() => {
        if (!authLoading) {
            fetchIncidents();
        }
    }, [authLoading, assignedRegionId]);

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
                        alarm_level,
                        specific_type,
                        incident_type
                    )
                `)
                .order('created_at', { ascending: false })
                .limit(50);

            // Region Filter
            if (assignedRegionId) {
                query = query.eq('region_id', assignedRegionId);
            }

            const { data, error } = await query;
            if (error) throw error;
            setIncidents(data as any || []);

        } catch (err) {
            console.error("Error fetching home incidents", err);
        } finally {
            setLoading(false);
        }
    };

    // Filter Logic
    // Ongoing: Status is NOT Verified/Rejected, OR explicitly 'ONGOING' if we had that field. 
    // Using verification_status as proxy: DRAFT, PENDING = Ongoing. VERIFIED = Fire Out (for now).
    const ongoingIncidents = incidents.filter(i =>
        ['DRAFT', 'PENDING'].includes(i.verification_status) ||
        (i.verification_status === 'VERIFIED' && new Date(i.incident_nonsensitive_details.notification_dt).getTime() > Date.now() - 24 * 60 * 60 * 1000) // "Recent" verified
        // This logic is a bit loose, but fits the mock requirement. Ideally we'd have a status field.
    ).filter(i =>
        i.incident_nonsensitive_details.barangay.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.incident_nonsensitive_details.specific_type?.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const fireOutIncidents = incidents.filter(i =>
        i.verification_status === 'VERIFIED' || i.verification_status === 'REJECTED' // Assuming Rejected also means closed/done
    ).filter(i =>
        i.incident_nonsensitive_details.barangay.toLowerCase().includes(searchTerm.toLowerCase()) ||
        i.incident_nonsensitive_details.specific_type?.toLowerCase().includes(searchTerm.toLowerCase())
    );


    if (authLoading) return <div className="p-8 text-center text-gray-500">Loading Operations Center...</div>;

    return (
        <div className="flex flex-col min-h-[calc(100vh-8rem)]">
            {/* No Sidebar per request */}

            {/* Main Content Area */}
            <div className="flex-1 bg-white p-6 overflow-y-auto">

                {/* Header / Search */}
                <div className="flex flex-col md:flex-row gap-4 mb-8 justify-between items-center bg-gray-50 p-4 rounded-lg shadow-sm border">
                    <div className="flex items-center gap-2 bg-gray-200 px-4 py-2 rounded-full w-full md:max-w-md">
                        <span className="font-bold text-sm text-red-700 whitespace-nowrap">OPERATIONS</span>
                        <span className="text-gray-400">|</span>
                        <input
                            type="text"
                            placeholder="Search location or type..."
                            className="bg-transparent outline-none flex-1 text-sm text-gray-900 placeholder-gray-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        <Search className="w-4 h-4 text-gray-500" />
                    </div>

                    <Link href="/incidents" className="bg-green-600 text-white px-6 py-2 rounded-full font-bold shadow hover:bg-green-700 transition text-sm">
                        View All Logs
                    </Link>
                </div>

                {/* Lists Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                    {/* On-Going Column (RED) */}
                    <div>
                        <div className="bg-red-700 text-white font-bold py-2 px-4 rounded-t-lg flex justify-between items-center shadow-md">
                            <span>ON-GOING</span>
                            <span className="bg-white text-red-700 text-xs px-2 py-0.5 rounded-full font-bold">{ongoingIncidents.length}</span>
                        </div>
                        <div className="border border-red-200 rounded-b-lg p-4 space-y-4 bg-red-50/50 min-h-[400px]">
                            {loading ? <div className="text-center py-10 text-gray-400">Loading...</div> :
                                ongoingIncidents.length === 0 ? <div className="text-center py-10 text-gray-400">No active operations.</div> :
                                    ongoingIncidents.map((incident) => (
                                        <IncidentCard key={incident.incident_id} incident={incident} type="ongoing" />
                                    ))
                            }
                        </div>
                    </div>

                    {/* Fire Out Column (GREEN) */}
                    <div>
                        <div className="bg-green-700 text-white font-bold py-2 px-4 rounded-t-lg flex justify-between items-center shadow-md">
                            <span>FIRE OUT</span>
                            <span className="bg-white text-green-700 text-xs px-2 py-0.5 rounded-full font-bold">{fireOutIncidents.length}</span>
                        </div>
                        <div className="border border-green-200 rounded-b-lg p-4 space-y-4 bg-green-50/50 min-h-[400px]">
                            {loading ? <div className="text-center py-10 text-gray-400">Loading...</div> :
                                fireOutIncidents.length === 0 ? <div className="text-center py-10 text-gray-400">No completed operations found.</div> :
                                    fireOutIncidents.map((incident) => (
                                        <IncidentCard key={incident.incident_id} incident={incident} type="fireout" />
                                    ))
                            }
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}

function IncidentCard({ incident, type }: { incident: IncidentSummary, type: 'ongoing' | 'fireout' }) {
    return (
        <div className="bg-white border text-gray-800 border-gray-200 rounded-lg p-4 shadow-sm hover:shadow-md transition text-sm">
            <div className="grid grid-cols-[20px_1fr] gap-2 mb-1">
                <MapPin className={`w-4 h-4 mt-0.5 ${type === 'ongoing' ? 'text-red-600' : 'text-green-600'}`} />
                <div>
                    <span className="font-semibold text-gray-500 text-xs uppercase">Location:</span>
                    <div className="font-bold">Region {incident.region_id}, {incident.incident_nonsensitive_details.barangay}</div>
                </div>
            </div>
            <div className="grid grid-cols-[20px_1fr] gap-2 mb-1">
                <Building className="w-4 h-4 text-blue-600 mt-0.5" />
                <div>
                    <span className="font-semibold text-gray-500 text-xs uppercase">Establishment:</span>
                    <div className="font-bold">{incident.incident_nonsensitive_details.specific_type || incident.incident_nonsensitive_details.general_category}</div>
                </div>
            </div>

            <div className="grid grid-cols-[20px_1fr] gap-2 mb-1 mt-2">
                <Users className="w-4 h-4 text-gray-500 mt-0.5" />
                <div>
                    <span className="font-semibold text-gray-500 text-xs uppercase">Alarm Level:</span>
                    <div>{incident.incident_nonsensitive_details.alarm_level}</div>
                </div>
            </div>

            <div className="grid grid-cols-[20px_1fr] gap-2 mt-2">
                <div className={`w-4 h-4 rounded-full mt-0.5 ${type === 'ongoing' ? 'bg-orange-500 animate-pulse' : 'bg-green-600'}`} />
                <div className={`${type === 'ongoing' ? 'text-orange-600' : 'text-green-700'} font-bold`}>
                    Status: {type === 'ongoing' ? 'On-Going' : 'Fire Out'}
                </div>
            </div>

            <div className="mt-2 text-xs text-gray-400 text-right">
                {new Date(incident.incident_nonsensitive_details.notification_dt).toLocaleString()}
            </div>
        </div>
    );
}
