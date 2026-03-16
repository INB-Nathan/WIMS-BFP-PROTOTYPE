'use client';

import { useState } from 'react';
import { MapPicker } from '@/components/MapPicker';
import { submitCivilianReport } from '@/lib/api';
import Image from 'next/image';
import { AlertTriangle, CheckCircle } from 'lucide-react';

export default function ReportPage() {
    const [latitude, setLatitude] = useState<number | null>(null);
    const [longitude, setLongitude] = useState<number | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState(false);

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
            await submitCivilianReport({ latitude, longitude, description: description.trim() });
            setSubmitted(true);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit report.');
        } finally {
            setSubmitting(false);
        }
    };

    if (submitted) {
        return (
            <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--content-bg)' }}>
                <div className="card max-w-lg w-full text-center p-8 space-y-4">
                    <CheckCircle className="w-16 h-16 mx-auto text-green-500" />
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Report Received</h1>
                    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                        Emergency responders have been notified. Please move to a safe distance.
                    </p>
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
