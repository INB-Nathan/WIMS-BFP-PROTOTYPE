'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { fetchRegions, fetchProvinces, fetchCities } from '@/lib/api';
import { edgeFunctions, AnalyticsSummaryResponse } from '@/lib/edgeFunctions';
import { RefreshCw, Download, HelpCircle, X, Info, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Flame, Building2, TreePine, Car, Clock } from 'lucide-react';
import Link from 'next/link';

// Subcategory data
const STRUCTURAL_TYPES = [
    'Apartment Building', 'Condominiums', 'Dormitory', 'Hotel',
    'Lodging and Rooming Houses', 'Single and Two Family Dwelling',
    'Residential', 'Assembly', 'Business', 'Day Care',
    'Detention and Correctional', 'Educational', 'Healthcare',
    'Industrial', 'Mercantile', 'Mixed Occupancies',
    'Residential Board and Care', 'Special Structures', 'Storage',
];

const NON_STRUCTURAL_TYPES = [
    'Agricultural Land', 'Forest Fire', 'Grass Fire', 'Brush Fire',
    'Grazing Land Fire', 'Mineral Land Fire', 'Peatland Fire',
    'Ambulant Vendor', 'Electrical Post Fire', 'Rubbish Fire',
];

const TRANSPORTATION_TYPES = [
    'Automobile', 'Bus', 'Jeepney', 'Motorcycle', 'Tricycle',
    'Truck', 'Heavy Equipment', 'Ship/ Water Vessel', 'Aircraft', 'Locomotive',
];

const ITEMS_PER_PAGE = 10;

