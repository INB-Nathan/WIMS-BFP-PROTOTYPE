'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { fetchNearbyStations, FireStation } from '@/lib/api';

const NearbyStationsMapInner = dynamic(
    () => import('./NearbyStationsMapInner').then((m) => m.NearbyStationsMapInner),
    { ssr: false }
);

export interface NearbyStationsMapProps {
    reportLat: number;
    reportLon: number;
}

export function NearbyStationsMap({ reportLat, reportLon }: NearbyStationsMapProps) {
    const [stations, setStations] = useState<FireStation[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        fetchNearbyStations(reportLat, reportLon)
            .then(setStations)
            .catch(() => setFailed(true));
    }, [reportLat, reportLon]);

    if (failed) return null;

    const isProximity = stations !== null && stations.length > 0 && stations[0].distance_m !== null;
    const heading = stations === null
        ? 'Finding nearby fire stations…'
        : isProximity
            ? `${stations.length} Nearest Fire Station${stations.length !== 1 ? 's' : ''}`
            : 'BFP Fire Stations';

    return (
        <div className="card overflow-hidden mt-4">
            <div className="px-5 py-3 border-b flex items-center gap-2" style={{ borderColor: 'var(--border-color)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{heading}</span>
                {isProximity && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">within 5 km</span>
                )}
            </div>
            <div className="p-4">
                {stations === null ? (
                    <div className="h-[300px] flex items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--content-bg)' }}>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading map…</p>
                    </div>
                ) : (
                    <NearbyStationsMapInner
                        reportLat={reportLat}
                        reportLon={reportLon}
                        stations={stations}
                    />
                )}
            </div>
        </div>
    );
}
