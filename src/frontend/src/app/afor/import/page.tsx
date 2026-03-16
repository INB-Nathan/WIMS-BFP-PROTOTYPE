'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Upload, FileDown, CheckCircle, AlertCircle, RefreshCw, X } from 'lucide-react';
import { importAforFile, commitAforImport } from '@/lib/api';

export default function AforImportPage() {
    const router = useRouter();
    const [file, setFile] = useState<File | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCommitting, setIsCommitting] = useState(false);
    const [previewData, setPreviewData] = useState<any | null>(null);
    const [error, setError] = useState<string | null>(null);

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
        } catch (err: any) {
            setError(err.message || 'Failed to upload and parse the file.');
        } finally {
            setIsUploading(false);
        }
    };

    const handleCommit = async () => {
        if (!previewData || previewData.valid_rows === 0) return;
        setIsCommitting(true);
        setError(null);
        try {
            const validRows = previewData.rows
                .filter((r: any) => r.status === 'VALID')
                .map((r: any) => r.data);
            
            const res = await commitAforImport(validRows);
            if (res.status === 'ok') {
                router.push('/dashboard/regional');
            }
        } catch (err: any) {
            setError(err.message || 'Failed to commit the imported data.');
            setIsCommitting(false);
        }
    };

    const reset = () => {
        setFile(null);
        setPreviewData(null);
        setError(null);
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
                    <a href="/templates/afor_template.xlsx" download className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                        <FileDown className="w-4 h-4" /> Download Template (.xlsx)
                    </a>
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
                                    disabled={isCommitting || previewData.valid_rows === 0}
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
                                        <th className="px-4 py-3">Date/Time</th>
                                        <th className="px-4 py-3">City</th>
                                        <th className="px-4 py-3">Category</th>
                                        <th className="px-4 py-3">Alarm</th>
                                        <th className="px-4 py-3">Errors (if any)</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {previewData.rows.map((row: any, i: number) => (
                                        <tr key={i} className={`border-b ${row.status === 'INVALID' ? 'bg-red-50/30' : 'hover:bg-gray-50'}`}>
                                            <td className="px-4 py-3">
                                                {row.status === 'VALID' ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <AlertCircle className="w-4 h-4 text-red-500" />
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                                {row.data.incident_nonsensitive_details.notification_dt ? row.data.incident_nonsensitive_details.notification_dt.substring(0, 10) : 'Missing'}
                                            </td>
                                            <td className="px-4 py-3">{row.data._city_text || 'Missing'}</td>
                                            <td className="px-4 py-3">{row.data.incident_nonsensitive_details.general_category}</td>
                                            <td className="px-4 py-3">{row.data.incident_nonsensitive_details.alarm_level}</td>
                                            <td className="px-4 py-3 text-red-600 text-xs truncate max-w-[200px]" title={row.errors.join(', ')}>
                                                {row.errors.join(', ')}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button 
                                                    onClick={() => {
                                                        sessionStorage.setItem('temp_afor_review', JSON.stringify(row.data));
                                                        router.push('/afor/create');
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                                >
                                                    {row.status === 'INVALID' ? 'Fix Error' : 'Review'}
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
