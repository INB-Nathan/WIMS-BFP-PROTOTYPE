'use client';

import { useState } from 'react';
import { MapPicker } from '@/components/MapPicker';
import { submitCivilianReport } from '@/lib/api';

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

    if (latitude === null || longitude === null) {
      setError('Please select a location on the map.');
      return;
    }

    if (!description.trim()) {
      setError('Please enter an emergency description.');
      return;
    }

    setSubmitting(true);
    try {
      await submitCivilianReport({
        latitude,
        longitude,
        description: description.trim(),
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit report.');
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="max-w-2xl w-full text-center space-y-6 p-8 bg-green-50 border-2 border-green-200 rounded-xl">
          <h1 className="text-3xl md:text-4xl font-bold text-green-800">
            Report Received
          </h1>
          <p className="text-xl md:text-2xl text-green-700 leading-relaxed">
            Emergency responders have been notified. Please move to a safe distance.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">Report Emergency</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select location on map
          </label>
          <MapPicker
            onChange={handleLocationSelect}
            value={
              latitude !== null && longitude !== null
                ? { lat: latitude, lng: longitude }
                : null
            }
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Emergency Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full border border-gray-300 rounded-lg p-3 min-h-[120px] focus:ring-2 focus:ring-red-500 focus:border-red-500"
            placeholder="Describe the emergency (e.g., smoke, fire, structure)..."
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
          className="w-full bg-red-800 text-white py-3 rounded-lg font-bold hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Submitting...' : 'Submit Emergency Report'}
        </button>
      </form>
    </div>
  );
}
