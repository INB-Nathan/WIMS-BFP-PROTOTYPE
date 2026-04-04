'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileDown, CheckCircle, AlertCircle, RefreshCw, X } from 'lucide-react';
import { importAforFile, commitAforImport, type AforImportPreviewResponse } from '@/lib/api';
import { MapPicker } from '@/components/MapPicker';

function isValidWgs84(lat: number, lng: number): boolean {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat >= -90 &&
        lat <= 90 &&
        lng >= -180 &&
        lng <= 180
    );
}

export default function AforImportPage() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [previewData, setPreviewData] = useState<AforImportPreviewResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [commitLatStr, setCommitLatStr] = useState('');
    const [commitLngStr, setCommitLngStr] = useState('');

    const isOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    const handleFileDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        setError(null);
        if (isOffline) return;
        const droppedFile = e.dataTransfer.files[0];
        validateAndSetFile(droppedFile);
    }, [isOffline]);

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        setError(null);
        if (isOffline) return;
        const selectedFile = e.target.files?.[0];
        validateAndSetFile(selectedFile);
    };

    const validateAndSetFile = (f: File | undefined | null) => {
        if (!f) return;
        const ext = f.name.split('.').pop()?.toLowerCase();
        if (ext !== 'csv' && ext !== 'xlsx' && ext !== 'xls') {
            setError('Please upload a valid .csv or .xlsx file.');
            return;
        }
        setFile(f);
    };

    const handleUpload = async () => {
        if (!file) return;
        setIsUploading(true);
        setError(null);
        try {
            const data = await importAforFile(file);
            setPreviewData(data);
            setCommitLatStr('');
            setCommitLngStr('');
        } catch (err: unknown) {
            setError((err as { message?: string }).message || 'Failed to upload and parse the file.');
        } finally {
            setIsUploading(false);
        }
    };

    const commitLat = parseFloat(commitLatStr);
    const commitLng = parseFloat(commitLngStr);
    const requiresLocation = previewData?.requires_location !== false;
    const coordsReady = !requiresLocation || isValidWgs84(commitLat, commitLng);

    const onMapPick = useCallback((lat: number, lng: number) => {
        setCommitLatStr(String(lat));
        setCommitLngStr(String(lng));
    }, []);

    const handleCommit = async () => {
        if (!previewData || previewData.valid_rows === 0) return;
        if (!coordsReady) return;
        setIsCommitting(true);
        setError(null);
        try {
            const validRows = previewData.rows
                .filter((r) => r.status === 'VALID')
                .map((r) => r.data);

            const res = await commitAforImport(validRows, previewData.form_kind, {
                latitude: commitLat,
                longitude: commitLng,
            });
            if (res.status === 'ok') {
                router.push('/dashboard/regional');
            }
        } catch (err: unknown) {
            setError((err as { message?: string }).message || 'Failed to commit the imported data.');
            setIsCommitting(false);
        }
    };

    const reset = () => {
        setFile(null);
        setPreviewData(null);
        setError(null);
        setCommitLatStr('');
        setCommitLngStr('');
    };

    return (
        <div className="max-w-6xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        Regional AFOR Import
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                        Upload tabular AFOR data directly to your regional database.
                    </p>
                </div>
                {!previewData && (
                    <div className="flex flex-wrap gap-2">
                        <a href="/templates/afor_template.xlsx" download className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                            <FileDown className="w-4 h-4" /> Structural template (.xlsx)
                        </a>
                        <a href="/templates/wildland_afor_template.xlsx" download className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                            <FileDown className="w-4 h-4" /> Wildland template (.xlsx)
                        </a>
                    </div>
                )}
            </div>

            {isOffline && (
                <div className="card overflow-hidden">
                    <div className="flex items-center gap-3 p-4" style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444' }}>
                        <AlertCircle className="text-red-500 w-5 h-5 flex-shrink-0" />
                        <div>
                            <p className="text-sm font-semibold text-red-800">You are offline</p>
                            <p className="text-xs text-red-600 mt-0.5">AFOR import requires an active internet connection to validate and process data.</p>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="card overflow-hidden">
                    <div className="flex items-center gap-3 p-4" style={{ backgroundColor: '#fef2f2', borderLeft: '4px solid #ef4444' }}>
                        <AlertCircle className="text-red-500 w-5 h-5 flex-shrink-0" />
                        <p className="text-sm font-medium text-red-800">{error}</p>
                        <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-700">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {!previewData ? (
                <div className="card p-8">
                    <div 
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleFileDrop}
                        className={`
                            border-2 border-dashed rounded-xl p-12 text-center transition-colors
                            ${isOffline ? 'opacity-50 cursor-not-allowed bg-gray-50' : 'hover:bg-blue-50/50 cursor-pointer'}
                        `}
                        style={{ borderColor: 'var(--border-color)' }}
                        onClick={() => !isOffline && document.getElementById('file-upload')?.click()}
                    >
                        <input 
                            type="file" 
                            id="file-upload" 
                            className="hidden" 
                            accept=".csv, .xlsx, .xls"
                            onChange={handleFileInput}
                            disabled={isOffline || isUploading}
                        />
                        <div className="flex justify-center mb-4">
                            <div className="p-4 rounded-full bg-blue-50 text-blue-600">
                                <Upload className="w-8 h-8" />
                            </div>
                        </div>
                        <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>
                            {file ? file.name : 'Click to upload or drag and drop'}
                        </h3>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                            {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Excel (.xlsx) or CSV files up to 10MB'}
                        </p>
                        
                        {file && !isOffline && (
                            <div className="mt-8 flex justify-center gap-3" onClick={(e) => e.stopPropagation()}>
                                <button 
                                    onClick={reset}
                                    className="px-4 py-2 text-sm font-medium rounded-md border hover:bg-gray-50 transition-colors"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleUpload}
                                    disabled={isUploading}
                                    className="px-6 py-2 text-sm font-bold text-white rounded-md flex items-center gap-2 transition-colors disabled:opacity-70"
                                    style={{ backgroundColor: 'var(--bfp-maroon)' }}
                                >
                                    {isUploading ? <><RefreshCw className="w-4 h-4 animate-spin" /> Analyzing...</> : 'Analyze File'}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <span className="font-semibold uppercase tracking-wide text-xs" style={{ color: 'var(--text-primary)' }}>
                            Detected form
                        </span>
                        <span
                            className="px-2 py-0.5 rounded border text-xs font-semibold"
                            style={{
                                borderColor: previewData.form_kind === 'WILDLAND_AFOR' ? '#15803d' : '#1d4ed8',
                                color: previewData.form_kind === 'WILDLAND_AFOR' ? '#15803d' : '#1d4ed8',
                            }}
                        >
                            {previewData.form_kind === 'WILDLAND_AFOR' ? 'Wildland AFOR' : 'Structural AFOR'}
                        </span>
                    </div>
                    {requiresLocation && (
                        <div className="card p-4 space-y-3">
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                                Incident location (WGS84)
                            </p>
                            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                                The AFOR file does not include reliable coordinates. Set latitude and longitude before
                                commit (map click or numeric fields). PostGIS stores POINT(longitude latitude); not GeoJSON [lat, lon].
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Latitude (-90 to 90)</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={commitLatStr}
                                        onChange={(e) => setCommitLatStr(e.target.value)}
                                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                        placeholder="e.g. 14.5547"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-700 mb-1">Longitude (-180 to 180)</label>
                                    <input
                                        type="number"
                                        step="any"
                                        value={commitLngStr}
                                        onChange={(e) => setCommitLngStr(e.target.value)}
                                        className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                                        placeholder="e.g. 121.0244"
                                    />
                                </div>
                            </div>
                            <div className="w-full rounded-md overflow-hidden border border-gray-200">
                                <MapPicker
                                    value={
                                        isValidWgs84(commitLat, commitLng)
                                            ? { lat: commitLat, lng: commitLng }
                                            : null
                                    }
                                    onChange={onMapPick}
                                />
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #3b82f6' }}>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-500">Total Rows</p>
                                <p className="text-xl font-bold">{previewData.total_rows}</p>
                            </div>
                            <Upload className="w-6 h-6 text-blue-300" />
                        </div>
                        <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #22c55e' }}>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-500">Valid Rows</p>
                                <p className="text-xl font-bold text-green-600">{previewData.valid_rows}</p>
                            </div>
                            <CheckCircle className="w-6 h-6 text-green-300" />
                        </div>
                        <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #ef4444' }}>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-500">Errors</p>
                                <p className="text-xl font-bold text-red-600">{previewData.invalid_rows}</p>
                            </div>
                            <AlertCircle className="w-6 h-6 text-red-300" />
                        </div>
                    </div>

                    <div className="card">
                        <div className="card-header flex items-center justify-between p-4 border-b">
                            <span className="font-bold">Data Preview</span>
                            <div className="flex gap-2">
                                <button onClick={reset} className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-white transition-colors bg-white">
                                    Start Over
                                </button>
                                <button 
                                    onClick={handleCommit}
                                    disabled={isCommitting || previewData.valid_rows === 0 || !coordsReady}
                                    className="px-6 py-2 text-sm font-bold text-white rounded-md flex items-center gap-2 transition-colors disabled:opacity-50"
                                    style={{ backgroundColor: 'var(--bfp-maroon)' }}
                                >
                                    {isCommitting ? <><RefreshCw className="w-4 h-4 animate-spin" /> Committing...</> : `Commit ${previewData.valid_rows} Valid Rows`}
                                </button>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left whitespace-nowrap">
                                <thead className="text-xs uppercase bg-gray-50 text-gray-700">
                                    <tr>
                                        <th className="px-4 py-3 w-10">Status</th>
                                        {previewData.form_kind === 'WILDLAND_AFOR' ? (
                                            <>
                                                <th className="px-4 py-3">Call received</th>
                                                <th className="px-4 py-3">Engine</th>
                                                <th className="px-4 py-3">Wildland type</th>
                                                <th className="px-4 py-3">Primary action</th>
                                            </>
                                        ) : (
                                            <>
                                                <th className="px-4 py-3">Date/Time</th>
                                                <th className="px-4 py-3">City</th>
                                                <th className="px-4 py-3">Category</th>
                                                <th className="px-4 py-3">Alarm</th>
                                            </>
                                        )}
                                        <th className="px-4 py-3">Errors (if any)</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewData.rows.map((row, i) => {
                                        const wl = row.data.wildland as Record<string, unknown> | undefined;
                                        const callAt =
                                            typeof wl?.call_received_at === 'string'
                                                ? wl.call_received_at.substring(0, 16)
                                                : wl?.call_received_at != null
                                                  ? String(wl.call_received_at).substring(0, 16)
                                                  : '—';
                                        return (
                                        <tr key={i} className={`border-b ${row.status === 'INVALID' ? 'bg-red-50/30' : 'hover:bg-gray-50'}`}>
                                            <td className="px-4 py-3">
                                                {row.status === 'VALID' ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <AlertCircle className="w-4 h-4 text-red-500" />
                                                )}
                                            </td>
                                            {previewData.form_kind === 'WILDLAND_AFOR' ? (
                                                <>
                                                    <td className="px-4 py-3 font-medium">{callAt}</td>
                                                    <td className="px-4 py-3">{String(wl?.engine_dispatched ?? '—')}</td>
                                                    <td className="px-4 py-3">{String(wl?.wildland_fire_type ?? wl?.raw_wildland_fire_type ?? '—')}</td>
                                                    <td className="px-4 py-3 max-w-[220px] truncate" title={String(wl?.primary_action_taken ?? '')}>
                                                        {String(wl?.primary_action_taken ?? '—')}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td className="px-4 py-3 font-medium">
                                                        {(row.data.incident_nonsensitive_details as { notification_dt?: string })?.notification_dt
                                                            ? (row.data.incident_nonsensitive_details as { notification_dt: string }).notification_dt.substring(0, 10)
                                                            : 'Missing'}
                                                    </td>
                                                    <td className="px-4 py-3">{String(row.data._city_text || 'Missing')}</td>
                                                    <td className="px-4 py-3">{String((row.data.incident_nonsensitive_details as { general_category?: string })?.general_category ?? '')}</td>
                                                    <td className="px-4 py-3">{String((row.data.incident_nonsensitive_details as { alarm_level?: string })?.alarm_level ?? '')}</td>
                                                </>
                                            )}
                                            <td className="px-4 py-3 text-red-600 text-xs truncate max-w-[200px]" title={row.errors.join(', ')}>
                                                {row.errors.join(', ')}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button 
                                                    onClick={() => {
                                                        sessionStorage.setItem('temp_afor_review', JSON.stringify(row.data));
                                                        sessionStorage.setItem('temp_afor_form_kind', previewData.form_kind);
                                                        router.push('/afor/create');
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                                >
                                                    {row.status === 'INVALID' ? 'Fix Error' : 'Review'}
                                                </button>
                                            </td>
                                        </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
