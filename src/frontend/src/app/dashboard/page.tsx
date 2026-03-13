'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { edgeFunctions, AnalyticsSummaryResponse } from '@/lib/edgeFunctions';
import { RefreshCw, Download, HelpCircle, Calendar, X, Info, FileText, Upload } from 'lucide-react';

import Link from 'next/link';

export default function DashboardPage() {
    const { user, loading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;
    const assignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;
    const [analytics, setAnalytics] = useState<AnalyticsSummaryResponse | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [filterFeedback, setFilterFeedback] = useState<string | null>(null);

    // Filter States
    const [fromDate, setFromDate] = useState('');
    const [toDate, setToDate] = useState('');
    const [selectedRegion, setSelectedRegion] = useState('');
    const [selectedProvince, setSelectedProvince] = useState('');
    const [selectedCity, setSelectedCity] = useState('');
    const [selectedType, setSelectedType] = useState('');

    // Reference Data States
    const [regions, setRegions] = useState<any[]>([]);
    const [provinces, setProvinces] = useState<any[]>([]);
    const [cities, setCities] = useState<any[]>([]);

    const authorizedForAnalytics = role === 'ADMIN' || role === 'ANALYST' || role === 'SYSTEM_ADMIN' || ((role === 'ENCODER' || role === 'VALIDATOR') && !assignedRegionId);

    // Fetch Regions on mount
    useEffect(() => {
        const fetchRegions = async () => {
            const { createClient } = await import('@/lib/supabaseClient');
            const supabase = createClient();
            const { data } = await supabase.from('ref_regions').select('*').order('region_id');
            if (data) setRegions(data);
        };
        fetchRegions();
    }, []);

    // Fetch Provinces when Region changes
    useEffect(() => {
        if (!selectedRegion) {
            setProvinces([]);
            setSelectedProvince('');
            return;
        }
        const fetchProvinces = async () => {
            const { createClient } = await import('@/lib/supabaseClient');
            const supabase = createClient();
            const { data } = await supabase.from('ref_provinces').select('*').eq('region_id', selectedRegion).order('province_name');
            if (data) setProvinces(data);
            setSelectedProvince('');
            setSelectedCity('');
        };
        fetchProvinces();
    }, [selectedRegion]);

    // Fetch Cities when Province changes
    useEffect(() => {
        if (!selectedProvince) {
            setCities([]);
            setSelectedCity('');
            return;
        }
        const fetchCities = async () => {
            const { createClient } = await import('@/lib/supabaseClient');
            const supabase = createClient();
            const { data } = await supabase.from('ref_cities').select('*').eq('province_id', selectedProvince).order('city_name');
            if (data) setCities(data);
            setSelectedCity('');
        };
        fetchCities();
    }, [selectedProvince]);


    useEffect(() => {
        if (role && authorizedForAnalytics) {
            // Initial fetch without filters
            fetchAnalytics();
        }
    }, [role, authorizedForAnalytics]);

    // Pre-select assigned region if applicable
    useEffect(() => {
        if (assignedRegionId) {
            setSelectedRegion(assignedRegionId.toString());
        }
    }, [assignedRegionId]);

    const fetchAnalytics = async () => {
        if (!authorizedForAnalytics) return;

        setIsRefreshing(true);
        try {
            const filters: any = {};
            if (fromDate) filters.from_date = fromDate;
            if (toDate) filters.to_date = toDate;
            if (selectedRegion) filters.region_id = parseInt(selectedRegion);
            if (selectedProvince) filters.province_id = parseInt(selectedProvince);
            if (selectedCity) filters.city_id = parseInt(selectedCity);

            const data = await edgeFunctions.getAnalyticsSummary(filters);
            setAnalytics(data);

            // Feedback
            if (data?.total_incidents === 0) {
                setFilterFeedback("No incidents found matching these filters.");
            } else {
                setFilterFeedback(null);
            }

        } catch (e) {
            console.error("Failed to fetch analytics", e);
            setFilterFeedback("Error loading data. Please try again.");
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleApplyFilters = () => {
        if (!authorizedForAnalytics) return;
        fetchAnalytics();
        setFilterFeedback("Filters applied. Refreshing data...");
        setTimeout(() => setFilterFeedback(null), 2000); // Clear "Applied" msg
    };

    const handleClearFilters = () => {
        setFromDate('');
        setToDate('');
        if (assignedRegionId) {
            setSelectedRegion(assignedRegionId.toString());
            // Keep province/city cleared if region is locked? 
            // Or maybe keep region logic clean.
            setSelectedProvince('');
            setSelectedCity('');
        } else {
            setSelectedRegion('');
            setSelectedProvince('');
            setSelectedCity('');
        }
        setSelectedType('');
        if (authorizedForAnalytics) fetchAnalytics();
    };

    const handleExport = () => {
        if (!analytics) return;

        // Simple CSV generation
        const headers = "Category,Count\n";
        const rows = analytics.by_general_category.map(c => `${c.general_category},${c.count}`).join("\n");
        const total = `TOTAL,${analytics.total_incidents}\n`;
        const csvContent = "data:text/csv;charset=utf-8," + headers + total + rows;

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "bfp_analytics_export.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };


    // Mock Data for Detail Grids (Same as before)
    const STRUCTURAL_TYPES = [
        { name: 'Apartment Building', count: 0, percentage: '0%' },
        { name: 'Condominiums', count: 0, percentage: '0%' },
        { name: 'Dormitory', count: 0, percentage: '0%' },
        { name: 'Hotel', count: 0, percentage: '0%' },
        { name: 'Lodging and Rooming Houses', count: 0, percentage: '0%' },
        { name: 'Single and Two Family Dwelling', count: 0, percentage: '0%' },
        { name: 'Residential', count: 0, percentage: '0%' },
        { name: 'Assembly', count: 0, percentage: '0%' },
        { name: 'Business', count: 0, percentage: '0%' },
        { name: 'Day Care', count: 0, percentage: '0%' },
        { name: 'Detention and Correctional', count: 0, percentage: '0%' },
        { name: 'Educational', count: 0, percentage: '0%' },
        { name: 'Healthcare', count: 0, percentage: '0%' },
        { name: 'Industrial', count: 0, percentage: '0%' },
        { name: 'Mercantile', count: 0, percentage: '0%' },
        { name: 'Mixed Occupancies', count: 0, percentage: '0%' },
        { name: 'Residential Board and Care', count: 0, percentage: '0%' },
        { name: 'Special Structures', count: 0, percentage: '0%' },
        { name: 'Storage', count: 0, percentage: '0%' },
    ];

    const NON_STRUCTURAL_TYPES = [
        { name: 'Agricultural Land', count: 0, percentage: '0%' },
        { name: 'Forest Fire', count: 0, percentage: '0%' },
        { name: 'Grass Fire', count: 0, percentage: '0%' },
        { name: 'Brush Fire', count: 0, percentage: '0%' },
        { name: 'Grazing Land Fire', count: 0, percentage: '0%' },
        { name: 'Mineral Land Fire', count: 0, percentage: '0%' },
        { name: 'Peatland Fire', count: 0, percentage: '0%' },
        { name: 'Ambulant Vendor', count: 0, percentage: '0%' },
        { name: 'Electrical Post Fire', count: 0, percentage: '0%' },
        { name: 'Rubbish Fire', count: 0, percentage: '0%' },
    ];

    const TRANSPORTATION_TYPES = [
        { name: 'Automobile', count: 0, percentage: '0%' },
        { name: 'Bus', count: 0, percentage: '0%' },
        { name: 'Jeepney', count: 0, percentage: '0%' },
        { name: 'Motorcycle', count: 0, percentage: '0%' },
        { name: 'Tricycle', count: 0, percentage: '0%' },
        { name: 'Truck', count: 0, percentage: '0%' },
        { name: 'Heavy Equipment', count: 0, percentage: '0%' },
        { name: 'Ship/ Water Vessel', count: 0, percentage: '0%' },
        { name: 'Aircraft', count: 0, percentage: '0%' },
        { name: 'Locomotive', count: 0, percentage: '0%' },
    ];
    // In a real app we'd map `analytics.by_general_category` to these based on sub-types if available.

    return (
        <div className="space-y-6 relative">
            {/* Header / Title Section */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-gray-200 pb-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-900">BFP Incident Dashboard</h1>
                    <p className="text-sm text-gray-700 mt-1">
                        Real-time monitoring and analysis of fire incidents.
                        {(role === 'ENCODER' || role === 'VALIDATOR') && assignedRegionId && (
                            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                Region {assignedRegionId}
                            </span>
                        )}
                    </p>
                </div>

                <div className="flex gap-2">
                    {authorizedForAnalytics && (
                        <>
                            <button
                                onClick={fetchAnalytics}
                                className={`flex items-center gap-2 bg-white border border-gray-300 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium transition-colors ${isRefreshing ? 'opacity-70 cursor-wait' : ''}`}
                                disabled={isRefreshing}
                            >
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                                Refresh
                            </button>
                            <button
                                onClick={handleExport}
                                className="flex items-center gap-2 bg-white border border-gray-300 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium transition-colors"
                            >
                                <Download className="w-4 h-4" /> Export
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => setShowHelp(true)}
                        className="flex items-center gap-2 bg-white border border-gray-300 text-gray-800 px-4 py-2 rounded-md hover:bg-gray-50 text-sm font-medium transition-colors"
                    >
                        <HelpCircle className="w-4 h-4" /> Help
                    </button>
                </div>
            </div>

            {/* National Encoders / Validators: Workflow Clarification */}
            {(role === 'ENCODER' || role === 'VALIDATOR') && !assignedRegionId && (
                <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-md">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <Info className="h-5 w-5 text-blue-600" aria-hidden="true" />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-blue-900 font-medium">
                                National Headquarters Mode
                            </p>
                            <p className="text-xs text-blue-800 mt-1">
                                As a National Encoder/Validator, your primary role is to **Import AFOR Files** collected from the regions.
                                Regional personnel do NOT log into this system directly; they provide files for you to upload.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Regional Encoders: Warning */}
            {(role === 'ENCODER' || role === 'VALIDATOR') && assignedRegionId && (
                <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-r-md">
                    <div className="flex">
                        <div className="flex-shrink-0">
                            <Info className="h-5 w-5 text-blue-400" aria-hidden="true" />
                        </div>
                        <div className="ml-3">
                            <p className="text-sm text-blue-700">
                                <span className="font-bold">Regional View:</span> You are viewing data for Region {assignedRegionId}.
                                Please note that incident encoding is done via Bundle Uploads processed by National Headquarters.
                            </p>
                        </div>
                    </div>
                </div>
            )}


            {/* Filters Bar (Only for Authorized Roles) */}
            {authorizedForAnalytics ? (
                <div className="bg-red-900 p-5 rounded-lg text-white shadow-lg grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-5 items-end">
                    {/* Date From */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-red-100">Date [From]</label>
                        <div className="relative">
                            <input
                                type="date"
                                value={fromDate}
                                onChange={(e) => setFromDate(e.target.value)}
                                className="w-full bg-red-800 border border-red-700 rounded-md py-2 px-3 text-sm text-white placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                            />
                        </div>
                    </div>
                    {/* Date To */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-red-100">Date [To]</label>
                        <input
                            type="date"
                            value={toDate}
                            onChange={(e) => setToDate(e.target.value)}
                            className="w-full bg-red-800 border border-red-700 rounded-md py-2 px-3 text-sm text-white placeholder-red-300 focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
                        />
                    </div>

                    {/* Quick Date Filters */}
                    <div className="flex flex-wrap gap-2 self-center">
                        <button onClick={() => {
                            const d = new Date(); d.setDate(d.getDate() - 7);
                            setFromDate(d.toISOString().split('T')[0]);
                            setToDate(new Date().toISOString().split('T')[0]);
                        }} className="bg-red-800 hover:bg-red-700 text-xs font-medium px-3 py-1.5 rounded-full transition-colors border border-red-700">7 days</button>
                        <button onClick={() => {
                            const d = new Date(); d.setDate(d.getDate() - 30);
                            setFromDate(d.toISOString().split('T')[0]);
                            setToDate(new Date().toISOString().split('T')[0]);
                        }} className="bg-red-800 hover:bg-red-700 text-xs font-medium px-3 py-1.5 rounded-full transition-colors border border-red-700">30 days</button>
                        <button onClick={() => {
                            const d = new Date(); d.setDate(d.getDate() - 90);
                            setFromDate(d.toISOString().split('T')[0]);
                            setToDate(new Date().toISOString().split('T')[0]);
                        }} className="bg-red-800 hover:bg-red-700 text-xs font-medium px-3 py-1.5 rounded-full transition-colors border border-red-700">90 days</button>
                    </div>

                    {/* Region Select */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-red-100">Region</label>
                        <select
                            value={selectedRegion}
                            onChange={(e) => setSelectedRegion(e.target.value)}
                            disabled={!!assignedRegionId}
                            className="w-full bg-red-800 border border-red-700 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer disabled:opacity-70 disabled:cursor-not-allowed"
                        >
                            <option value="">All Regions</option>
                            {regions.map(r => (
                                <option key={r.region_id} value={r.region_id}>{r.region_name} ({r.region_code})</option>
                            ))}
                        </select>
                    </div>

                    {/* Province Select */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-red-100">Province</label>
                        <select
                            value={selectedProvince}
                            onChange={(e) => setSelectedProvince(e.target.value)}
                            disabled={!selectedRegion}
                            className="w-full bg-red-800 border border-red-700 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <option value="">All Provinces</option>
                            {provinces.map(p => (
                                <option key={p.province_id} value={p.province_id}>{p.province_name}</option>
                            ))}
                        </select>
                    </div>

                    {/* City Select */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-red-100">City/Municipality</label>
                        <select
                            value={selectedCity}
                            onChange={(e) => setSelectedCity(e.target.value)}
                            disabled={!selectedProvince}
                            className="w-full bg-red-800 border border-red-700 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            <option value="">All Cities</option>
                            {cities.map(c => (
                                <option key={c.city_id} value={c.city_id}>{c.city_name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Incident Type Select */}
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider mb-1 text-red-100">Incident Type</label>
                        <select
                            value={selectedType}
                            onChange={(e) => setSelectedType(e.target.value)}
                            className="w-full bg-red-800 border border-red-700 rounded-md py-2 px-3 text-sm text-white focus:outline-none focus:ring-2 focus:ring-red-500 cursor-pointer"
                        >
                            <option value="">All Types</option>
                            <option value="STRUCTURAL">Structural</option>
                            <option value="NON_STRUCTURAL">Non-Structural</option>
                            <option value="VEHICULAR">Vehicular</option>
                        </select>
                    </div>

                    {/* Apply Button */}
                    <div className="flex gap-2">
                        <button
                            onClick={handleApplyFilters}
                            className="bg-green-600 hover:bg-green-500 text-white font-bold text-sm px-4 py-2 rounded-md flex-1 transition-colors shadow-sm"
                        >
                            Apply
                        </button>
                        <button
                            onClick={handleClearFilters}
                            className="bg-white/10 hover:bg-white/20 text-white text-sm px-3 py-2 rounded-md transition-colors backdrop-blur-sm"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            ) : (
                <div className="p-8 bg-gray-50 text-center rounded-lg border border-gray-200">
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">Analytics Access Limited</h3>
                    <p className="text-gray-600 text-sm">Your role ({role}) does not have access to aggregate analytics. Please use the sidebar to manage specific incident records.</p>
                </div>
            )}

            {/* Filter Feedback Toast/Banner */}
            {filterFeedback && (
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded shadow-sm animate-fade-in">
                    <div className="flex">
                        <div className="ml-3">
                            <p className="text-sm text-yellow-800 font-medium">{filterFeedback}</p>
                        </div>
                    </div>
                </div>
            )}

            {/* View Only for Authorized */}
            {authorizedForAnalytics && (
                <>
                    {/* Summary Cards Row (Clickable) */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        <Link href="/incidents" className="block transform transition-transform hover:-translate-y-1">
                            <SummaryCard
                                title="Total Fire Incidents"
                                value={analytics?.total_incidents?.toLocaleString() ?? "0"}
                                subtext="Click to view all"
                                color="bg-gradient-to-br from-red-700 to-red-800"
                            />
                        </Link>

                        <Link href="/incidents?category=STRUCTURAL" className="block transform transition-transform hover:-translate-y-1">
                            <SummaryCard
                                title="Structural"
                                value={analytics?.by_general_category?.find(c => c.general_category === 'STRUCTURAL')?.count.toLocaleString() ?? "0"}
                                subtext="Click to view details"
                                color="bg-gradient-to-br from-orange-600 to-orange-700"
                            />
                        </Link>

                        <Link href="/incidents?category=NON_STRUCTURAL" className="block transform transition-transform hover:-translate-y-1">
                            <SummaryCard
                                title="Non-Structural"
                                value={analytics?.by_general_category?.find(c => c.general_category === 'NON_STRUCTURAL')?.count.toLocaleString() ?? "0"}
                                subtext="Click to view details"
                                color="bg-gradient-to-br from-green-600 to-green-700"
                            />
                        </Link>

                        <Link href="/incidents?category=VEHICULAR" className="block transform transition-transform hover:-translate-y-1">
                            <SummaryCard
                                title="Transportation Vehicle"
                                value={analytics?.by_general_category?.find(c => c.general_category === 'VEHICULAR')?.count.toLocaleString() ?? "0"}
                                subtext="Click to view details"
                                color="bg-gradient-to-br from-blue-600 to-blue-700"
                            />
                        </Link>

                        <div className="block">
                            <SummaryCard
                                title="Avg Response Time"
                                value="00 min"
                                subtext="Not available"
                                color="bg-gradient-to-br from-red-800 to-red-900"
                            />
                        </div>
                    </div>


                    {/* Structural Breakdown Grid (Clickable) */}
                    <div>
                        <h3 className="text-lg font-bold mb-4 border-l-4 border-gray-900 pl-2 text-gray-900">Structural</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {STRUCTURAL_TYPES.map((type, idx) => (
                                <Link key={idx} href={`/incidents?category=STRUCTURAL&type=${encodeURIComponent(type.name)}`} className="block">
                                    <DetailedCard name={type.name} count={type.count} percentage={type.percentage} color="bg-orange-600" />
                                </Link>
                            ))}
                        </div>
                    </div>

                    {/* Non-Structural Breakdown Grid */}
                    <div className="mt-8">
                        <h3 className="text-lg font-bold mb-4 border-l-4 border-gray-900 pl-2 text-gray-900">Non-Structural</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {NON_STRUCTURAL_TYPES.map((type, idx) => (
                                <Link key={idx} href={`/incidents?category=NON_STRUCTURAL&type=${encodeURIComponent(type.name)}`} className="block">
                                    <DetailedCard name={type.name} count={type.count} percentage={type.percentage} color="bg-green-600" />
                                </Link>
                            ))}
                        </div>
                    </div>

                    {/* Transportation Breakdown Grid */}
                    <div className="mt-8">
                        <h3 className="text-lg font-bold mb-4 border-l-4 border-gray-900 pl-2 text-gray-900">Transportation Vehicle</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                            {TRANSPORTATION_TYPES.map((type, idx) => (
                                <Link key={idx} href={`/incidents?category=VEHICULAR&type=${encodeURIComponent(type.name)}`} className="block">
                                    <DetailedCard name={type.name} count={type.count} percentage={type.percentage} color="bg-blue-700" />
                                </Link>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {/* Help Modal */}
            {showHelp && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 relative">
                        <button onClick={() => setShowHelp(false)} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
                            <X className="w-5 h-5" />
                        </button>
                        <h2 className="text-xl font-bold mb-4 text-gray-900">Dashboard Help</h2>
                        <div className="space-y-3 text-sm text-gray-800">
                            <p><strong>Filters:</strong> Use the top bar to filter incident data by Date Range, Region, or Type. Click 'Apply' to update the charts.</p>
                            <p><strong>Drill-down:</strong> Click on any of the large summary cards or small sub-category cards to view the specific list of incidents.</p>
                            <p><strong>Export:</strong> Downloads a CSV file of the current summary view.</p>
                            {role === 'ENCODER' && <p className="text-blue-700 bg-blue-50 p-2 rounded"><strong>National Encoders:</strong> Your main task is to import AFOR bundles from regions. See the sidebar or actions panel.</p>}
                        </div>
                        <div className="mt-6 flex justify-end">
                            <button onClick={() => setShowHelp(false)} className="bg-red-700 text-white px-4 py-2 rounded hover:bg-red-800 transition">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Role Specific Actions (Only visible if you have the role) */}
            {role === 'ENCODER' && (
                <div className="mt-8 p-6 bg-blue-50 border border-blue-200 rounded-lg">
                    <h3 className="text-lg font-bold text-blue-900 mb-4">Encoder Actions</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                        {/* Manual Entry Card */}
                        <Link href="/incidents/create" className="group block bg-white p-6 rounded-lg shadow-sm border border-blue-100 hover:shadow-md hover:border-blue-300 transition-all">
                            <div className="flex items-center gap-4 mb-3">
                                <div className="p-3 bg-red-100 text-red-700 rounded-full group-hover:bg-red-600 group-hover:text-white transition-colors">
                                    <FileText className="w-6 h-6" />
                                </div>
                                <h4 className="text-lg font-bold text-gray-800">Manual Entry</h4>
                            </div>
                            <p className="text-sm text-gray-600">
                                Create a single incident report manually. Use this for individual incident encoding.
                            </p>
                        </Link>

                        {/* Import Data Card */}
                        <Link href="/incidents/import" className="group block bg-white p-6 rounded-lg shadow-sm border border-blue-100 hover:shadow-md hover:border-blue-300 transition-all">
                            <div className="flex items-center gap-4 mb-3">
                                <div className="p-3 bg-blue-100 text-blue-700 rounded-full group-hover:bg-blue-600 group-hover:text-white transition-colors">
                                    <Upload className="w-6 h-6" />
                                </div>
                                <h4 className="text-lg font-bold text-gray-800">Import Data</h4>
                            </div>
                            <p className="text-sm text-gray-600">
                                Bulk upload incidents from Excel (XLSX) or CSV files. Best for batch processing.
                            </p>
                        </Link>

                    </div>
                </div>
            )}
        </div>
    );
}

function SummaryCard({ title, value, subtext, color }: { title: string; value: string; subtext: string; color: string }) {
    return (
        <div className={`${color} text-white p-5 rounded-lg shadow-md relative overflow-hidden h-32 flex flex-col justify-between hover:shadow-lg transition-shadow`}>
            <div className="relative z-10">
                <div className="text-xs font-semibold uppercase tracking-wider opacity-90">{title}</div>
                <div className="text-3xl font-bold mt-1 tracking-tight">{value}</div>
            </div>
            <div className="relative z-10 text-xs opacity-75 flex items-center gap-1 font-medium">
                {subtext}
            </div>
            {/* Visual element placeholder */}
            <div className="absolute -right-4 -bottom-4 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
        </div>
    );
}

function DetailedCard({ name, count, percentage, color }: { name: string; count: number; percentage: string; color: string }) {
    return (
        <div className={`${color} text-white p-3 rounded shadow-sm relative h-20 flex flex-col justify-between hover:brightness-110 transition-all cursor-default`}>
            <div className="text-xs font-medium mb-1 leading-tight line-clamp-2">{name}</div>
            <div className="flex items-end justify-between">
                <div className="text-xl font-bold">{count}</div>
                <div className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded backdrop-blur-sm">{percentage}</div>
            </div>
        </div>
    );
}
