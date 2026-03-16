'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { edgeFunctions, Incident } from '@/lib/edgeFunctions';
import { fetchRegionsByRegionId, fetchProvinces, fetchCitiesByProvinces, fetchBarangays } from '@/lib/api';
import { ChevronLeft, Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Download, X, Save, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';

interface MappedIncident extends Incident {
    _id: string; // Internal ID for UI tracking
    _city_text?: string;
    _errors: string[]; // Validation errors
    _status: 'VALID' | 'INVALID';
}

export default function ImportIncidentPage() {
    const { role, assignedRegionId, loading } = useUserProfile();
    const router = useRouter();

    // File State
    const [file, setFile] = useState<File | null>(null);
    const [incidents, setIncidents] = useState<MappedIncident[]>([]);

    // UI State
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [showReview, setShowReview] = useState(false);

    // Geo Reference Data
    const [cities, setCities] = useState<any[]>([]);
    const [barangays, setBarangays] = useState<any[]>([]);
    const [loadingRefs, setLoadingRefs] = useState(false);

    useEffect(() => {
        if (!loading && (role !== 'ENCODER' && role !== 'REGIONAL_ENCODER')) {
            router.push('/dashboard');
        }
    }, [role, loading, router]);

    useEffect(() => {
        if (!assignedRegionId) return;
        setLoadingRefs(true);
        (async () => {
            try {
                const provincesData = await fetchProvinces(assignedRegionId);
                const provinceIds = provincesData.map((p: any) => p.province_id);
                let citiesData: any[] = [];
                if (provinceIds.length > 0) {
                    citiesData = await fetchCitiesByProvinces(provinceIds);
                    setCities(citiesData);
                }

                if (citiesData.length > 0) {
                    const cityIds = citiesData.map((c: any) => c.city_id);
                    const barangaysData = await fetchBarangays(cityIds);
                    if (barangaysData.length) setBarangays(barangaysData);
                }
            } catch (err) {
                console.error("Error fetching geo refs:", err);
            } finally {
                setLoadingRefs(false);
            }
        })();
    }, [assignedRegionId]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            parseFile(selectedFile);
            setError(null);
            setSuccess(null);
            setShowReview(true);
        }
    };

    const parseFile = (file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = e.target?.result;
                const workbook = XLSX.read(data, { type: 'binary' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const jsonData = XLSX.utils.sheet_to_json(sheet);

                const mapped = jsonData.map((row: any, idx) => mapRowToIncident(row, idx));
                setIncidents(mapped);
            } catch (err) {
                console.error("Error parsing file:", err);
                setError("Failed to parse file. Please ensure it is a valid Excel or CSV file.");
            }
        };
        reader.readAsBinaryString(file);
    };

    const findBestMatch = (input: string, list: any[], key: string) => {
        if (!input) return null;
        const normalizedInput = input.toString().trim().toLowerCase();
        return list.find(item => item[key]?.toString().toLowerCase() === normalizedInput) || null;
    };

    const mapRowToIncident = (row: any, index: number): MappedIncident => {
        const errors: string[] = [];
        let cityId = 1; // Default fallback
        let provinceId = 1;
        let barangayId: number | undefined;

        // 1. Resolve City & Province
        const cityInput = row['City'] || row['city_name'] || row['Municipality'];
        const matchedCity = findBestMatch(cityInput, cities, 'city_name');

        if (matchedCity) {
            cityId = matchedCity.city_id;
            provinceId = matchedCity.province_id;
        } else if (cityInput) {
            errors.push(`City '${cityInput}' not found in region.`);
        } else {
            errors.push("City is required.");
        }

        // 2. Resolve Barangay
        const brgyInput = row['Barangay'] || row['barangay_name'];
        if (cityId && brgyInput) {
            const potentialBarangays = barangays.filter(b => b.city_id === cityId);
            const matchedBrgy = findBestMatch(brgyInput, potentialBarangays, 'barangay_name');
            if (matchedBrgy) {
                barangayId = matchedBrgy.barangay_id;
            } else {
                errors.push(`Barangay '${brgyInput}' not found in ${matchedCity?.city_name || 'selected city'}.`);
            }
        } else if (!brgyInput) {
            errors.push("Barangay is required.");
        }

        // 3. Construct Incident (Simplified for sessionStorage handoff)
        const incident: Incident = {
            region_id: assignedRegionId || 0,
            incident_nonsensitive_details: {
                notification_dt: row['Notification Date'] || row['notification_dt'] || new Date().toISOString(),
                barangay: brgyInput || 'Unknown',
                barangay_id: barangayId,
                city_id: cityId,
                province_id: provinceId,
                district_id: 1,
                general_category: row['Category'] || row['general_category'] || 'Residential',
                incident_type: row['Classification'] || row['incident_type'] || 'Structural',
                alarm_level: row['Alarm Level'] || row['alarm_level'] || 'First Alarm',
                responder_type: row['Responder Type'] || row['responder_type'] || 'First Responder',
                structures_affected: parseInt(row['Structures Affected'] || row['structures_affected'] || '0'),
                area_of_origin: row['Area of Origin'] || row['fire_origin'] || '',
                extent_of_damage: row['Extent of Damage'] || row['extent_of_damage'] || '',
            },
            incident_sensitive_details: {
                estimated_damage: parseInt(row['Est. Damage'] || row['estimated_damage'] || '0'),
                caller_name: row['Caller Name'] || row['caller_name'] || '',
                owner_name: row['Owner Name'] || row['owner_name'] || '',
                establishment_name: row['Establishment Name'] || row['establishment_name'] || '',
                narrative_report: row['Narrative'] || row['narrative_report'] || '',
            },
            _city_text: cityInput
        };

        return {
            ...incident,
            _id: `row-${index}-${Date.now()}`,
            _errors: errors,
            _status: errors.length > 0 ? 'INVALID' : 'VALID'
        };
    };

    const handleUpload = async () => {
        const validIncidents = incidents.filter(i => i._status === 'VALID');
        if (validIncidents.length === 0 || !assignedRegionId) return;

        const confirmMsg = `You are about to upload ${validIncidents.length} incidents.\n\nAre you sure all details are correct? This action will create official records.`;
        if (!window.confirm(confirmMsg)) return;

        setUploading(true);
        setError(null);

        try {
            const payloadIncidents: Incident[] = validIncidents.map(({ _id, _errors, _status, _city_text, ...rest }) => rest);

            const payload = {
                region_id: assignedRegionId,
                incidents: payloadIncidents
            };

            const res = await edgeFunctions.uploadBundle(payload);
            setSuccess(`Successfully uploaded ${validIncidents.length} incidents. Batch ID: ${res.batch_id}`);
            setIncidents([]);
            setFile(null);
            setShowReview(false);
        } catch (err: any) {
            console.error("Upload failed:", err);
            setError(err.message || "Failed to upload bundle.");
        } finally {
            setUploading(false);
        }
    };

    const downloadTemplate = () => {
        const headers = [
            {
                'Notification Date': '2023-01-01',
                'City': 'City Name',
                'Barangay': 'Barangay Name',
                'Category': 'Residential',
                'Classification': 'Structural',
                'Alarm Level': 'First Alarm',
                'Responder Type': 'First Responder',
                'Structures Affected': 1,
                'Est. Damage': 50000,
                'Area of Origin': 'Kitchen',
                'Extent of Damage': 'Partial',
                'Caller Name': 'Juan Dela Cruz',
                'Owner Name': 'Maria Clara',
                'Establishment Name': 'N/A',
                'Narrative': 'Fire started at...'
            }
        ];
        const ws = XLSX.utils.json_to_sheet(headers);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "BFP_Incident_Template.xlsx");
    };

    const reset = () => {
        setFile(null);
        setIncidents([]);
        setError(null);
        setSuccess(null);
        setShowReview(false);
    };

    if (loading || loadingRefs) return (
        <div className="flex items-center justify-center min-h-[50vh]">
            <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--bfp-maroon)' }} />
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading Configuration...</p>
            </div>
        </div>
    );

    return (
        <div className="max-w-6xl mx-auto space-y-6 p-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ChevronLeft className="w-5 h-5" style={{ color: 'var(--text-secondary)' }} />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Import Incidents</h1>
                        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                            Upload tabular data to batch-create fire incident records.
                        </p>
                    </div>
                </div>
                {!showReview && (
                    <button onClick={downloadTemplate} className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                        <Download className="w-4 h-4" /> Download Template (.xlsx)
                    </button>
                )}
            </div>

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

            {success && (
                <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-green-700">{success}</p>
                </div>
            )}

            {!showReview ? (
                <div className="card p-8">
                    <div 
                        className="border-2 border-dashed rounded-xl p-12 text-center hover:bg-blue-50/50 cursor-pointer transition-colors"
                        style={{ borderColor: 'var(--border-color)' }}
                        onClick={() => document.getElementById('file-upload')?.click()}
                    >
                        <input 
                            type="file" 
                            id="file-upload" 
                            className="hidden" 
                            accept=".xlsx, .xls, .csv"
                            onChange={handleFileChange}
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
                            Excel (.xlsx) or CSV files up to 10MB
                        </p>
                    </div>
                </div>
            ) : (
                <div className="space-y-4">
                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #3b82f6' }}>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-500">Total Rows</p>
                                <p className="text-xl font-bold">{incidents.length}</p>
                            </div>
                            <FileSpreadsheet className="w-6 h-6 text-blue-300" />
                        </div>
                        <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #22c55e' }}>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-500">Valid Rows</p>
                                <p className="text-xl font-bold text-green-600">{incidents.filter(i => i._status === 'VALID').length}</p>
                            </div>
                            <CheckCircle className="w-6 h-6 text-green-300" />
                        </div>
                        <div className="card p-4 flex items-center justify-between" style={{ borderLeft: '4px solid #ef4444' }}>
                            <div>
                                <p className="text-xs uppercase font-bold text-gray-500">Errors</p>
                                <p className="text-xl font-bold text-red-600">{incidents.filter(i => i._status === 'INVALID').length}</p>
                            </div>
                            <AlertCircle className="w-6 h-6 text-red-300" />
                        </div>
                    </div>

                    {/* Data Table */}
                    <div className="card overflow-hidden">
                        <div className="card-header flex items-center justify-between p-4 border-b">
                            <span className="font-bold">Data Preview</span>
                            <div className="flex gap-2">
                                <button onClick={reset} className="px-4 py-2 text-sm font-medium border rounded-md hover:bg-white transition-colors bg-white">
                                    Start Over
                                </button>
                                <button 
                                    onClick={handleUpload}
                                    disabled={uploading || incidents.some(i => i._status === 'INVALID') || incidents.length === 0}
                                    className="px-6 py-2 text-white rounded-md font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    style={{ backgroundColor: 'var(--bfp-maroon)' }}
                                >
                                    {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                    Commit Valid Rows
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
                                    {incidents.map((incident, i) => (
                                        <tr key={incident._id} className={`border-b ${incident._status === 'INVALID' ? 'bg-red-50/30' : 'hover:bg-gray-50'}`}>
                                            <td className="px-4 py-3">
                                                {incident._status === 'VALID' ? (
                                                    <CheckCircle className="w-4 h-4 text-green-500" />
                                                ) : (
                                                    <AlertCircle className="w-4 h-4 text-red-500" />
                                                )}
                                            </td>
                                            <td className="px-4 py-3 font-medium">
                                                {incident.incident_nonsensitive_details.notification_dt ? incident.incident_nonsensitive_details.notification_dt.substring(0, 10) : 'Missing'}
                                            </td>
                                            <td className="px-4 py-3">{incident._city_text || 'Missing'}</td>
                                            <td className="px-4 py-3">{incident.incident_nonsensitive_details.general_category}</td>
                                            <td className="px-4 py-3">{incident.incident_nonsensitive_details.alarm_level}</td>
                                            <td className="px-4 py-3 text-red-600 text-xs truncate max-w-[200px]" title={incident._errors.join(', ')}>
                                                {incident._errors.join(', ')}
                                            </td>
                                            <td className="px-4 py-3 text-right">
                                                <button 
                                                    onClick={() => {
                                                        sessionStorage.setItem('temp_afor_review', JSON.stringify(incident));
                                                        router.push('/afor/create');
                                                    }}
                                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                                >
                                                    {incident._status === 'INVALID' ? 'Fix Error' : 'Review'}
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
