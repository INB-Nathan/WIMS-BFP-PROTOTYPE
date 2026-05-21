'use client';

import { useState, useEffect } from 'react';
import { MapPicker } from '@/components/MapPicker';
import { submitCivilianReport, registerNotification } from '@/lib/api';
import { getMessagingToken } from '@/lib/firebase';
import Image from 'next/image';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { NearbyStationsMap } from '@/components/NearbyStationsMap';

type NotifyStatus = 'idle' | 'enabling' | 'enabled' | 'denied' | 'error';

export default function ReportPage() {
    const [latitude, setLatitude] = useState<number | null>(null);
    const [longitude, setLongitude] = useState<number | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState<number | null>(null);
    const [notifyOptIn, setNotifyOptIn] = useState(false);
    const [notifyStatus, setNotifyStatus] = useState<NotifyStatus>('idle');

    const handleLocationSelect = (lat: number, lng: number) => {
        setLatitude(lat);
        setLongitude(lng);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (latitude === null || longitude === null) { setError('Please select a location on the map.'); return; }
        if (!description.trim()) { setError('Please enter an emergency description.'); return; }
        setSubmitting(true);
        try {
            const data = await submitCivilianReport({ latitude, longitude, description: description.trim() });
            setSubmitted(data.report_id);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit report.');
        } finally {
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (!submitted || !notifyOptIn) return;
        setNotifyStatus('enabling');
        (async () => {
            try {
                const token = await getMessagingToken();
                if (!token) { setNotifyStatus('denied'); return; }
                await registerNotification(submitted, token);
                setNotifyStatus('enabled');
            } catch {
                setNotifyStatus('error');
            }
        })();
    }, [submitted, notifyOptIn]);

    if (submitted) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: 'var(--content-bg)' }}>
                <div className="flex flex-col gap-4 max-w-lg w-full">
                    <div className="card w-full text-center p-8 space-y-4">
                        <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Report Received</h1>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            Emergency responders have been notified. Please move to a safe distance.
                        </p>
                        <div className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg mt-4 border" style={{ borderColor: 'var(--border-color)' }}>
                            <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Your Tracking ID</p>
                            <p className="text-3xl font-mono font-bold" style={{ color: 'white' }}>{submitted}</p>
                        </div>
                        <div className="pt-4">
                            <a href="/report/tracking" className="text-red-600 hover:text-red-800 font-medium text-sm underline underline-offset-4">
                                Track the status of your report &rarr;
                            </a>
                        </div>
                        {notifyOptIn && (
                            <div className="text-sm pt-1">
                                {notifyStatus === 'enabling' && <p style={{ color: 'var(--text-secondary)' }}>Enabling notifications…</p>}
                                {notifyStatus === 'enabled' && <p className="text-green-600 font-medium">Notifications enabled. You&apos;ll be alerted when your report is verified.</p>}
                                {notifyStatus === 'denied' && <p className="text-orange-500">Notification permission denied. You can enable it from the tracking page.</p>}
                                {notifyStatus === 'error' && <p className="text-red-500">Could not enable notifications. Try again from the tracking page.</p>}
                            </div>
                        )}
                    </div>
                    {latitude !== null && longitude !== null && (
                        <NearbyStationsMap reportLat={latitude} reportLon={longitude} />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center px-4 py-8" style={{ backgroundColor: 'var(--content-bg)' }}>
            <div className="card max-w-2xl w-full overflow-hidden">
                {/* Header */}
                <div className="p-6 text-center" style={{ background: 'var(--bfp-gradient)' }}>
                    <div className="relative w-16 h-16 mx-auto mb-3">
                        <Image src="/bfp-logo.svg" alt="BFP" fill className="object-contain" />
                    </div>
                    <h1 className="text-xl font-bold text-white">Report Emergency</h1>
                    <p className="text-sm text-white/70 mt-1">Bureau of Fire Protection</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="card-body space-y-6">
                    <div>
                        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Select location on map</label>
                        <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-color)' }}>
                            <MapPicker
                                onChange={handleLocationSelect}
                                value={latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Emergency Description</label>
                        <textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="w-full rounded-lg p-3 min-h-[120px] text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                            style={{ border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                            placeholder="Describe the emergency (smoke, fire, structure)..."
                            required
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        <input
                            id="notify-optin"
                            type="checkbox"
                            checked={notifyOptIn}
                            onChange={(e) => setNotifyOptIn(e.target.checked)}
                            className="w-4 h-4 accent-red-600 cursor-pointer"
                        />
                        <label htmlFor="notify-optin" className="text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                            Notify me when my report status changes
                        </label>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 text-red-700 text-sm">
                            <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {error}
                        </div>
                    )}

                    <button type="submit" disabled={submitting || latitude === null || longitude === null}
                        className="w-full py-3 rounded-lg text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        style={{ background: 'var(--bfp-gradient)' }}>
                        {submitting ? 'Submitting...' : 'Submit Emergency Report'}
                    </button>
                </form>
            </div>
        </div>
    );
}
