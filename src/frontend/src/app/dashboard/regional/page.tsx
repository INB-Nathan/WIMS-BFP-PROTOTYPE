'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { RefreshCw, Flame, Building2, TreePine, Car } from 'lucide-react';
import { fetchRegionalIncidents, fetchRegionalStats } from '@/lib/api';
import Link from 'next/link';

export default function RegionalDashboardPage() {
    const router = useRouter();
    const { user, loading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const assignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;

    useEffect(() => {
        if (!loading && role !== 'REGIONAL_ENCODER') {
            router.replace('/dashboard');
        }
    }, [loading, role, router]);

    const [stats, setStats] = useState<any>(null);
    const [incidents, setIncidents] = useState<any[]>([]);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const loadData = async () => {
        setIsRefreshing(true);
        try {
            const [statsData, incidentsData] = await Promise.all([
                fetchRegionalStats(),
                fetchRegionalIncidents({ limit: 10 })
            ]);
            setStats(statsData);
            setIncidents(incidentsData?.items || []);
        } catch (error) {
            console.error("Failed to fetch regional data", error);
        } finally {
            setIsRefreshing(false);
        }
    };

    useEffect(() => {
        if (role === 'REGIONAL_ENCODER' && assignedRegionId) {
            loadData();
        }
    }, [role, assignedRegionId]);

    if (loading || role !== 'REGIONAL_ENCODER') {
        return <div className="flex items-center justify-center min-h-[40vh] text-gray-500">Loading Regional Dashboard...</div>;
    }

    const summaryCards = [
        { key: 'total', title: 'Total Incidents', icon: Flame, value: stats?.total_incidents?.toLocaleString() ?? '0', borderColor: '#dc2626' },
        { key: 'STRUCTURAL', title: 'Structural', icon: Building2, value: stats?.by_category?.find((c: any) => c.category === 'STRUCTURAL')?.count.toLocaleString() ?? '0', borderColor: '#f97316' },
        { key: 'NON_STRUCTURAL', title: 'Non-Structural', icon: TreePine, value: stats?.by_category?.find((c: any) => c.category === 'NON_STRUCTURAL')?.count.toLocaleString() ?? '0', borderColor: '#22c55e' },
        { key: 'VEHICULAR', title: 'Vehicular', icon: Car, value: stats?.by_category?.find((c: any) => c.category === 'VEHICULAR')?.count.toLocaleString() ?? '0', borderColor: '#3b82f6' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        Regional Dashboard
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Overview for Region {assignedRegionId}
                    </p>
                </div>
                <div className="flex gap-2">
                    <button onClick={loadData} disabled={isRefreshing}
                        className={`card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors ${isRefreshing ? 'opacity-70' : ''}`}>
                        <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
                    </button>
                    <Link href="/afor/import" className="card flex items-center gap-2 px-3 py-2 text-sm font-medium text-white transition-colors"
                        style={{ backgroundColor: 'var(--bfp-maroon)' }}>
                        Import AFOR
                    </Link>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {summaryCards.map((card) => {
                    const IconComp = card.icon;
                    return (
                        <div key={card.key} className="card overflow-hidden hover:shadow-md transition-all duration-200"
                            style={{ borderLeft: `4px solid ${card.borderColor}` }}>
                            <div className="p-4 flex items-start justify-between">
                                <div>
                                    <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{card.title}</div>
                                    <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{card.value}</div>
                                </div>
                                <div className="opacity-20" style={{ color: card.borderColor }}><IconComp className="w-8 h-8" /></div>
                            </div>
                        </div>
                    );
                })}
            </div>

            <div className="card">
                <div className="card-header flex justify-between items-center">
                    <span className="font-bold">Recent Region Incidents</span>
                </div>
                <div className="card-body p-0 overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs uppercase bg-gray-50 text-gray-700">
                            <tr>
                                <th className="px-6 py-3">Date</th>
                                <th className="px-6 py-3">Type</th>
                                <th className="px-6 py-3">Station</th>
                                <th className="px-6 py-3">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {incidents.length === 0 ? (
                                <tr>
                                    <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                                        No incidents found in this region.
                                    </td>
                                </tr>
                            ) : (
                                incidents.map((inc, i) => (
                                    <tr key={i} className="bg-white border-b hover:bg-gray-50">
                                        <td className="px-6 py-4">{new Date(inc.notification_dt || inc.created_at).toLocaleString()}</td>
                                        <td className="px-6 py-4 font-medium">{inc.general_category}</td>
                                        <td className="px-6 py-4 text-gray-500">{inc.fire_station_name || 'N/A'}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                                inc.verification_status === 'VERIFIED' ? 'bg-green-100 text-green-800' :
                                                inc.verification_status === 'REJECTED' ? 'bg-red-100 text-red-800' :
                                                'bg-yellow-100 text-yellow-800'
                                            }`}>
                                                {inc.verification_status}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
}
