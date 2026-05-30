'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState, useCallback } from 'react';
import { MapPicker } from '@/components/MapPicker';
import { fetchReportClusters } from '@/lib/api';
import type { ReportClusterResponse } from '@/lib/api';
import { Locate, RefreshCw, AlertTriangle, MapPin, Globe2 } from 'lucide-react';

const NearbyPublicReportAreasInner = dynamic(
    () => import('./NearbyPublicReportAreasInner').then((m) => m.NearbyPublicReportAreasInner),
    { ssr: false }
);

export function NearbyPublicReportAreas({
    fireLat,
    fireLon
}: {
    fireLat?: number | null;
    fireLon?: number | null;
} = {}) {
    const [clustersData, setClustersData] = useState<ReportClusterResponse | null>(null);
    const [failed, setFailed] = useState(false);
    const [loading, setLoading] = useState(true);
    const [userLat, setUserLat] = useState<number | null>(null);
    const [userLon, setUserLon] = useState<number | null>(null);
    const [manualLat, setManualLat] = useState<number | null>(null);
    const [manualLon, setManualLon] = useState<number | null>(null);
    const [showManualPicker, setShowManualPicker] = useState(false);
    const [nationalOnly, setNationalOnly] = useState(false);

    const activeLat = fireLat ?? (nationalOnly ? null : (manualLat ?? userLat ?? null));
    const activeLon = fireLon ?? (nationalOnly ? null : (manualLon ?? userLon ?? null));

    const loadData = useCallback((lat?: number | null, lon?: number | null) => {
        setLoading(true);
        fetchReportClusters(lat ?? undefined, lon ?? undefined)
            .then((clustersRes) => {
                setClustersData(clustersRes);
                setFailed(false);
            }).catch(() => {
                setFailed(true);
            }).finally(() => {
            setLoading(false);
        });
    }, []);

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;
        
        const tick = () => {
            if (document.visibilityState === 'visible') {
                loadData(activeLat, activeLon);
            }
        };

        tick();

        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                if (!interval) interval = setInterval(tick, 60000);
                tick();
            } else {
                if (interval) {
                    clearInterval(interval);
                    interval = null;
                }
            }
        };

        if (document.visibilityState === 'visible') {
            interval = setInterval(tick, 60000);
        }
        document.addEventListener('visibilitychange', onVisibilityChange);
        
        return () => {
            if (interval) clearInterval(interval);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [activeLat, activeLon, loadData]);

    const requestLocation = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lon = pos.coords.longitude;
                setUserLat(lat);
                setUserLon(lon);
                setNationalOnly(false);
                // loadData is handled by useEffect
            },
            () => {
                setNationalOnly(true);
            }
        );
    };

    if (failed && !clustersData) return null;

    const hasProximity = activeLat !== null && activeLon !== null;
    const isNational = clustersData?.mode === 'national';
    const heading = 'Public Fire Report Areas';
    const isStale = clustersData?.stale || false;
    const isDegraded = clustersData?.degraded || false;

    return (
        <div className="card overflow-hidden mt-6 mb-6 shadow-lg transition-all rounded-xl border border-[var(--border-color)]">
            <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-color)', background: 'var(--card-bg)' }}>
                <div className="flex flex-col gap-1">
                    <span className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>{heading}</span>
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {isNational ? 'National view' : 'Local view'}
                    </span>
                </div>
                {!hasProximity && <span className="text-[11px] font-medium text-slate-500">Showing high-signal areas nationwide</span>}
                {hasProximity && (
                    <button
                        onClick={() => loadData(activeLat, activeLon)}
                        className="p-1.5 rounded-full text-xs transition-colors hover:bg-gray-100"
                        title="Refresh map"
                    >
                        <RefreshCw className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
                    </button>
                )}
            </div>
            {!hasProximity && (
                <div className="flex flex-wrap gap-2 border-b px-5 py-3" style={{ borderColor: 'var(--border-color)' }}>
                    <button
                        onClick={requestLocation}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors"
                        style={{ borderColor: 'var(--bfp-maroon)', color: 'var(--bfp-maroon)', backgroundColor: 'transparent' }}
                    >
                        <Locate className="h-3.5 w-3.5" />
                        Use my location
                    </button>
                    <button
                        onClick={() => {
                            setNationalOnly(true);
                            setShowManualPicker(false);
                        }}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-slate-600"
                    >
                        <Globe2 className="h-3.5 w-3.5" />
                        Show national report areas
                    </button>
                    <button
                        onClick={() => setShowManualPicker((open) => !open)}
                        className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold text-slate-600"
                    >
                        <MapPin className="h-3.5 w-3.5" />
                        Choose area manually
                    </button>
                    <p className="w-full text-xs text-slate-500">
                        Location is used only to show nearby public fire report areas. Reports are not sent until you submit the form.
                    </p>
                </div>
            )}
            {showManualPicker && !fireLat && (
                <div className="border-b px-5 py-3" style={{ borderColor: 'var(--border-color)' }}>
                    <MapPicker
                        value={manualLat !== null && manualLon !== null ? { lat: manualLat, lng: manualLon } : null}
                        onChange={(lat, lng) => {
                            setManualLat(lat);
                            setManualLon(lng);
                            setNationalOnly(false);
                        }}
                    />
                </div>
            )}
            <div className="relative">
                {loading && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                        <div className="w-8 h-8 border-4 border-[var(--bfp-maroon)] border-t-transparent rounded-full animate-spin"></div>
                    </div>
                )}
                <div className="h-[350px]">
                    {!clustersData ? (
                        <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--content-bg)' }}>
                            {failed ? (
                                <p className="text-sm text-red-600">Failed to load map data.</p>
                            ) : (
                                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Loading map…</p>
                            )}
                        </div>
                    ) : (
                        <NearbyPublicReportAreasInner
                            anchorLat={activeLat}
                            anchorLon={activeLon}
                            areas={clustersData.areas}
                        />
                    )}
                </div>
            </div>
            {(isStale || isDegraded) && (
                <div className="px-5 py-2 bg-yellow-50 border-t border-yellow-100 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-yellow-700" />
                    <p className="text-xs text-yellow-700 font-medium">
                        {isDegraded ? 'Operating in degraded mode. Some data may be unavailable.' : 'Map data may be delayed.'}
                    </p>
                </div>
            )}
        </div>
    );
}