export default function DashboardPage() {
    const router = useRouter();
    const { user, loading } = useAuth();
    const role = (user as { role?: string })?.role ?? null;

    useEffect(() => {
        if (!loading && role === 'SYSTEM_ADMIN') {
            router.replace('/admin/system');
        } else if (!loading && role === 'REGIONAL_ENCODER') {
            router.replace('/dashboard/regional');
        }
    }, [loading, role, router]);

    const assignedRegionId = (user as { assignedRegionId?: number | null })?.assignedRegionId ?? null;

    if (!loading && role === 'SYSTEM_ADMIN') {
        return <div className="flex items-center justify-center min-h-[40vh] text-gray-500">Redirecting to Admin Hub...</div>;
    }

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

    // Reference Data
    const [regions, setRegions] = useState<any[]>([]);
    const [provinces, setProvinces] = useState<any[]>([]);
    const [cities, setCities] = useState<any[]>([]);

    // Accordion state
    const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
    const [subcategoryPage, setSubcategoryPage] = useState(1);

    const authorizedForAnalytics = role === 'ADMIN' || role === 'ANALYST' || role === 'SYSTEM_ADMIN' || ((role === 'ENCODER' || role === 'VALIDATOR') && !assignedRegionId);

    useEffect(() => { fetchRegions().then(setRegions); }, []);

    useEffect(() => {
        if (!selectedRegion) { setProvinces([]); setSelectedProvince(''); return; }
        fetchProvinces(selectedRegion).then(setProvinces);
        setSelectedProvince(''); setSelectedCity('');
    }, [selectedRegion]);

    useEffect(() => {
        if (!selectedProvince) { setCities([]); setSelectedCity(''); return; }
        fetchCities(selectedProvince).then(setCities);
        setSelectedCity('');
    }, [selectedProvince]);

    useEffect(() => {
        if (role && authorizedForAnalytics) fetchAnalytics();
    }, [role, authorizedForAnalytics]);

    useEffect(() => {
        if (assignedRegionId) setSelectedRegion(assignedRegionId.toString());
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
            setFilterFeedback(data?.total_incidents === 0 ? "No incidents found matching these filters." : null);
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
        setTimeout(() => setFilterFeedback(null), 2000);
    };

    const handleClearFilters = () => {
        setFromDate(''); setToDate('');
        if (assignedRegionId) {
            setSelectedRegion(assignedRegionId.toString());
        } else {
            setSelectedRegion('');
        }
        setSelectedProvince(''); setSelectedCity(''); setSelectedType('');
        if (authorizedForAnalytics) fetchAnalytics();
    };

    const handleExport = () => {
        if (!analytics) return;
        const headers = "Category,Count\n";
        const rows = analytics.by_general_category.map(c => `${c.general_category},${c.count}`).join("\n");
        const total = `TOTAL,${analytics.total_incidents}\n`;
        const csvContent = "data:text/csv;charset=utf-8," + headers + total + rows;
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "bfp_analytics_export.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleCategoryClick = (category: string) => {
        if (expandedCategory === category) {
            setExpandedCategory(null);
        } else {
            setExpandedCategory(category);
            setSubcategoryPage(1);
        }
    };

    const getSubcategoryItems = () => {
        if (!expandedCategory) return [];
        switch (expandedCategory) {
            case 'STRUCTURAL': return STRUCTURAL_TYPES;
            case 'NON_STRUCTURAL': return NON_STRUCTURAL_TYPES;
            case 'VEHICULAR': return TRANSPORTATION_TYPES;
            default: return [];
        }
    };

    const subcategoryItems = getSubcategoryItems();
    const totalSubPages = Math.ceil(subcategoryItems.length / ITEMS_PER_PAGE);
    const paginatedItems = subcategoryItems.slice(
        (subcategoryPage - 1) * ITEMS_PER_PAGE,
        subcategoryPage * ITEMS_PER_PAGE
    );

    const getCategoryColor = (cat: string) => {
        switch (cat) {
            case 'STRUCTURAL': return { border: '#f97316', bg: '#fff7ed', text: '#c2410c' };
            case 'NON_STRUCTURAL': return { border: '#22c55e', bg: '#f0fdf4', text: '#15803d' };
            case 'VEHICULAR': return { border: '#3b82f6', bg: '#eff6ff', text: '#1d4ed8' };
            default: return { border: '#6b7280', bg: '#f9fafb', text: '#374151' };
        }
    };

    const summaryCards = [
        { key: 'total', title: 'Total Fire Incidents', icon: Flame, value: analytics?.total_incidents?.toLocaleString() ?? '0', borderColor: '#dc2626', href: '/incidents' },
        { key: 'STRUCTURAL', title: 'Structural', icon: Building2, value: analytics?.by_general_category?.find(c => c.general_category === 'STRUCTURAL')?.count.toLocaleString() ?? '0', borderColor: '#f97316' },
        { key: 'NON_STRUCTURAL', title: 'Non-Structural', icon: TreePine, value: analytics?.by_general_category?.find(c => c.general_category === 'NON_STRUCTURAL')?.count.toLocaleString() ?? '0', borderColor: '#22c55e' },
        { key: 'VEHICULAR', title: 'Vehicular', icon: Car, value: analytics?.by_general_category?.find(c => c.general_category === 'VEHICULAR')?.count.toLocaleString() ?? '0', borderColor: '#3b82f6' },
        { key: 'response', title: 'Avg Response', icon: Clock, value: '00 min', borderColor: '#991b1b', disabled: true },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        Incident Dashboard
                    </h1>
                    <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
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
                            <button onClick={fetchAnalytics} disabled={isRefreshing}
                                className={`card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors ${isRefreshing ? 'opacity-70' : ''}`}>
                                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} /> Refresh
                            </button>
                            <button onClick={handleExport} className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                                <Download className="w-4 h-4" /> Export
                            </button>
                        </>
                    )}
                    <button onClick={() => setShowHelp(true)} className="card flex items-center gap-2 px-3 py-2 text-sm font-medium hover:bg-gray-50 transition-colors">
                        <HelpCircle className="w-4 h-4" /> Help
                    </button>
                </div>
            </div>

            {/* Info Banners */}
            {(role === 'ENCODER' || role === 'VALIDATOR') && !assignedRegionId && (
                <div className="card overflow-hidden">
                    <div className="flex items-start gap-3 p-4" style={{ borderLeft: '4px solid #3b82f6' }}>
                        <Info className="h-5 w-5 text-blue-500 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>National Headquarters Mode</p>
                            <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                                As a National Encoder/Validator, your primary role is to Import AFOR Files collected from the regions.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {(role === 'ENCODER' || role === 'VALIDATOR') && assignedRegionId && (
                <div className="card overflow-hidden">
                    <div className="flex items-start gap-3 p-4" style={{ borderLeft: '4px solid #3b82f6' }}>
                        <Info className="h-5 w-5 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                                <span className="font-bold" style={{ color: 'var(--text-primary)' }}>Regional View:</span> You are viewing data for Region {assignedRegionId}.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Filter Bar */}
            {authorizedForAnalytics ? (
                <div className="card">
                    <div className="card-header flex items-center justify-between">
                        <span>Filters</span>
                        <div className="flex gap-1">
                            {[{ label: '7d', days: 7 }, { label: '30d', days: 30 }, { label: '90d', days: 90 }].map(({ label, days }) => (
                                <button key={label} onClick={() => {
                                    const d = new Date(); d.setDate(d.getDate() - days);
                                    setFromDate(d.toISOString().split('T')[0]);
                                    setToDate(new Date().toISOString().split('T')[0]);
                                }}
                                    className="text-[11px] font-medium px-2.5 py-1 rounded-full border hover:bg-gray-100 transition-colors"
                                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
                                >{label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="card-body">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4 items-end">
                            <FilterSelect label="Date From" type="date" value={fromDate} onChange={setFromDate} />
                            <FilterSelect label="Date To" type="date" value={toDate} onChange={setToDate} />
                            <FilterSelect label="Region" value={selectedRegion} onChange={setSelectedRegion} disabled={!!assignedRegionId}
                                options={[{ value: '', label: 'All Regions' }, ...regions.map(r => ({ value: r.region_id.toString(), label: `${r.region_name} (${r.region_code})` }))]} />
                            <FilterSelect label="Province" value={selectedProvince} onChange={setSelectedProvince} disabled={!selectedRegion}
                                options={[{ value: '', label: 'All Provinces' }, ...provinces.map(p => ({ value: p.province_id.toString(), label: p.province_name }))]} />
                            <FilterSelect label="City" value={selectedCity} onChange={setSelectedCity} disabled={!selectedProvince}
                                options={[{ value: '', label: 'All Cities' }, ...cities.map(c => ({ value: c.city_id.toString(), label: c.city_name }))]} />
                            <FilterSelect label="Type" value={selectedType} onChange={setSelectedType}
                                options={[{ value: '', label: 'All Types' }, { value: 'STRUCTURAL', label: 'Structural' }, { value: 'NON_STRUCTURAL', label: 'Non-Structural' }, { value: 'VEHICULAR', label: 'Vehicular' }]} />
                            <div className="flex gap-2">
                                <button onClick={handleApplyFilters}
                                    className="flex-1 text-sm font-bold py-2 px-3 rounded-md text-white transition-colors"
                                    style={{ backgroundColor: 'var(--bfp-maroon)' }}>Apply</button>
                                <button onClick={handleClearFilters}
                                    className="text-sm py-2 px-3 rounded-md border hover:bg-gray-50 transition-colors"
                                    style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>Clear</button>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                <div className="card">
                    <div className="card-body text-center py-8">
                        <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Analytics Access Limited</h3>
                        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Your role ({role}) does not have access to aggregate analytics.</p>
                    </div>
                </div>
            )}

            {/* Filter Feedback */}
            {filterFeedback && (
                <div className="card overflow-hidden">
                    <div className="flex items-center gap-3 p-3" style={{ borderLeft: '4px solid #eab308' }}>
                        <p className="text-sm font-medium" style={{ color: '#854d0e' }}>{filterFeedback}</p>
                    </div>
                </div>
            )}

            {/* Analytics */}
            {authorizedForAnalytics && (
                <>
                    {/* Summary Cards Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                        {summaryCards.map((card) => {
                            const isExpanded = expandedCategory === card.key;
                            const isClickable = card.key !== 'total' && card.key !== 'response';
                            const IconComp = card.icon;

                            if (card.key === 'total') {
                                return (
                                    <Link key={card.key} href="/incidents" className="block">
                                        <SummaryCard
                                            title={card.title} value={card.value} icon={<IconComp className="w-8 h-8" />}
                                            borderColor={card.borderColor} isExpanded={false}
                                        />
                                    </Link>
                                );
                            }

                            return (
                                <div key={card.key} onClick={isClickable ? () => handleCategoryClick(card.key) : undefined}
                                    className={isClickable ? 'cursor-pointer' : ''}>
                                    <SummaryCard
                                        title={card.title} value={card.value} icon={<IconComp className="w-8 h-8" />}
                                        borderColor={card.borderColor} isExpanded={isExpanded}
                                        showChevron={isClickable} disabled={card.disabled}
                                    />
                                </div>
                            );
                        })}
                    </div>

                    {/* Accordion Subcategory Panel */}
                    {expandedCategory && (
                        <div className="card accordion-enter overflow-hidden">
                            <div className="card-header flex items-center justify-between"
                                style={{ borderLeft: `4px solid ${getCategoryColor(expandedCategory).border}` }}>
                                <span>{expandedCategory.replace('_', '-')} Subcategories</span>
                                <button onClick={() => setExpandedCategory(null)} className="text-gray-400 hover:text-gray-600">
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="card-body">
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                                    {paginatedItems.map((name, idx) => (
                                        <Link key={idx} href={`/incidents?category=${expandedCategory}&type=${encodeURIComponent(name)}`}
                                            className="card p-3 hover:shadow-md transition-all group"
                                            style={{ borderTop: `3px solid ${getCategoryColor(expandedCategory).border}` }}>
                                            <div className="text-xs font-medium mb-2 leading-tight line-clamp-2"
                                                style={{ color: 'var(--text-primary)' }}>{name}</div>
                                            <div className="flex items-end justify-between">
                                                <span className="text-xl font-bold" style={{ color: getCategoryColor(expandedCategory).text }}>0</span>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium"
                                                    style={{ backgroundColor: getCategoryColor(expandedCategory).bg, color: getCategoryColor(expandedCategory).text }}>0%</span>
                                            </div>
                                        </Link>
                                    ))}
                                </div>

                                {/* Pagination */}
                                {totalSubPages > 1 && (
                                    <div className="flex items-center justify-center gap-2 mt-4 pt-4" style={{ borderTop: `1px solid var(--border-color)` }}>
                                        <button onClick={() => setSubcategoryPage(p => Math.max(1, p - 1))} disabled={subcategoryPage === 1}
                                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                            <ChevronLeft className="w-4 h-4" />
                                        </button>
                                        {Array.from({ length: totalSubPages }, (_, i) => i + 1).map(page => (
                                            <button key={page} onClick={() => setSubcategoryPage(page)}
                                                className={`w-8 h-8 rounded text-sm font-medium transition-colors ${page === subcategoryPage ? 'text-white' : 'hover:bg-gray-100'}`}
                                                style={page === subcategoryPage ? { backgroundColor: getCategoryColor(expandedCategory).border } : { color: 'var(--text-secondary)' }}>
                                                {page}
                                            </button>
                                        ))}
                                        <button onClick={() => setSubcategoryPage(p => Math.min(totalSubPages, p + 1))} disabled={subcategoryPage === totalSubPages}
                                            className="p-1.5 rounded hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                                            <ChevronRight className="w-4 h-4" />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Help Modal */}
            {showHelp && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
                    <div className="card max-w-md w-full relative">
                        <div className="card-header flex items-center justify-between">
                            <span className="text-base font-bold">Dashboard Help</span>
                            <button onClick={() => setShowHelp(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="card-body space-y-3 text-sm" style={{ color: 'var(--text-primary)' }}>
                            <p><strong>Filters:</strong> Use the filter bar to narrow data by Date Range, Region, or Type. Click 'Apply' to update.</p>
                            <p><strong>Drill-down:</strong> Click on category summary cards to expand subcategory details with pagination.</p>
                            <p><strong>Export:</strong> Downloads a CSV file of the current summary view.</p>
                        </div>
                        <div className="p-4 flex justify-end" style={{ borderTop: `1px solid var(--border-color)` }}>
                            <button onClick={() => setShowHelp(false)}
                                className="text-sm font-bold text-white px-4 py-2 rounded-md transition-colors"
                                style={{ backgroundColor: 'var(--bfp-maroon)' }}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── Subcomponents ─────────────────────────────────────────

function SummaryCard({ title, value, icon, borderColor, isExpanded, showChevron, disabled }: {
    title: string; value: string; icon: React.ReactNode; borderColor: string;
    isExpanded: boolean; showChevron?: boolean; disabled?: boolean;
}) {
    return (
        <div className={`card overflow-hidden transition-all duration-200 ${disabled ? 'opacity-60' : 'hover:shadow-md hover:-translate-y-0.5'}`}
            style={{ borderLeft: `4px solid ${borderColor}` }}>
            <div className="p-4 flex items-start justify-between">
                <div>
                    <div className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{title}</div>
                    <div className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{value}</div>
                </div>
                <div className="opacity-20" style={{ color: borderColor }}>{icon}</div>
            </div>
            {showChevron && (
                <div className="px-4 py-2 text-[11px] font-medium flex items-center gap-1" style={{ color: 'var(--text-muted)', borderTop: `1px solid var(--border-color)` }}>
                    {isExpanded ? <><ChevronUp className="w-3 h-3" /> Hide subcategories</> : <><ChevronDown className="w-3 h-3" /> View subcategories</>}
                </div>
            )}
        </div>
    );
}

function FilterSelect({ label, value, onChange, type, options, disabled }: {
    label: string; value: string; onChange: (v: string) => void;
    type?: string; options?: { value: string; label: string }[]; disabled?: boolean;
}) {
    const baseClass = "w-full rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed";

    return (
        <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
            {type === 'date' ? (
                <input type="date" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
                    className={baseClass} style={{ border: `1px solid var(--border-color)`, color: 'var(--text-primary)' }} />
            ) : (
                <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}
                    className={`${baseClass} cursor-pointer`} style={{ border: `1px solid var(--border-color)`, color: 'var(--text-primary)' }}>
                    {options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                </select>
            )}
        </div>
    );
}
