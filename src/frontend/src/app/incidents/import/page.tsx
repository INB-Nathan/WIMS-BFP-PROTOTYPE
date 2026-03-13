'use client';

import { useState, useEffect } from 'react';
import { useUserProfile } from '@/lib/auth';
import { edgeFunctions, Incident } from '@/lib/edgeFunctions';
import { ChevronLeft, Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Download, X, AlertTriangle, Trash2, Edit2, Save } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as XLSX from 'xlsx';
import { createClient } from '@/lib/supabaseClient';

const supabase = createClient();

interface MappedIncident extends Incident {
    _id: string; // Internal ID for UI tracking
    _originalRow: any; // Keep original for reference
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

    // Edit Modal State
    const [editingIncidentId, setEditingIncidentId] = useState<string | null>(null);

    // Geo Reference Data
    const [regions, setRegions] = useState<any[]>([]);
    const [provinces, setProvinces] = useState<any[]>([]);
    const [cities, setCities] = useState<any[]>([]);
    const [barangays, setBarangays] = useState<any[]>([]);
    const [loadingRefs, setLoadingRefs] = useState(false);

    useEffect(() => {
        if (!loading && role !== 'ENCODER') {
            router.push('/dashboard');
        }
    }, [role, loading, router]);

    // Fetch Geo Data
    useEffect(() => {
        const fetchGeoRefs = async () => {
            if (!assignedRegionId) return;
            setLoadingRefs(true);
            try {
                const { data: regionsData } = await supabase.from('ref_regions').select('*').eq('region_id', assignedRegionId);
                if (regionsData) setRegions(regionsData);

                const { data: provincesData } = await supabase.from('ref_provinces').select('*').eq('region_id', assignedRegionId);
                const provinceIds = provincesData?.map(p => p.province_id) || [];
                if (provincesData) setProvinces(provincesData);

                let citiesData: any[] = [];
                if (provinceIds.length > 0) {
                    const { data } = await supabase.from('ref_cities').select('*').in('province_id', provinceIds);
                    citiesData = data || [];
                    setCities(citiesData);
                }

                if (citiesData.length > 0) {
                    const cityIds = citiesData.map(c => c.city_id);
                    const { data: barangaysData } = await supabase.from('ref_barangays').select('*').in('city_id', cityIds);
                    if (barangaysData) setBarangays(barangaysData);
                }

            } catch (err) {
                console.error("Error fetching geo refs:", err);
            } finally {
                setLoadingRefs(false);
            }
        };
        fetchGeoRefs();
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
        let cityId = 0;
        let provinceId = 0;
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
                errors.push(`Barangay '${brgyInput}' not found in ${matchedCity?.city_name}.`);
            }
        } else if (!brgyInput) {
            errors.push("Barangay is required.");
        }

        // 3. Construct Incident
        if (!row['Notification Date'] && !row['notification_dt']) errors.push("Notification Date is missing");

        const incident: Incident = {
            region_id: assignedRegionId || 0,
            incident_nonsensitive_details: {
                notification_dt: row['Notification Date'] || row['notification_dt'] || new Date().toISOString(),
                barangay: brgyInput || 'Unknown',
                barangay_id: barangayId, // Fixed syntax here
                city_id: cityId,
                province_id: provinceId,
                district_id: 1,
                general_category: row['Category'] || row['general_category'] || 'Residential',
                incident_type: row['Classification'] || row['incident_type'] || 'Structural',
                alarm_level: row['Alarm Level'] || row['alarm_level'] || 'First Alarm',
                responder_type: row['Responder Type'] || row['responder_type'] || 'First Responder',
                structures_affected: parseInt(row['Structures Affected'] || row['structures_affected'] || '0'),
                households_affected: parseInt(row['Families Affected'] || row['households_affected'] || '0'),
                individuals_affected: parseInt(row['Individuals Affected'] || row['individuals_affected'] || '0'),
                fire_origin: row['Area of Origin'] || row['fire_origin'] || '',
                extent_of_damage: row['Extent of Damage'] || row['extent_of_damage'] || '',
                resources_deployed: { engines: 0, ambulances: 0 },
                problems_encountered: []
            },
            incident_sensitive_details: {
                occupancy: 'Residential',
                casualties_count: 0,
                estimated_damage: parseInt(row['Est. Damage'] || row['estimated_damage'] || '0'),
                caller_name: row['Caller Name'] || row['caller_name'] || '',
                caller_number: '',
                receiver_name: row['Receiver Name'] || row['receiver_name'] || '',
                owner_name: row['Owner Name'] || row['owner_name'] || '',
                establishment_name: row['Establishment Name'] || row['establishment_name'] || '',
                personnel_on_duty: { commander: row['Commander'] || '', nozzleman: '' },
                narrative_report: row['Narrative'] || row['narrative_report'] || '',
            }
        };

