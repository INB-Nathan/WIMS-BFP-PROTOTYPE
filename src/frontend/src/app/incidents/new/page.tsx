'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { MapPicker } from '@/components/MapPicker';
import { createIncident } from '@/lib/api';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
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

    if (latitude === null || longitude === null) {
      setError('Please select a location on the map.');
      return;
    }

    if (!description.trim()) {
      setError('Please enter a description.');
      return;
    }

    setSubmitting(true);
    try {
      await createIncident({
        latitude,
        longitude,
        description: description.trim(),
        verification_status: 'PENDING',
      });
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit incident.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading || !user) {
    return <div className="flex items-center justify-center min-h-[200px]">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
          <ChevronLeft className="w-6 h-6 text-gray-600" />
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">Report New Incident</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Select location on map</label>
          <MapPicker
            onChange={handleLocationSelect}
            value={
              latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : null
            }
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Latitude</label>
            <input
              type="text"
              readOnly
              className="w-full border border-gray-300 rounded p-2 bg-gray-50 text-gray-600"
              value={latitude !== null ? latitude.toFixed(6) : ''}
              placeholder="Click map to select"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Longitude</label>
            <input
              type="text"
              readOnly
              className="w-full border border-gray-300 rounded p-2 bg-gray-50 text-gray-600"
              value={longitude !== null ? longitude.toFixed(6) : ''}
              placeholder="Click map to select"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded p-2 min-h-[120px]"
            placeholder="Describe the incident..."
            required
          />
        </div>

        {error && (
          <div className="text-red-600 text-sm" role="alert">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || latitude === null || longitude === null}
          className="w-full bg-red-800 text-white py-3 rounded font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Submitting...' : 'Submit Incident'}
        </button>
      </form>
    </div>
  );
}
