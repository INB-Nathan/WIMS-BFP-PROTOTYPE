'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { MapPicker } from '@/components/MapPicker';
import { createIncident } from '@/lib/api';
import { MapPin } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function NewIncidentPage() {
    const { user, loading } = useAuth();
    const router = useRouter();
    const [latitude, setLatitude] = useState<number | null>(null);
    const [longitude, setLongitude] = useState<number | null>(null);
    const [description, setDescription] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleLocationSelect = (lat: number, lng: number) => {
        setLatitude(lat);
        setLongitude(lng);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (latitude === null || longitude === null) { setError('Please select a location on the map.'); return; }
        if (!description.trim()) { setError('Please enter a description.'); return; }
        setSubmitting(true);
        try {
            await createIncident({ latitude, longitude, description: description.trim(), verification_status: 'PENDING' });
            router.push('/dashboard');
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to submit incident.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading || !user) {
        return <div className="flex items-center justify-center min-h-[200px]" style={{ color: 'var(--text-muted)' }}>Loading...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="card overflow-hidden">
                <div className="card-header flex items-center gap-2" style={{ borderLeft: '4px solid var(--bfp-maroon)' }}>
                    <MapPin className="w-4 h-4" style={{ color: 'var(--bfp-maroon)' }} />
                    <span>Report New Incident</span>
                </div>
                <div className="card-body">
                    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
                        <div>
                            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Select location on map</label>
                            <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-color)' }}>
                                <MapPicker
                                    onChange={handleLocationSelect}
                                    value={latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null}
                                />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Latitude</label>
                                <input type="text" readOnly
                                    className="w-full rounded-md p-2 text-sm"
                                    style={{ border: '1px solid var(--border-color)', backgroundColor: '#f8f9fa', color: 'var(--text-secondary)' }}
                                    value={latitude !== null ? latitude.toFixed(6) : ''} placeholder="Click map" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Longitude</label>
                                <input type="text" readOnly
                                    className="w-full rounded-md p-2 text-sm"
                                    style={{ border: '1px solid var(--border-color)', backgroundColor: '#f8f9fa', color: 'var(--text-secondary)' }}
                                    value={longitude !== null ? longitude.toFixed(6) : ''} placeholder="Click map" />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Description</label>
                            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                                className="w-full rounded-md p-2 min-h-[120px] text-sm focus:ring-2 focus:ring-red-500 focus:outline-none"
                                style={{ border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                                placeholder="Describe the incident..." required />
                        </div>

                        {error && <div className="text-red-600 text-sm" role="alert">{error}</div>}

                        <button type="submit" disabled={submitting || latitude === null || longitude === null}
                            className="w-full py-3 rounded-lg text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            style={{ background: 'var(--bfp-gradient)' }}>
                            {submitting ? 'Submitting...' : 'Submit Incident'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