        return {
            ...incident,
            _id: `row-${index}-${Date.now()}`,
            _originalRow: row,
            _errors: errors,
            _status: errors.length > 0 ? 'INVALID' : 'VALID'
        };
    };

    const handleUpdateRow = (id: string, field: string, value: any) => {
        setIncidents(prev => prev.map(inc => {
            if (inc._id !== id) return inc;

            const newInc = JSON.parse(JSON.stringify(inc));
            let newErrors = [...inc._errors];

            if (field === 'city_id') {
                const city = cities.find(c => c.city_id === parseInt(value));
                if (city) {
                    newInc.incident_nonsensitive_details.city_id = city.city_id;
                    newInc.incident_nonsensitive_details.province_id = city.province_id;
                    newErrors = newErrors.filter(e => !e.includes('City'));

                    newInc.incident_nonsensitive_details.barangay_id = undefined;
                    newErrors = newErrors.filter(e => !e.includes('Barangay'));
                    newErrors.push(`Barangay needs re-selection.`);
                }
            }

            if (field === 'barangay_id') {
                const brgy = barangays.find(b => b.barangay_id === parseInt(value));
                if (brgy) {
                    newInc.incident_nonsensitive_details.barangay_id = brgy.barangay_id;
                    newInc.incident_nonsensitive_details.barangay = brgy.barangay_name;
                    newErrors = newErrors.filter(e => !e.includes('Barangay'));
                }
            }

            if (newInc.incident_nonsensitive_details.city_id) {
                newErrors = newErrors.filter(e => !e.includes('City'));
            }
            if (newInc.incident_nonsensitive_details.barangay_id) {
                newErrors = newErrors.filter(e => !e.includes('Barangay'));
            }

            const status = newErrors.length > 0 ? 'INVALID' : 'VALID';
            return { ...newInc, _errors: newErrors, _status: status };
        }));
    };

    const handleSaveFullEdit = (updatedIncident: MappedIncident) => {
        // Validation logic can be re-run here if needed
        // For now, assume modal handles most, we just update state
        setIncidents(prev => prev.map(i => i._id === updatedIncident._id ? updatedIncident : i));
        setEditingIncidentId(null);
    };

    const handleDeleteRow = (id: string) => {
        if (window.confirm("Are you sure you want to remove this row from the import list?")) {
            setIncidents(prev => prev.filter(i => i._id !== id));
        }
    };

    const handleUpload = async () => {
        const validIncidents = incidents.filter(i => i._status === 'VALID');
        if (validIncidents.length === 0 || !assignedRegionId) return;

        // Confirmation Dialog
        const confirmMsg = `You are about to upload ${validIncidents.length} incidents.\n\nAre you sure all details are correct? This action will create official records.`;
        if (!window.confirm(confirmMsg)) return;

        setUploading(true);
        setError(null);

        try {
            const payloadIncidents: Incident[] = validIncidents.map(({ _id, _originalRow, _errors, _status, ...rest }) => rest);

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
                'Families Affected': 5,
                'Individuals Affected': 20,
                'Est. Damage': 50000,
                'Area of Origin': 'Kitchen',
                'Extent of Damage': 'Partial',
                'Caller Name': 'Juan Dela Cruz',
                'Receiver Name': 'Operator A',
                'Owner Name': 'Maria Clara',
                'Establishment Name': 'N/A',
                'Commander': 'F/Insp. Pag-asa',
                'Narrative': 'Fire started at...'
            }
        ];
        const ws = XLSX.utils.json_to_sheet(headers);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Template");
        XLSX.writeFile(wb, "BFP_Incident_Template.xlsx");
    };

    if (loading || loadingRefs) return (
        <div className="flex h-screen items-center justify-center">
            <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
                <p className="text-sm text-gray-500">Loading Configuration...</p>
            </div>
        </div>
    );

    if (role !== 'ENCODER') return null;

    const editingIncident = incidents.find(i => i._id === editingIncidentId);

    return (
        <div className="space-y-6 relative">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/dashboard" className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                        <ChevronLeft className="w-6 h-6 text-gray-600" />
                    </Link>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Import Incidents</h1>
                        {assignedRegionId && <p className="text-sm text-gray-500">Region {assignedRegionId}</p>}
                    </div>
                </div>
                <button
                    onClick={downloadTemplate}
                    className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                    <Download className="w-4 h-4" /> Download Template
                </button>
            </div>

            {/* Edit Modal */}
            {editingIncident && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
                        <EditIncidentModal
                            incident={editingIncident}
                            onClose={() => setEditingIncidentId(null)}
                            onSave={handleSaveFullEdit}
                        />
                    </div>
                </div>
            )}

            {!showReview ? (
                <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto space-y-6">
                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center bg-gray-50 hover:bg-gray-100 transition-colors">
                        <input
                            type="file"
                            accept=".xlsx, .xls, .csv"
                            onChange={handleFileChange}
                            className="hidden"
                            id="file-upload"
                        />
                        <label htmlFor="file-upload" className="cursor-pointer flex flex-col items-center">
                            <Upload className="w-16 h-16 text-gray-400 mb-4" />
                            <span className="text-xl font-bold text-gray-900">Click to upload dataset</span>
                            <span className="text-sm font-medium text-gray-600 mt-2">Supports XLSX, CSV</span>
                        </label>
                    </div>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Review Header */}
                    <div className="flex items-center justify-between bg-white p-4 rounded-lg shadow-sm border border-gray-200 sticky top-0 z-10">
                        <div className="flex items-center gap-4">
                            <div className="bg-blue-100 p-2 rounded">
                                <FileSpreadsheet className="w-6 h-6 text-blue-600" />
                            </div>
                            <div>
                                <h2 className="font-bold text-gray-900">{file?.name}</h2>
                                <p className="text-xs text-gray-500">{incidents.length} rows detected • {incidents.filter(i => i._status === 'VALID').length} valid</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => {
                                    if (window.confirm("Discard all changes and cancel import?")) {
                                        setFile(null); setIncidents([]); setShowReview(false);
                                    }
                                }}
                                className="px-4 py-2 text-sm text-gray-600 hover:text-red-600 font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpload}
                                disabled={uploading || incidents.some(i => i._status === 'INVALID') || incidents.length === 0}
                                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-bold shadow-sm disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Upload Validated Bundle
                            </button>
                        </div>
                    </div>

                    {/* Validation Feedback */}
                    {incidents.some(i => i._status === 'INVALID') && (
                        <div className="bg-orange-50 border-l-4 border-orange-500 p-4 rounded-md flex items-start gap-3">
                            <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5" />
                            <div>
                                <h3 className="text-sm font-bold text-orange-900">Attention Needed</h3>
                                <p className="text-sm text-orange-800 mt-1">
                                    Some rows have missing or invalid locations. Please use the dropdowns or 'Edit' button to correct them.
                                </p>
                            </div>
                        </div>
                    )}

                    {success && (
                        <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded flex items-start gap-3">
                            <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-green-700">{success}</p>
                        </div>
                    )}

                    {error && (
                        <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded flex items-start gap-3">
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-700">{error}</p>
                        </div>
                    )}

                    {/* Review Grid */}
                    <div className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm whitespace-nowrap">
                                <thead className="bg-gray-50 border-b border-gray-200">
                                    <tr>
                                        <th className="p-3 font-semibold text-gray-700 w-12">Status</th>
                                        <th className="p-3 font-semibold text-gray-700">Date</th>
                                        <th className="p-3 font-semibold text-gray-700 w-48">City</th>
                                        <th className="p-3 font-semibold text-gray-700 w-48">Barangay</th>
                                        <th className="p-3 font-semibold text-gray-700">Type</th>
                                        <th className="p-3 font-semibold text-gray-700">Est. Damage</th>
                                        <th className="p-3 font-semibold text-gray-700 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {incidents.map((incident) => (
                                        <tr key={incident._id} className={incident._status === 'INVALID' ? 'bg-red-50/50' : 'hover:bg-gray-50'}>
                                            <td className="p-3">
                                                {incident._status === 'VALID' ?
                                                    <CheckCircle className="w-5 h-5 text-green-500" /> :
                                                    <span title={incident._errors.join(', ')}>
                                                        <AlertCircle className="w-5 h-5 text-red-500" />
                                                    </span>
                                                }
                                            </td>
                                            <td className="p-3 text-gray-900">{incident.incident_nonsensitive_details.notification_dt.substring(0, 10)}</td>

                                            <td className="p-3">
                                                <div className="flex flex-col">
                                                    <select
                                                        className={`w-full text-xs border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 ${!incident.incident_nonsensitive_details.city_id ? 'border-red-300 bg-red-50' : ''}`}
                                                        value={incident.incident_nonsensitive_details.city_id || ''}
                                                        onChange={(e) => handleUpdateRow(incident._id, 'city_id', e.target.value)}
                                                    >
                                                        <option value="">-- Select --</option>
                                                        {cities.map(c => (
                                                            <option key={c.city_id} value={c.city_id}>{c.city_name}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </td>

                                            <td className="p-3">
                                                <div className="flex flex-col">
                                                    <select
                                                        className={`w-full text-xs border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 ${!incident.incident_nonsensitive_details.barangay_id ? 'border-red-300 bg-red-50' : ''}`}
                                                        value={incident.incident_nonsensitive_details.barangay_id || ''}
                                                        onChange={(e) => handleUpdateRow(incident._id, 'barangay_id', e.target.value)}
                                                        disabled={!incident.incident_nonsensitive_details.city_id}
                                                    >
                                                        <option value="">-- Select --</option>
                                                        {incident.incident_nonsensitive_details.city_id ?
                                                            barangays
                                                                .filter(b => b.city_id === incident.incident_nonsensitive_details.city_id)
                                                                .map(b => (
                                                                    <option key={b.barangay_id} value={b.barangay_id}>{b.barangay_name}</option>
                                                                ))
                                                            : null
                                                        }
                                                    </select>
                                                </div>
                                            </td>

                                            <td className="p-3 text-gray-600">{incident.incident_nonsensitive_details.general_category}</td>
                                            <td className="p-3 text-gray-600">₱{incident.incident_sensitive_details.estimated_damage?.toLocaleString()}</td>

                                            <td className="p-3 text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    <button
                                                        onClick={() => setEditingIncidentId(incident._id)}
                                                        className="p-1 hover:bg-blue-100 rounded text-blue-600 transition-colors"
                                                        title="Edit Full Details"
                                                    >
                                                        <Edit2 className="w-4 h-4" />
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteRow(incident._id)}
                                                        className="p-1 hover:bg-red-100 rounded text-red-600 transition-colors"
                                                        title="Remove Row"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </div>
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

// Simple Edit Modal Component
function EditIncidentModal({ incident, onClose, onSave }: { incident: MappedIncident, onClose: () => void, onSave: (i: MappedIncident) => void }) {
    // Local state for editing. Clone deep.
    const [data, setData] = useState<MappedIncident>(JSON.parse(JSON.stringify(incident)));

    const handleChange = (section: 'ns' | 'sens', field: string, value: any) => {
        setData(prev => {
            const copy = { ...prev };
            if (section === 'ns') {
                // @ts-ignore
                copy.incident_nonsensitive_details[field] = value;
            } else {
                // @ts-ignore
                copy.incident_sensitive_details[field] = value;
            }
            return copy;
        });
    };

    const handleSave = () => {
        // Can add more validation here
        onSave(data);
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-lg">
            <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-lg">
                <h3 className="text-lg font-bold text-gray-900">Edit Incident Details</h3>
                <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
                    <X className="w-6 h-6" />
                </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">

                {/* Section A: Non-Sensitive */}
                <div className="space-y-4">
                    <h4 className="font-bold text-red-800 border-b pb-1">General Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold mb-1">Date/Time</label>
                            <input
                                type="datetime-local"
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_nonsensitive_details.notification_dt ? new Date(data.incident_nonsensitive_details.notification_dt).toISOString().slice(0, 16) : ''}
                                onChange={(e) => handleChange('ns', 'notification_dt', new Date(e.target.value).toISOString())}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold mb-1">Alarm Level</label>
                            <select
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_nonsensitive_details.alarm_level}
                                onChange={(e) => handleChange('ns', 'alarm_level', e.target.value)}
                            >
                                <option>First Alarm</option>
                                <option>Second Alarm</option>
                                <option>Third Alarm</option>
                                <option>General Alarm</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold mb-1">Category</label>
                            <input
                                type="text"
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_nonsensitive_details.general_category}
                                onChange={(e) => handleChange('ns', 'general_category', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold mb-1">Type/Classification</label>
                            <input
                                type="text"
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_nonsensitive_details.incident_type}
                                onChange={(e) => handleChange('ns', 'incident_type', e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {/* Section B: Sensitive */}
                <div className="space-y-4">
                    <h4 className="font-bold text-red-800 border-b pb-1">Sensitive Details</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold mb-1">Establishment Name</label>
                            <input
                                type="text"
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_sensitive_details.establishment_name}
                                onChange={(e) => handleChange('sens', 'establishment_name', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold mb-1">Owner Name</label>
                            <input
                                type="text"
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_sensitive_details.owner_name}
                                onChange={(e) => handleChange('sens', 'owner_name', e.target.value)}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold mb-1">Est. Damage (PHP)</label>
                            <input
                                type="number"
                                className="w-full border rounded p-2 text-sm"
                                value={data.incident_sensitive_details.estimated_damage}
                                onChange={(e) => handleChange('sens', 'estimated_damage', parseInt(e.target.value) || 0)}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold mb-1">Narrative Report</label>
                        <textarea
                            className="w-full border rounded p-2 text-sm h-32"
                            value={data.incident_sensitive_details.narrative_report}
                            onChange={(e) => handleChange('sens', 'narrative_report', e.target.value)}
                        />
                    </div>
                </div>
            </div>

            <div className="p-4 border-t flex justify-end gap-2 bg-gray-50 rounded-b-lg">
                <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium">Cancel</button>
                <button onClick={handleSave} className="px-6 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700">Save Changes</button>
            </div>
        </div>
    );
}
