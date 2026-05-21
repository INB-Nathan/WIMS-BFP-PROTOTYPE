'use client';

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { edgeFunctions, Incident } from '@/lib/edgeFunctions';
import {
  updateRegionalIncident, forceReplaceIncident, createRegionalIncident,
  submitIncidentForReview,
  type RefDuplicateIncident,
  ApiRequestError,
} from '@/lib/api';
import { queueIncident, getPendingIncidents, markSynced } from '@/lib/offlineStore';
import { useUserProfile } from '@/lib/auth';
import { PH_REGIONS, getProvincesForRegion, getCitiesForProvince, getAforRegionIdentifier, getShortRegionName } from '@/lib/ph-regions';
import { Loader2, Save, Shuffle, Send } from 'lucide-react';
import dynamic from 'next/dynamic';
import {
  ALL_PROBLEM_OPTIONS, normalizeProblemLabel,
  getTypeOptionsForClassification, getTypeCode,
  generateReferenceNumberPreview, formatClassification,
} from '@/lib/afor-utils';
import { DuplicateIncidentModal } from './DuplicateIncidentModal';

const MapPicker = dynamic(
  () => import('./MapPicker').then((m) => m.MapPicker),
  { ssr: false, loading: () => <div className="h-64 bg-gray-100 animate-pulse rounded border" /> },
);

async function reverseGeocode(lat: number, lng: number): Promise<{ barangay: string; city: string; province: string; state: string } | null> {
  try {
    // zoom=18 → house-level detail; addressdetails=1 → full address breakdown
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18`,
      { headers: { 'Accept-Language': 'en' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};

    // Philippine address hierarchy in Nominatim:
    //   barangay  → quarter > suburb > village > neighbourhood > hamlet
    //   city/muni → city_district (most precise in NCR) > town > municipality > city
    //               (addr.city is often the region-level name in Metro Manila, so deprioritise it)
    //   province  → county (province outside NCR) or state (region name, last resort)
    const barangay =
      addr.quarter || addr.suburb || addr.village || addr.neighbourhood || addr.hamlet || '';
    const city =
      addr.city_district || addr.town || addr.municipality ||
      (addr.city && addr.city !== addr.state ? addr.city : '') || '';
    const province = addr.county || '';
    const state = addr.state || '';

    return { barangay, city, province, state };
  } catch {
    return null;
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const STAGE_OF_FIRE_OPTIONS = [
  'Incipient',
  'Growth',
  'Fully Developed',
  'Decay',
];

const ALARM_ROWS = [
  { key: 'alarm_foua', label: '1ST ALARM-FOUA' },
  { key: 'alarm_1st', label: '1ST ALARM' },
  { key: 'alarm_2nd', label: '2ND ALARM' },
  { key: 'alarm_3rd', label: '3RD ALARM' },
  { key: 'alarm_4th', label: '4TH ALARM' },
  { key: 'alarm_5th', label: '5TH ALARM' },
  { key: 'alarm_tf_alpha', label: 'TASK FORCE ALPHA' },
  { key: 'alarm_tf_bravo', label: 'TASK FORCE BRAVO' },
  { key: 'alarm_tf_charlie', label: 'TASK FORCE CHARLIE' },
  { key: 'alarm_tf_delta', label: 'TASK FORCE DELTA' },
  { key: 'alarm_general', label: 'GENERAL ALARM' },
  { key: 'alarm_fuc', label: 'FIRE UNDER CONTROL (FUC)' },
  { key: 'alarm_fo', label: 'FIRE OUT (FO)' },
] as const;

const VEHICLE_ROWS = [
  { key: 'resources_bfp_trucks', label: 'BFP Fire Trucks' },
  { key: 'resources_lgu_trucks', label: 'BFP Manned Fire Trucks (LGU)' },
  { key: 'resources_non_bfp_trucks', label: 'Non-BFP Fire Trucks' },
  { key: 'resources_bfp_ambulance', label: 'BFP Ambulance' },
  { key: 'resources_non_bfp_ambulance', label: 'Non-BFP Ambulance' },
  { key: 'resources_bfp_rescue', label: 'BFP Rescue Trucks' },
  { key: 'resources_non_bfp_rescue', label: 'Non-BFP Rescue Trucks' },
] as const;

const TOOL_ROWS: { key: string; label: string; type: 'number' | 'text' }[] = [
  { key: 'tools_scba', label: 'SCBA', type: 'number' },
  { key: 'tools_rope', label: 'Rope', type: 'text' },
  { key: 'tools_ladder', label: 'Ladder', type: 'number' },
  { key: 'tools_hoseline', label: 'Hoseline', type: 'text' },
  { key: 'tools_hydraulic', label: 'Hydraulic Tools', type: 'number' },
];

const POD_ROLES: { key: string; label: string; contactKey?: string }[] = [
  { key: 'pod_engine_commander', label: 'Engine Commander' },
  { key: 'pod_shift_in_charge', label: 'Shift-in-Charge' },
  { key: 'pod_nozzleman', label: 'Nozzleman' },
  { key: 'pod_lineman', label: 'Lineman' },
  { key: 'pod_engine_crew', label: 'Engine Crew' },
  { key: 'pod_driver', label: 'Driver / Pump Operator (DPO)' },
  { key: 'pod_safety_officer', label: 'Safety Officer in Charge', contactKey: 'pod_safety_officer_contact' },
  { key: 'pod_inv_name', label: 'Fire & Arson Investigator/s', contactKey: 'pod_inv_contact' },
];

const CASUALTY_ROWS = [
  { key: 'injured_civilian', label: 'Injured Civilian' },
  { key: 'injured_firefighter', label: 'Injured BFP Firefighter' },
  { key: 'injured_auxiliary', label: 'Injured Fire Auxiliary' },
  { key: 'fatal_civilian', label: 'Civilian Fatality/ies' },
  { key: 'fatal_firefighter', label: 'BFP Firefighter Fatality/ies' },
  { key: 'fatal_auxiliary', label: 'Fire Auxiliary Fatality/ies' },
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

// ── Component ────────────────────────────────────────────────────────────────

export function IncidentForm({
  initialData,
  existingIncidentId,
  onSaved,
  initialErrors,
}: {
  initialData?: Incident;
  existingIncidentId?: number;
  onSaved?: () => void;
  initialErrors?: string[];
}) {
  const router = useRouter();
  const { assignedRegionId, role } = useUserProfile();
  const isEncoder = role === 'REGIONAL_ENCODER' || role === 'ENCODER';
  const [loading, setLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(
    initialData?.region_id && initialData.region_id > 0 ? initialData.region_id : null
  );
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Set<string>>(new Set(initialErrors ?? []));
  const locationHydratedRef = useRef(false);
  const formHydratedRef = useRef(false);
  const submitAfterSaveRef = useRef(false);

  const showToast = (message: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  // H. Fire location from MapPicker
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [mapSearchQuery, setMapSearchQuery] = useState<string | undefined>(undefined);

  const [formState, setFormState] = useState({
    // A. Response Details
    responder_type: '',
    fire_station_name: '',
    notification_dt_date: '',
    notification_dt_time: '',
    region: '',
    province_district: '',
    city_municipality: '',
    barangay: '',
    incident_address: '',
    nearest_landmark: '',
    caller_name: '',
    caller_number: '',
    receiver_name: '',
    engine_dispatched: '',
    time_engine_dispatched: '',
    time_arrived_at_scene: '',
    engines: [
      { name: '', time_dispatched: '', time_arrived: '' },
      { name: '', time_dispatched: '', time_arrived: '' },
      { name: '', time_dispatched: '', time_arrived: '' },
    ] as { name: string; time_dispatched: string; time_arrived: string }[],
    total_response_time_minutes: '',
    distance_to_fire_scene_km: '',
    alarm_level: '',
    time_returned_to_base: '',
    total_gas_consumed_liters: '',

    // B. Nature and Classification
    classification_of_involved: '',
    type_of_involved_general_category: '',
    owner_name: '',
    general_description_of_involved: '',
    area_of_origin: '',
    stage_of_fire_upon_arrival: '',
    extent_of_damage: '',
    extent_description: '',
    extent_objects_count: '',
    extent_total_floor_area_sqm: '',
    extent_total_land_area_hectares: '',
    structures_affected: '',
    households_affected: '',
    families_affected: '',
    individuals_affected: '',
    vehicles_affected: '',

    // C. Assets & Resources
    resources_bfp_trucks: '',
    resources_lgu_trucks: '',
    resources_non_bfp_trucks: '',
    resources_bfp_ambulance: '',
    resources_non_bfp_ambulance: '',
    resources_bfp_rescue: '',
    resources_non_bfp_rescue: '',
    resources_others: '',
    tools_scba: '',
    tools_rope: '',
    tools_ladder: '',
    tools_hoseline: '',
    tools_hydraulic: '',
    tools_others: '',
    hydrant_location_distance: '',

    // D. Fire Alarm Level — datetime + commander per entry
    alarm_foua: '', alarm_foua_commander: '',
    alarm_1st: '', alarm_1st_commander: '',
    alarm_2nd: '', alarm_2nd_commander: '',
    alarm_3rd: '', alarm_3rd_commander: '',
    alarm_4th: '', alarm_4th_commander: '',
    alarm_5th: '', alarm_5th_commander: '',
    alarm_tf_alpha: '', alarm_tf_alpha_commander: '',
    alarm_tf_bravo: '', alarm_tf_bravo_commander: '',
    alarm_tf_charlie: '', alarm_tf_charlie_commander: '',
    alarm_tf_delta: '', alarm_tf_delta_commander: '',
    alarm_general: '', alarm_general_commander: '',
    alarm_fuc: '', alarm_fuc_commander: '',
    alarm_fo: '', alarm_fo_commander: '',
    icp_present: '',
    icp_location: '',

    // E. Profile of Casualties
    injured_civilian_m: '', injured_civilian_f: '',
    injured_firefighter_m: '', injured_firefighter_f: '',
    injured_auxiliary_m: '', injured_auxiliary_f: '',
    fatal_civilian_m: '', fatal_civilian_f: '',
    fatal_firefighter_m: '', fatal_firefighter_f: '',
    fatal_auxiliary_m: '', fatal_auxiliary_f: '',

    // F. Personnel On Duty
    pod_engine_commander: '',
    pod_shift_in_charge: '',
    pod_nozzleman: '',
    pod_lineman: '',
    pod_engine_crew: '',
    pod_driver: '',
    pod_pump_operator: '',
    pod_safety_officer: '',
    pod_safety_officer_contact: '',
    pod_inv_name: '',
    pod_inv_contact: '',

    // I. Narrative
    narrative_report: '',

    // J. Problems
    problems_encountered: [] as string[],
    problems_others: '',

    // J. Recommendations
    recommendations: '',

    // K. Disposition
    disposition: '',
    disposition_prepared_by: '',
    disposition_noted_by: '',

    // Reference Number fields
    station_code: 'TBA',
  });

  const [otherPersonnel, setOtherPersonnel] = useState<{ name: string; designation: string }[]>([
    { name: '', designation: '' },
    { name: '', designation: '' },
    { name: '', designation: '' },
  ]);

  // Duplicate detection modal state
  const [duplicateModalData, setDuplicateModalData] = useState<{
    duplicates: RefDuplicateIncident[];
    proceedCallback: () => Promise<void>;
  } | null>(null);


  // ── Derived reference number values ───────────────────────────────────────

  const incidentTypeCode = useMemo(
    () => getTypeCode(formState.classification_of_involved, formState.type_of_involved_general_category),
    [formState.classification_of_involved, formState.type_of_involved_general_category],
  );

  const referenceNumberPreview = useMemo(() => {
    const effectiveId = (isEncoder && assignedRegionId) ? assignedRegionId : selectedRegionId;
    const regionCode = effectiveId ? getAforRegionIdentifier(effectiveId) : '';
    return generateReferenceNumberPreview({
      regionCode,
      stationCode: formState.station_code || 'TBA',
      typeCode: incidentTypeCode,
      notificationDate: formState.notification_dt_date,
    });
  }, [isEncoder, assignedRegionId, selectedRegionId, formState.station_code, incidentTypeCode, formState.notification_dt_date]);

  // ── Utility helpers ────────────────────────────────────────────────────────

  const toDateTimeLocalValue = useCallback((raw: unknown): string => {
    if (!raw) return '';
    const value = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return `${value}T00:00`;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
      return match ? `${match[1]}T${match[2]}` : '';
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
  }, []);

  const buildNotificationDateTime = (dateValue: string, timeValue: string): string | undefined => {
    if (!dateValue) return undefined;
    const time = timeValue || '00:00';
    return `${dateValue}T${time}:00+08:00`;
  };

  const alarmEntryToDateTimeLocal = (entry: unknown): string => {
    if (!entry) return '';
    if (typeof entry === 'string' || typeof entry === 'number') return toDateTimeLocalValue(entry);
    if (typeof entry === 'object') {
      const obj = entry as Record<string, unknown>;
      return toDateTimeLocalValue(obj.time ?? obj.value ?? obj.datetime ?? '');
    }
    return '';
  };

  const alarmEntryToCommander = (entry: unknown): string => {
    if (!entry || typeof entry !== 'object') return '';
    const obj = entry as Record<string, unknown>;
    return String(obj.commander ?? '');
  };

  const normalizeRegionLabel = (value: unknown): string =>
    String(value ?? '')
      .toLowerCase()
      .replace(/region/gi, ' ')
      .replace(/[^a-z0-9]/g, '')
      .trim();

  const resolveRegionId = (): number | null => {
    // For encoders, their assigned region always wins — prevents submitting to wrong region
    if (isEncoder && assignedRegionId) return assignedRegionId;
    if (selectedRegionId) return selectedRegionId;
    if (assignedRegionId) return assignedRegionId;
    if (typeof initialData?.region_id === 'number' && initialData.region_id > 0) return initialData.region_id;
    const raw = formState.region?.trim();
    if (!raw) return null;
    const numeric = Number(raw);
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
    const norm = normalizeRegionLabel(raw);
    const match = PH_REGIONS.find((r) => normalizeRegionLabel(r.regionName) === norm);
    return match?.regionId ?? null;
  };

  const base64ToBlob = (base64: string): Blob => {
    const byteString = atob(base64.split(',')[1]);
    const mimeString = base64.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    return new Blob([ab], { type: mimeString });
  };

  // ── Effects ────────────────────────────────────────────────────────────────

  // Lock encoder to their assigned region always — also clears province/city if import brought wrong-region data
  useEffect(() => {
    if (!assignedRegionId) return;
    if (isEncoder) {
      setSelectedRegionId(assignedRegionId);
      const r = PH_REGIONS.find((r) => r.regionId === assignedRegionId);
      setFormState((prev) => {
        const validProvinces = getProvincesForRegion(assignedRegionId).map((p) => p.provinceName);
        const provinceOk = validProvinces.includes(prev.province_district);
        return {
          ...prev,
          region: r?.regionName ?? '',
          province_district: provinceOk ? prev.province_district : '',
          city_municipality: provinceOk ? prev.city_municipality : '',
        };
      });
    } else if (!selectedRegionId && !initialData) {
      setSelectedRegionId(assignedRegionId);
      const r = PH_REGIONS.find((r) => r.regionId === assignedRegionId);
      setFormState((prev) => ({ ...prev, region: r?.regionName ?? '' }));
    }
  }, [assignedRegionId, isEncoder]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!initialData || formHydratedRef.current) return;
    formHydratedRef.current = true;

    const ns = initialData.incident_nonsensitive_details || {};
    const sen = initialData.incident_sensitive_details || {};
    const res = (ns.resources_deployed || {}) as Record<string, Record<string, unknown>>;
    const timeline = (ns.alarm_timeline || {}) as Record<string, unknown>;
    const responseFields = (timeline._response as Record<string, string> | undefined) ?? {};
    const casualties = ((sen.casualty_details as { injured?: Record<string, unknown>; fatalities?: Record<string, unknown> }) || {});
    const injured = (casualties.injured || {}) as Record<string, unknown>;
    const fatalities = (casualties.fatalities || {}) as Record<string, unknown>;
    const ci = (injured.civilian as Record<string, unknown>) || {};
    const fi = ((injured.firefighter || injured.bfp) as Record<string, unknown>) || {};
    const ai = (injured.auxiliary as Record<string, unknown>) || {};
    const cf = (fatalities.civilian as Record<string, unknown>) || {};
    const ff = ((fatalities.firefighter || fatalities.bfp) as Record<string, unknown>) || {};
    const af = (fatalities.auxiliary as Record<string, unknown>) || {};

    let rawProblems = ns.problems_encountered;
    if (typeof rawProblems === 'string') {
      try { rawProblems = JSON.parse(rawProblems); } catch { rawProblems = []; }
    }
    const incomingProblems = Array.isArray(rawProblems)
      ? (rawProblems as unknown[]).map(String).filter(Boolean)
      : [];
    const normalizedOptionMap = new Map(ALL_PROBLEM_OPTIONS.map((o) => [normalizeProblemLabel(o), o]));
    const selectedProblems: string[] = [];
    const extraProblems: string[] = [];
    for (const p of incomingProblems) {
      const matched = normalizedOptionMap.get(normalizeProblemLabel(p));
      if (matched) selectedProblems.push(matched);
      else extraProblems.push(p);
    }
    const explicitOthers = typeof (ns as Record<string, unknown>).problems_others === 'string' ? (ns as Record<string, unknown>).problems_others as string : '';
    const combinedOthers = Array.from(new Set([explicitOthers, ...extraProblems].map((p) => p.trim()).filter(Boolean))).join(', ');

    const pod = (sen.personnel_on_duty || {}) as Record<string, unknown>;
    const podStr = (k: string) => String(pod[k] ?? '');
    const podContact = (k: string) => {
      const v = pod[k];
      if (!v) return '';
      if (typeof v === 'object') return String((v as Record<string, unknown>).contact ?? '');
      return '';
    };
    const podName = (k: string) => {
      const v = pod[k];
      if (!v) return '';
      if (typeof v === 'object') return String((v as Record<string, unknown>).name ?? '');
      return String(v);
    };

    // Resolve province/city from initial data
    const hydratedProvince = ns.province_district || (initialData as unknown as Record<string, unknown>)._province_text as string || '';
    const hydratedCity = initialData._city_text || ns.city_municipality || '';
    // Guard: if encoder's assigned region is known, discard province/city from a
    // different region (prevents the hydration effect from overwriting the lock effect).
    const encoderValidProvinces = (isEncoder && assignedRegionId)
      ? getProvincesForRegion(assignedRegionId).map((p) => p.provinceName)
      : null;
    const hydratedProvinceOk = !encoderValidProvinces || encoderValidProvinces.includes(hydratedProvince);

    setFormState((prev) => ({
      ...prev,
      responder_type: ns.responder_type || '',
      fire_station_name: ns.fire_station_name || '',
      notification_dt_date: toDateTimeLocalValue(ns.notification_dt).split('T')[0] || '',
      notification_dt_time: toDateTimeLocalValue(ns.notification_dt).split('T')[1] || '',
      region: ns.region || '',
      province_district: hydratedProvinceOk ? hydratedProvince : '',
      city_municipality: hydratedProvinceOk ? hydratedCity : '',
      barangay: ns.barangay || '',
      incident_address: ns.incident_address || (sen as Record<string, unknown>).street_address as string || '',
      nearest_landmark: ns.nearest_landmark || (sen as Record<string, unknown>).landmark as string || '',
      caller_name: sen.caller_name || '',
      caller_number: sen.caller_number || '',
      receiver_name: sen.receiver_name || ns.receiver_name || '',
      engine_dispatched: ns.engine_dispatched || responseFields.engine_dispatched || '',
      time_engine_dispatched: ns.time_engine_dispatched || responseFields.time_engine_dispatched || '',
      time_arrived_at_scene: ns.time_arrived_at_scene || responseFields.time_arrived_at_scene || '',
      engines: (() => {
        const stored = (timeline as Record<string, unknown>)._engines as { name: string; time_dispatched: string; time_arrived: string }[] | undefined;
        if (stored && stored.length > 0) {
          const rows = stored.map((e) => ({ name: e.name || '', time_dispatched: e.time_dispatched || '', time_arrived: e.time_arrived || '' }));
          while (rows.length < 3) rows.push({ name: '', time_dispatched: '', time_arrived: '' });
          return rows.slice(0, 3);
        }
        const legacyName = ns.engine_dispatched || responseFields.engine_dispatched || '';
        const legacyDisp = ns.time_engine_dispatched || responseFields.time_engine_dispatched || '';
        const legacyArr = ns.time_arrived_at_scene || responseFields.time_arrived_at_scene || '';
        return [
          { name: legacyName, time_dispatched: legacyDisp, time_arrived: legacyArr },
          { name: '', time_dispatched: '', time_arrived: '' },
          { name: '', time_dispatched: '', time_arrived: '' },
        ];
      })(),
      total_response_time_minutes: ns.total_response_time_minutes?.toString() || '',
      distance_to_fire_scene_km: (ns.distance_to_fire_scene_km ?? (ns as Record<string, unknown>).distance_from_station_km)?.toString() || '',
      alarm_level: ns.alarm_level || '',
      time_returned_to_base: ns.time_returned_to_base || responseFields.time_returned_to_base || '',
      total_gas_consumed_liters: ns.total_gas_consumed_liters?.toString() || '',

      classification_of_involved: (() => {
        const raw = ns.classification_of_involved || ns.general_category || '';
        const legacyMap: Record<string, string> = {
          'Structural': 'STRUCTURAL', 'Non-Structural': 'NON_STRUCTURAL',
          'Transportation': 'TRANSPORTATION', 'Vehicular': 'TRANSPORTATION',
          'Wildland': 'WILDLAND',
          // Backend normalizes TRANSPORTATION → VEHICULAR; map it back for the form dropdown
          'VEHICULAR': 'TRANSPORTATION',
        };
        return legacyMap[raw] ?? raw;
      })(),
      type_of_involved_general_category: (() => {
        const rawType = String(
          ns.type_of_involved_general_category ||
          (ns as Record<string, unknown>).sub_category ||
          (ns as Record<string, unknown>).incident_type ||
          ''
        );
        if (!rawType) return '';
        // Resolve classification first so we can look up valid options
        const rawClass = ns.classification_of_involved || ns.general_category || '';
        const legacyCM: Record<string, string> = {
          'Structural': 'STRUCTURAL', 'Non-Structural': 'NON_STRUCTURAL',
          'Transportation': 'TRANSPORTATION', 'Vehicular': 'TRANSPORTATION', 'Wildland': 'WILDLAND',
          'VEHICULAR': 'TRANSPORTATION',
        };
        const classification = legacyCM[rawClass] ?? rawClass;
        const opts = getTypeOptionsForClassification(classification);
        const exact = opts.find((o) => o.name === rawType);
        if (exact) return exact.name;
        const ci = opts.find((o) => o.name.toLowerCase() === rawType.toLowerCase());
        if (ci) return ci.name;
        // Try code match (e.g. "INF" → "Informal Settlement")
        const byCode = opts.find((o) => o.code.toLowerCase() === rawType.toLowerCase());
        if (byCode) return byCode.name;
        // Try partial name match for legacy stored values (e.g. "Apartment" → "Apartment Building")
        const partial = opts.find((o) => o.name.toLowerCase().startsWith(rawType.toLowerCase()) || rawType.toLowerCase().startsWith(o.name.toLowerCase()));
        if (partial) return partial.name;
        return rawType; // fall back to raw value; user can correct
      })(),
      station_code: (ns as Record<string, unknown>).station_code as string || 'TBA',
      owner_name: sen.owner_name || ns.owner_name || sen.establishment_name || ns.establishment_name || '',
      general_description_of_involved: ns.general_description_of_involved || responseFields.general_description_of_involved || '',
      area_of_origin: ns.area_of_origin || (ns as Record<string, unknown>).fire_origin as string || '',
      stage_of_fire_upon_arrival: ns.stage_of_fire_upon_arrival || (ns as Record<string, unknown>).stage_of_fire as string || '',
      extent_of_damage: ns.extent_of_damage || '',
      extent_description: (ns as Record<string, unknown>).extent_description as string || '',
      extent_objects_count: (ns as Record<string, unknown>).extent_objects_count?.toString() || '',
      extent_total_floor_area_sqm: ns.extent_total_floor_area_sqm?.toString() || '',
      extent_total_land_area_hectares: ns.extent_total_land_area_hectares?.toString() || '',
      structures_affected: ns.structures_affected?.toString() || '',
      households_affected: ns.households_affected?.toString() || '',
      families_affected: ns.families_affected?.toString() || '',
      individuals_affected: ns.individuals_affected?.toString() || '',
      vehicles_affected: ns.vehicles_affected?.toString() || '',

      resources_bfp_trucks: res.trucks?.bfp?.toString() || '',
      resources_lgu_trucks: res.trucks?.lgu?.toString() || '',
      resources_non_bfp_trucks: res.trucks?.volunteer?.toString() || res.trucks?.non_bfp?.toString() || '',
      resources_bfp_ambulance: res.medical?.bfp?.toString() || '',
      resources_non_bfp_ambulance: res.medical?.non_bfp?.toString() || '',
      resources_bfp_rescue: res.special_assets?.rescue_bfp?.toString() || '',
      resources_non_bfp_rescue: res.special_assets?.rescue_non_bfp?.toString() || '',
      resources_others: res.special_assets?.others?.toString() || '',

      tools_scba: res.tools?.scba?.toString() || '',
      tools_rope: res.tools?.rope?.toString() || '',
      tools_ladder: res.tools?.ladder?.toString() || '',
      tools_hoseline: res.tools?.hoseline?.toString() || '',
      tools_hydraulic: res.tools?.hydraulic?.toString() || '',
      tools_others: res.tools?.others?.toString() || '',
      hydrant_location_distance: res.hydrant_distance?.toString() || '',

      alarm_foua: alarmEntryToDateTimeLocal(timeline.alarm_foua),
      alarm_foua_commander: alarmEntryToCommander(timeline.alarm_foua),
      alarm_1st: alarmEntryToDateTimeLocal(timeline.alarm_1st),
      alarm_1st_commander: alarmEntryToCommander(timeline.alarm_1st),
      alarm_2nd: alarmEntryToDateTimeLocal(timeline.alarm_2nd),
      alarm_2nd_commander: alarmEntryToCommander(timeline.alarm_2nd),
      alarm_3rd: alarmEntryToDateTimeLocal(timeline.alarm_3rd),
      alarm_3rd_commander: alarmEntryToCommander(timeline.alarm_3rd),
      alarm_4th: alarmEntryToDateTimeLocal(timeline.alarm_4th),
      alarm_4th_commander: alarmEntryToCommander(timeline.alarm_4th),
      alarm_5th: alarmEntryToDateTimeLocal(timeline.alarm_5th),
      alarm_5th_commander: alarmEntryToCommander(timeline.alarm_5th),
      alarm_tf_alpha: alarmEntryToDateTimeLocal(timeline.alarm_tf_alpha ?? timeline.tf_alpha),
      alarm_tf_alpha_commander: alarmEntryToCommander(timeline.alarm_tf_alpha ?? timeline.tf_alpha),
      alarm_tf_bravo: alarmEntryToDateTimeLocal(timeline.alarm_tf_bravo ?? timeline.tf_bravo),
      alarm_tf_bravo_commander: alarmEntryToCommander(timeline.alarm_tf_bravo ?? timeline.tf_bravo),
      alarm_tf_charlie: alarmEntryToDateTimeLocal(timeline.alarm_tf_charlie ?? timeline.tf_charlie),
      alarm_tf_charlie_commander: alarmEntryToCommander(timeline.alarm_tf_charlie ?? timeline.tf_charlie),
      alarm_tf_delta: alarmEntryToDateTimeLocal(timeline.alarm_tf_delta ?? timeline.tf_delta),
      alarm_tf_delta_commander: alarmEntryToCommander(timeline.alarm_tf_delta ?? timeline.tf_delta),
      alarm_general: alarmEntryToDateTimeLocal(timeline.alarm_general ?? timeline.general),
      alarm_general_commander: alarmEntryToCommander(timeline.alarm_general ?? timeline.general),
      alarm_fuc: alarmEntryToDateTimeLocal(timeline.alarm_fuc ?? timeline.fuc),
      alarm_fuc_commander: alarmEntryToCommander(timeline.alarm_fuc ?? timeline.fuc),
      alarm_fo: alarmEntryToDateTimeLocal(timeline.alarm_fo ?? timeline.fo),
      alarm_fo_commander: alarmEntryToCommander(timeline.alarm_fo ?? timeline.fo),
      icp_present: sen.is_icp_present ? 'with' : (sen.icp_location ? 'with' : ''),
      icp_location: sen.icp_location || '',

      injured_civilian_m: ci.m?.toString() || '',
      injured_civilian_f: ci.f?.toString() || '',
      injured_firefighter_m: fi.m?.toString() || '',
      injured_firefighter_f: fi.f?.toString() || '',
      injured_auxiliary_m: ai.m?.toString() || '',
      injured_auxiliary_f: ai.f?.toString() || '',
      fatal_civilian_m: cf.m?.toString() || '',
      fatal_civilian_f: cf.f?.toString() || '',
      fatal_firefighter_m: ff.m?.toString() || '',
      fatal_firefighter_f: ff.f?.toString() || '',
      fatal_auxiliary_m: af.m?.toString() || '',
      fatal_auxiliary_f: af.f?.toString() || '',

      pod_engine_commander: podStr('engine_commander'),
      pod_shift_in_charge: podStr('shift_in_charge'),
      pod_nozzleman: podStr('nozzleman'),
      pod_lineman: podStr('lineman'),
      pod_engine_crew: podStr('engine_crew'),
      pod_driver: podStr('driver'),
      pod_pump_operator: podStr('pump_operator'),
      pod_safety_officer: podName('safety_officer'),
      pod_safety_officer_contact: podContact('safety_officer'),
      pod_inv_name: podName('fire_arson_investigator'),
      pod_inv_contact: podContact('fire_arson_investigator'),

      narrative_report: sen.narrative_report || '',
      recommendations: ns.recommendations || '',
      problems_encountered: selectedProblems,
      problems_others: combinedOthers,
      disposition: sen.disposition || '',
      disposition_prepared_by: (sen as Record<string, unknown>).prepared_by_officer as string
        || sen.disposition_prepared_by || '',
      disposition_noted_by: (sen as Record<string, unknown>).noted_by_officer as string
        || sen.disposition_noted_by || '',
    }));

    // Auto-geocode using only the complete address field — no city/province appended.
    // Only fires when no coordinates are pre-supplied (import without a prior map pin).
    const hydratedAddress = ns.incident_address || (sen as Record<string, unknown>).street_address as string || '';
    const hasCoords = typeof initialData.latitude === 'number' && typeof initialData.longitude === 'number';
    if (hydratedAddress && !hasCoords) {
      setMapSearchQuery(`${hydratedAddress}, Philippines`);
    }

    const people = (sen.other_personnel || ns.other_personnel) as Record<string, unknown>[] | undefined;
    if (people && Array.isArray(people)) {
      setOtherPersonnel(
        people.map((p: Record<string, unknown>) => ({
          name: String(p.name ?? ''),
          designation: String(p.designation ?? ''),
        }))
      );
    }
  }, [alarmEntryToDateTimeLocal, initialData]); // eslint-disable-line react-hooks/exhaustive-deps

  // M4 Bug 8-D: Sync the free-text "Others" field to the "Others" checkbox.
  // Non-empty text → ensure "Others" is in problems_encountered.
  // Empty text  → remove "Others" from problems_encountered.
  useEffect(() => {
    const othersText = String(formState.problems_others || '').trim();
    const hasText = othersText.length > 0;
    const list = formState.problems_encountered || [];
    const othersNorm = normalizeProblemLabel('Others');
    const othersInList = list.some((p) => normalizeProblemLabel(p) === othersNorm);
    if (hasText && !othersInList) {
      setFormState((prev) => ({
        ...prev,
        problems_encountered: [...(prev.problems_encountered || []), 'Others'],
      }));
    } else if (!hasText && othersInList) {
      setFormState((prev) => ({
        ...prev,
        problems_encountered: (prev.problems_encountered || []).filter(
          (p) => normalizeProblemLabel(p) !== othersNorm,
        ),
      }));
    }
  }, [formState.problems_others, formState.problems_encountered]);

  useEffect(() => {
    if (!initialData || locationHydratedRef.current) return;
    // Restore coordinates from initialData (top-level fields from API response)
    const lat = typeof initialData.latitude === 'number' ? initialData.latitude : null;
    const lng = typeof initialData.longitude === 'number' ? initialData.longitude : null;
    if (lat !== null) setLatitude(lat);
    if (lng !== null) setLongitude(lng);
    locationHydratedRef.current = true;
  }, [initialData]);

  // Hydrate region selection from initialData (edit mode)
  useEffect(() => {
    if (!initialData || selectedRegionId) return;
    const regionId = initialData.region_id;
    if (regionId && regionId > 0) {
      setSelectedRegionId(regionId);
      const r = PH_REGIONS.find((r) => r.regionId === regionId);
      if (r) setFormState((prev) => ({ ...prev, region: r.regionName }));
    }
  }, [initialData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive effective region ID — encoder's assigned region always wins
  const getEffectiveRegionId = (): number => {
    if (isEncoder && assignedRegionId) return assignedRegionId;
    if (selectedRegionId && selectedRegionId > 0) return selectedRegionId;
    if (formState.region) {
      const found = PH_REGIONS.find((r) => r.regionName === formState.region);
      return found?.regionId ?? 0;
    }
    return 0;
  };

  // Scroll to first highlighted error field when initialErrors are provided (edit→submit flow)
  useEffect(() => {
    if (!initialErrors?.length) return;
    const timer = setTimeout(() => {
      const el = document.querySelector('[data-field-error="true"]');
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 300);
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Event handlers ─────────────────────────────────────────────────────────

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormState((prev) => ({ ...prev, [name]: value }));
  };

  const handleClassificationChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setFormState((prev) => ({
      ...prev,
      classification_of_involved: e.target.value,
      type_of_involved_general_category: '', // reset type when classification changes
    }));
  };

  const handleRadioChange = (name: string, value: string) => {
    if (name === 'extent_of_damage') {
      setFormState((prev) => ({
        ...prev,
        [name]: value,
        extent_description: '',
        extent_total_floor_area_sqm: '',
        extent_total_land_area_hectares: '',
        extent_objects_count: '',
      }));
    } else {
      setFormState((prev) => ({ ...prev, [name]: value }));
    }
  };

  const handleOtherPersonnelChange = (index: number, field: string, value: string) => {
    const updated = [...otherPersonnel];
    (updated[index] as Record<string, string>)[field] = value;
    setOtherPersonnel(updated);
  };

  // ── Offline sync ───────────────────────────────────────────────────────────

  const checkPending = useCallback(async () => {
    const pending = await getPendingIncidents();
    setPendingCount(pending.length);
  }, []);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine) return;
    const pending = await getPendingIncidents();
    if (pending.length === 0) return;
    for (const item of pending) {
      try {
        const payload = item.payload as { region_id: number; incidents: Incident[] };
        const res = await edgeFunctions.uploadBundle(payload);
        const incidentId = res.incident_ids[0];
        const firstIncident = payload.incidents[0];
        const sketchList = firstIncident?.incident_sensitive_details?.sketch_images_base64 || [];
        if (Array.isArray(sketchList) && sketchList.length > 0) {
          for (const b64 of sketchList) {
            await edgeFunctions.uploadAttachment(incidentId, base64ToBlob(b64));
          }
        } else if (firstIncident?.incident_sensitive_details?.sketch_base64) {
          await edgeFunctions.uploadAttachment(incidentId, base64ToBlob(firstIncident.incident_sensitive_details.sketch_base64));
        }
        await markSynced(item.id!);
      } catch (e) {
        console.error('Failed to sync item', item.id, e);
      }
    }
    await checkPending();
  }, [checkPending]);

  useEffect(() => {
    checkPending();
    const handleOnline = () => syncPending();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncPending, checkPending]);

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setToast(null);
    setFieldErrors(new Set());
    submitAfterSaveRef.current = false;
    const effectiveRegionId = resolveRegionId() ?? 0;
    await doCreateIncident(effectiveRegionId);
  };

  const handleSubmitForReview = async (e: React.MouseEvent) => {
    e.preventDefault();
    setToast(null);
    setFieldErrors(new Set());

    // Region constraint: encoder can only submit for their assigned region
    if (isEncoder && assignedRegionId) {
      const effectiveId = resolveRegionId();
      if (effectiveId && effectiveId !== assignedRegionId) {
        const name = getShortRegionName(assignedRegionId);
        showToast(`You can only submit incidents for your assigned region (${name}).`);
        return;
      }
    }

    // Full required-field validation — mirrors detail page handleSubmitClick
    const isEmpty = (v: unknown) => !v || String(v).trim() === '' || String(v).trim().toUpperCase() === 'N/A';
    const submitErrors = new Set<string>();
    if (!formState.responder_type) submitErrors.add('responder_type');
    if (!formState.fire_station_name) submitErrors.add('fire_station_name');
    if (!formState.notification_dt_date) submitErrors.add('notification_dt_date');
    if (!formState.province_district?.trim()) submitErrors.add('province_district');
    if (!formState.city_municipality?.trim()) submitErrors.add('city_municipality');
    if (!formState.alarm_level) submitErrors.add('alarm_level');
    if (!formState.classification_of_involved) submitErrors.add('classification_of_involved');
    if (formState.classification_of_involved && !formState.type_of_involved_general_category) submitErrors.add('type_of_involved_general_category');
    if (!formState.extent_of_damage) submitErrors.add('extent_of_damage');
    if (latitude === null || longitude === null) submitErrors.add('map_location');
    const preparedBy = formState.disposition_prepared_by?.trim();
    const notedBy = formState.disposition_noted_by?.trim();
    if (isEmpty(preparedBy)) submitErrors.add('disposition_prepared_by');
    if (isEmpty(notedBy)) submitErrors.add('disposition_noted_by');

    if (submitErrors.size > 0) {
      setFieldErrors(submitErrors);
      showToast('Please complete all required fields before submitting for review.');
      setTimeout(() => {
        const el = document.querySelector('[data-field-error="true"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }

    submitAfterSaveRef.current = true;
    const effectiveRegionId = resolveRegionId() ?? 0;
    await doCreateIncident(effectiveRegionId);
  };

  const doCreateIncident = async (effectiveRegionId: number) => {
    const locationErrors = new Set<string>();
    if (!effectiveRegionId) locationErrors.add('region');
    if (!formState.province_district?.trim()) locationErrors.add('province_district');
    if (!formState.city_municipality?.trim()) locationErrors.add('city_municipality');
    // Guard: encoder cannot submit province/city from a different region
    if (isEncoder && effectiveRegionId && formState.province_district?.trim()) {
      const validProvinces = getProvincesForRegion(effectiveRegionId).map((p) => p.provinceName);
      if (validProvinces.length > 0 && !validProvinces.includes(formState.province_district)) {
        locationErrors.add('province_district');
        locationErrors.add('city_municipality');
      }
    }
    if (locationErrors.size > 0) {
      setFieldErrors(locationErrors);
      showToast('Region, Province/District, and City/Municipality are required before saving.');
      setTimeout(() => {
        const el = document.querySelector('[data-field-error="true"]');
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
      return;
    }
    setLoading(true);
    const fs = formState as Record<string, unknown>;
    const alarmEntry = (key: string) => {
      const dt = fs[key] as string | undefined;
      const cmd = fs[`${key}_commander`] as string | undefined;
      if (!dt) return null;
      return { time: dt, commander: cmd || null };
    };

    const incident = {
      latitude,
      longitude,
      region_id: effectiveRegionId,
      incident_nonsensitive_details: {
        notification_dt: buildNotificationDateTime(formState.notification_dt_date, formState.notification_dt_time),
        region: formState.region,
        province_district: formState.province_district,
        city_municipality: formState.city_municipality,
        incident_address: formState.incident_address,
        nearest_landmark: formState.nearest_landmark || 'N/A',
        fire_station_name: formState.fire_station_name,
        responder_type: formState.responder_type,
        engine_dispatched: formState.engine_dispatched || 'N/A',
        time_engine_dispatched: formState.time_engine_dispatched || 'N/A',
        time_arrived_at_scene: formState.time_arrived_at_scene || 'N/A',
        total_response_time_minutes: parseInt(formState.total_response_time_minutes) || 0,
        distance_to_fire_scene_km: parseFloat(formState.distance_to_fire_scene_km) || 0,
        alarm_level: formState.alarm_level,
        time_returned_to_base: formState.time_returned_to_base || 'N/A',
        total_gas_consumed_liters: parseFloat(formState.total_gas_consumed_liters) || 0,
        barangay: formState.barangay || '',
        // B
        general_category: formState.classification_of_involved,
        incident_type: formState.type_of_involved_general_category,
        classification_of_involved: formState.classification_of_involved,
        type_of_involved_general_category: formState.type_of_involved_general_category,
        incident_type_code: incidentTypeCode || undefined,
        station_code: formState.station_code || 'TBA',
        owner_name: formState.owner_name || 'N/A',
        establishment_name: formState.owner_name || 'N/A',
        general_description_of_involved: formState.general_description_of_involved || 'N/A',
        area_of_origin: formState.area_of_origin || 'N/A',
        fire_origin: formState.area_of_origin || 'N/A',
        stage_of_fire: formState.stage_of_fire_upon_arrival,
        stage_of_fire_upon_arrival: formState.stage_of_fire_upon_arrival,
        extent_of_damage: formState.extent_of_damage,
        extent_description: formState.extent_description || null,
        extent_objects_count: parseInt(formState.extent_objects_count) || null,
        extent_total_floor_area_sqm: parseFloat(formState.extent_total_floor_area_sqm) || 0,
        extent_total_land_area_hectares: parseFloat(formState.extent_total_land_area_hectares) || 0,
        structures_affected: parseInt(formState.structures_affected) || 0,
        households_affected: parseInt(formState.households_affected) || 0,
        families_affected: parseInt(formState.families_affected) || 0,
        individuals_affected: parseInt(formState.individuals_affected) || 0,
        vehicles_affected: parseInt(formState.vehicles_affected) || 0,
        // C
        resources_deployed: {
          trucks: {
            bfp: parseInt(formState.resources_bfp_trucks) || 0,
            lgu: parseInt(formState.resources_lgu_trucks) || 0,
            non_bfp: parseInt(formState.resources_non_bfp_trucks) || 0,
          },
          medical: {
            bfp: parseInt(formState.resources_bfp_ambulance) || 0,
            non_bfp: parseInt(formState.resources_non_bfp_ambulance) || 0,
          },
          special_assets: {
            rescue_bfp: parseInt(formState.resources_bfp_rescue) || 0,
            rescue_non_bfp: parseInt(formState.resources_non_bfp_rescue) || 0,
            others: formState.resources_others || 'N/A',
          },
          tools: {
            scba: parseInt(formState.tools_scba) || 0,
            rope: formState.tools_rope || 'N/A',
            ladder: parseInt(formState.tools_ladder) || 0,
            hoseline: formState.tools_hoseline || 'N/A',
            hydraulic: parseInt(formState.tools_hydraulic) || 0,
            others: formState.tools_others || 'N/A',
          },
          hydrant_distance: formState.hydrant_location_distance || 'N/A',
        },
        // D
        alarm_timeline: {
          alarm_foua: alarmEntry('alarm_foua'),
          alarm_1st: alarmEntry('alarm_1st'),
          alarm_2nd: alarmEntry('alarm_2nd'),
          alarm_3rd: alarmEntry('alarm_3rd'),
          alarm_4th: alarmEntry('alarm_4th'),
          alarm_5th: alarmEntry('alarm_5th'),
          alarm_tf_alpha: alarmEntry('alarm_tf_alpha'),
          alarm_tf_bravo: alarmEntry('alarm_tf_bravo'),
          alarm_tf_charlie: alarmEntry('alarm_tf_charlie'),
          alarm_tf_delta: alarmEntry('alarm_tf_delta'),
          alarm_general: alarmEntry('alarm_general'),
          alarm_fuc: alarmEntry('alarm_fuc'),
          alarm_fo: alarmEntry('alarm_fo'),
          _engines: formState.engines.filter((e) => e.name.trim()),
          _response: {
            engine_dispatched: formState.engines[0]?.name || formState.engine_dispatched || '',
            time_engine_dispatched: formState.engines[0]?.time_dispatched || formState.time_engine_dispatched || '',
            time_arrived_at_scene: formState.engines[0]?.time_arrived || formState.time_arrived_at_scene || '',
            time_returned_to_base: formState.time_returned_to_base || '',
            general_description_of_involved: formState.general_description_of_involved || '',
          },
        },
        problems_encountered: [
          ...(formState.problems_encountered || []),
          ...String(formState.problems_others || '').split(',').map((s) => s.trim()).filter(Boolean),
        ],
        recommendations: formState.recommendations || 'N/A',
        other_personnel: otherPersonnel.filter((p) => p.name.trim()),
      },
      incident_sensitive_details: {
        street_address: formState.incident_address,
        landmark: formState.nearest_landmark,
        caller_name: formState.caller_name,
        caller_number: formState.caller_number,
        receiver_name: formState.receiver_name,
        owner_name: formState.owner_name || 'N/A',
        establishment_name: formState.owner_name || 'N/A',
        icp_location: formState.icp_location || 'N/A',
        is_icp_present: formState.icp_present === 'with',
        personnel_on_duty: {
          engine_commander: formState.pod_engine_commander || 'N/A',
          shift_in_charge: formState.pod_shift_in_charge || 'N/A',
          nozzleman: formState.pod_nozzleman || 'N/A',
          lineman: formState.pod_lineman || 'N/A',
          engine_crew: formState.pod_engine_crew || 'N/A',
          driver: formState.pod_driver || 'N/A',
          safety_officer: {
            name: formState.pod_safety_officer || 'N/A',
            contact: formState.pod_safety_officer_contact || 'N/A',
          },
          fire_arson_investigator: {
            name: formState.pod_inv_name || 'N/A',
            contact: formState.pod_inv_contact || 'N/A',
          },
        },
        casualty_details: {
          injured: {
            civilian: { m: parseInt(formState.injured_civilian_m) || 0, f: parseInt(formState.injured_civilian_f) || 0 },
            firefighter: { m: parseInt(formState.injured_firefighter_m) || 0, f: parseInt(formState.injured_firefighter_f) || 0 },
            auxiliary: { m: parseInt(formState.injured_auxiliary_m) || 0, f: parseInt(formState.injured_auxiliary_f) || 0 },
          },
          fatalities: {
            civilian: { m: parseInt(formState.fatal_civilian_m) || 0, f: parseInt(formState.fatal_civilian_f) || 0 },
            firefighter: { m: parseInt(formState.fatal_firefighter_m) || 0, f: parseInt(formState.fatal_firefighter_f) || 0 },
            auxiliary: { m: parseInt(formState.fatal_auxiliary_m) || 0, f: parseInt(formState.fatal_auxiliary_f) || 0 },
          },
        },
        narrative_report: formState.narrative_report,
        disposition: formState.disposition || 'N/A',
        prepared_by_officer: formState.disposition_prepared_by,
        noted_by_officer: formState.disposition_noted_by,
      },
    } as unknown as Incident;

    if (existingIncidentId) {
      // ── Edit mode: flat PUT payload ──────────────────────────────────────
      const updatePayload: Record<string, unknown> = {
        notification_dt: incident.incident_nonsensitive_details.notification_dt,
        alarm_level: incident.incident_nonsensitive_details.alarm_level,
        general_category: incident.incident_nonsensitive_details.general_category,
        sub_category: (incident.incident_nonsensitive_details as Record<string, unknown>).sub_category ?? incident.incident_nonsensitive_details.incident_type,
        responder_type: incident.incident_nonsensitive_details.responder_type,
        fire_station_name: incident.incident_nonsensitive_details.fire_station_name,
        city_municipality: formState.city_municipality,
        province_district: formState.province_district,
        barangay: formState.barangay || '',
        region_label: formState.region,
        fire_origin: incident.incident_nonsensitive_details.fire_origin,
        extent_of_damage: incident.incident_nonsensitive_details.extent_of_damage,
        extent_description: formState.extent_description || null,
        extent_objects_count: parseInt(formState.extent_objects_count) || null,
        extent_total_floor_area_sqm: parseFloat(formState.extent_total_floor_area_sqm) || 0,
        extent_total_land_area_hectares: parseFloat(formState.extent_total_land_area_hectares) || 0,
        stage_of_fire: incident.incident_nonsensitive_details.stage_of_fire,
        general_description_of_involved: formState.general_description_of_involved || null,
        vehicles_affected: parseInt(formState.vehicles_affected) || 0,
        structures_affected: incident.incident_nonsensitive_details.structures_affected,
        households_affected: incident.incident_nonsensitive_details.households_affected,
        families_affected: incident.incident_nonsensitive_details.families_affected,
        individuals_affected: incident.incident_nonsensitive_details.individuals_affected,
        total_response_time_minutes: incident.incident_nonsensitive_details.total_response_time_minutes,
        distance_from_station_km: incident.incident_nonsensitive_details.distance_to_fire_scene_km,
        recommendations: incident.incident_nonsensitive_details.recommendations,
        alarm_timeline: incident.incident_nonsensitive_details.alarm_timeline,
        resources_deployed: incident.incident_nonsensitive_details.resources_deployed,
        problems_encountered: incident.incident_nonsensitive_details.problems_encountered,
        other_personnel: incident.incident_nonsensitive_details.other_personnel,
        caller_name: incident.incident_sensitive_details.caller_name,
        caller_number: incident.incident_sensitive_details.caller_number,
        receiver_name: incident.incident_sensitive_details.receiver_name,
        narrative_report: incident.incident_sensitive_details.narrative_report,
        owner_name: incident.incident_sensitive_details.owner_name,
        establishment_name: incident.incident_sensitive_details.owner_name,
        street_address: formState.incident_address,
        landmark: formState.nearest_landmark,
        prepared_by_officer: (incident.incident_sensitive_details as Record<string, unknown>).prepared_by_officer as string | undefined,
        noted_by_officer: (incident.incident_sensitive_details as Record<string, unknown>).noted_by_officer as string | undefined,
        personnel_on_duty: incident.incident_sensitive_details.personnel_on_duty,
        casualty_details: incident.incident_sensitive_details.casualty_details,
        disposition: incident.incident_sensitive_details.disposition,
        latitude: latitude ?? undefined,
        longitude: longitude ?? undefined,
        station_code: formState.station_code || 'TBA',
        incident_type_code: incidentTypeCode || undefined,
      };
      try {
        await updateRegionalIncident(existingIncidentId, updatePayload);
        if (submitAfterSaveRef.current) {
          try {
            await submitIncidentForReview(existingIncidentId);
            showToast('Submitted for review!');
            onSaved?.();
          } catch (submitErr) {
            if (submitErr instanceof ApiRequestError && submitErr.status === 409) {
              const d = submitErr.detail as { code?: string; matched_incident_id?: number } | null;
              if (d?.code === 'DUPLICATE_DETECTED' && d.matched_incident_id) {
                // Hard-navigate so the detail page remounts and triggers the duplicate modal
                window.location.href = `/dashboard/regional/incidents/${existingIncidentId}?pending_submit=1`;
                return;
              }
            }
            showToast(`Saved. Submit failed: ${(submitErr as Error).message}`);
            onSaved?.();
          }
        } else {
          showToast('Incident saved successfully.');
          onSaved?.();
        }
      } catch (err: unknown) {
        showToast(`Save failed: ${(err as Error).message}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // ── Create mode ──────────────────────────────────────────────────────────
    const payload = { region_id: effectiveRegionId, incidents: [incident] };

    try {
      if (navigator.onLine) {
        const res = await edgeFunctions.uploadBundle(payload);
        const incidentId = res.incident_ids[0];
        if (!incidentId) throw new Error('Upload succeeded but no incident ID was returned.');
        if (submitAfterSaveRef.current) {
          try {
            await submitIncidentForReview(incidentId);
          } catch (submitErr) {
            if (submitErr instanceof ApiRequestError && submitErr.status === 409) {
              const d = submitErr.detail as { code?: string; matched_incident_id?: number } | null;
              if (d?.code === 'DUPLICATE_DETECTED' && d.matched_incident_id) {
                // Saved as draft; navigate to detail with flag to auto-trigger the
                // full duplicate modal (side-by-side comparison + force/cancel options).
                router.push(`/dashboard/regional/incidents/${incidentId}?pending_submit=1`);
                return;
              }
            }
            // Any other submit failure — go to detail so user can retry
            showToast(`Saved as draft. Submit failed: ${(submitErr as Error).message}`);
            router.push(`/dashboard/regional/incidents/${incidentId}`);
            return;
          }
        }
        router.push(`/dashboard/regional/incidents/${incidentId}`);
      } else {
        await queueIncident(payload);
        await checkPending();
        alert('Offline: Incident queued for sync when connection is restored.');
      }
    } catch (err: unknown) {
      console.error('Submission failed', err);
      const isRegionMismatch =
        (err instanceof ApiRequestError && err.status === 403) ||
        (err instanceof Error && err.message.includes('REGION_MISMATCH'));
      if (isRegionMismatch) {
        setFieldErrors((prev) => new Set([...prev, 'region']));
        const assignedRegionName = PH_REGIONS.find((r) => r.regionId === assignedRegionId)?.regionName ?? `Region ${assignedRegionId ?? ''}`;
        showToast(`Your assigned region '${assignedRegionName}' does not match the incident's assigned region.`);
        setTimeout(() => {
          const regionEl = document.querySelector('[data-field-error="true"]');
          regionEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 100);
      } else {
        showToast(`Submission failed: ${(err as Error).message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  // ── Auto-fill for testing ──────────────────────────────────────────────────

  const handleAutoFill = () => {
    const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
    const ri = (min: number, max: number) => String(Math.floor(Math.random() * (max - min + 1)) + min);
    const rtime = () => `${String(Math.floor(Math.random() * 24)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}`;
    const rdate = () => {
      const d = new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000);
      return d.toISOString().split('T')[0];
    };
    const rdatetime = (baseDate: string) => {
      const t = rtime();
      return `${baseDate}T${t}`;
    };
    const notifDate = rdate();
    const coords = { lat: 14.4 + Math.random() * 0.6, lng: 120.9 + Math.random() * 0.4 };
    setLatitude(coords.lat);
    setLongitude(coords.lng);
    const STATIONS = ['BFP QC District III', 'BFP Makati Central', 'BFP Manila District IV', 'BFP Pasig Station 1', 'BFP Mandaluyong Station'];
    const CMDS = ['FINSP Juan dela Cruz', 'FSUPT Maria Santos', 'FO3 Roberto Reyes', 'FO1 Ana Garcia', 'FSMS Pedro Bautista'];
    const FIRE_ORIGINS = ['Kitchen / Cooking Area', 'Electrical Wiring', 'Bedroom', 'Storage Room', 'Garage', 'Living Room', 'Engine Compartment'];
    const EXTENTS = ['None / Minor Damage', 'Confined to Object/Vehicle', 'Confined to Room', 'Confined to Structure or Property', 'Total Loss', 'Extended Beyond Structure or Property'];
    const STAGES = ['Incipient', 'Free-burning', 'Smoldering', 'Flashover', 'Fully Developed'];
    const NARRATIVES = [
      'On or about (time), a call was received by the duty FCOS from a concerned citizen regarding a fire incident at the indicated address. Units were immediately dispatched. Upon arrival, fire was observed at the second floor of the involved structure. Fire was suppressed using standard hoseline operations. No casualties reported.',
      'Duty personnel received a report of a structural fire via telephone. Engine unit was dispatched immediately. Upon arrival, heavy smoke was visible from the structure. Fire was controlled after 45 minutes of suppression operations. One civilian was treated for minor smoke inhalation.',
    ];
    setFormState((prev) => ({
      ...prev,
      responder_type: pick(['First Responder', 'Augmenting Team']),
      fire_station_name: pick(STATIONS),
      notification_dt_date: notifDate,
      notification_dt_time: rtime(),
      incident_address: pick([
        'Blk 3 Lot 12, Sampaguita St., Brgy. San Isidro, Quezon City',
        '45 Rizal Ave., Brgy. Poblacion, Makati City',
        'Unit 2B, 789 Gen. Luna St., Brgy. Malate, Manila',
        'Purok 3, Brgy. San Jose, Pasig City',
        '67 Mabini St., Brgy. Pinyahan, Quezon City',
      ]),
      nearest_landmark: pick(['Near SM Hypermarket', 'Corner Rizal & Mabini Sts.', 'Beside Barangay Hall', 'Near overpass', 'In front of public school']),
      caller_name: pick(['Juan Dela Cruz', 'Maria Reyes', 'Pedro Santos', 'Ana Gonzales', 'Roberto Lim']),
      caller_number: `09${ri(100000000, 999999999)}`,
      receiver_name: pick(CMDS),
      engine_dispatched: `BFP Engine Unit ${ri(1, 5)}`,
      time_engine_dispatched: rtime(),
      time_arrived_at_scene: rtime(),
      total_response_time_minutes: ri(5, 30),
      distance_to_fire_scene_km: String((Math.random() * 9 + 0.5).toFixed(1)),
      alarm_level: pick(['First Alarm', 'Second Alarm', 'Third Alarm', 'General Alarm']),
      time_returned_to_base: rtime(),
      total_gas_consumed_liters: String((Math.random() * 200 + 50).toFixed(1)),
      classification_of_involved: pick(['STRUCTURAL', 'NON_STRUCTURAL', 'TRANSPORTATION']),
      type_of_involved_general_category: pick(['Single-Family Residential', 'Multi-Storey Residential', 'Commercial Building', 'Warehouse', 'Factory']),
      owner_name: pick(['Juan Dela Cruz', 'Maria Santos', 'ABC Corporation', 'N/A']),
      general_description_of_involved: pick(['Two-storey residential structure made of mixed construction', 'Single-storey commercial building made of concrete', 'Three-storey apartment building']),
      area_of_origin: pick(FIRE_ORIGINS),
      stage_of_fire_upon_arrival: pick(STAGES),
      extent_of_damage: pick(EXTENTS),
      extent_total_floor_area_sqm: ri(20, 500),
      extent_total_land_area_hectares: String((Math.random() * 0.5).toFixed(3)),
      structures_affected: ri(1, 5),
      households_affected: ri(1, 10),
      families_affected: ri(1, 8),
      individuals_affected: ri(1, 30),
      vehicles_affected: ri(0, 3),
      resources_bfp_trucks: ri(1, 4),
      resources_lgu_trucks: ri(0, 2),
      resources_non_bfp_trucks: ri(0, 2),
      resources_bfp_ambulance: ri(0, 1),
      resources_non_bfp_ambulance: ri(0, 1),
      resources_bfp_rescue: ri(0, 1),
      resources_non_bfp_rescue: ri(0, 1),
      tools_scba: ri(2, 8),
      tools_rope: `${ri(1, 4)} sets (50m each)`,
      tools_ladder: ri(1, 3),
      tools_hoseline: `${ri(2, 8)} lengths (15m)`,
      tools_hydraulic: ri(0, 2),
      hydrant_location_distance: pick(['150m from scene, corner Mabini Ave.', '80m from scene, in front of barangay hall', '200m from scene, near public market', '50m from scene, beside park']),
      alarm_foua: rdatetime(notifDate),
      alarm_foua_commander: pick(CMDS),
      alarm_1st: rdatetime(notifDate),
      alarm_1st_commander: pick(CMDS),
      alarm_fuc: rdatetime(notifDate),
      alarm_fuc_commander: pick(CMDS),
      alarm_fo: rdatetime(notifDate),
      alarm_fo_commander: pick(CMDS),
      icp_present: pick(['with', 'without']),
      icp_location: 'In front of affected structure',
      injured_civilian_m: ri(0, 3),
      injured_civilian_f: ri(0, 2),
      injured_firefighter_m: ri(0, 2),
      injured_firefighter_f: '0',
      injured_auxiliary_m: ri(0, 1),
      injured_auxiliary_f: '0',
      fatal_civilian_m: ri(0, 1),
      fatal_civilian_f: ri(0, 1),
      fatal_firefighter_m: '0',
      fatal_firefighter_f: '0',
      fatal_auxiliary_m: '0',
      fatal_auxiliary_f: '0',
      pod_engine_commander: `${pick(['FINSP', 'FSUPT', 'FO3'])} ${pick(CMDS).split(' ').slice(1).join(' ')}`,
      pod_shift_in_charge: `${pick(['FINSP', 'FO2'])} ${pick(CMDS).split(' ').slice(1).join(' ')}`,
      pod_nozzleman: `FO1 ${pick(['Bautista', 'Reyes', 'Flores', 'Mendoza'])}`,
      pod_lineman: `FO1 ${pick(['Garcia', 'Torres', 'Ramirez', 'Ramos'])}`,
      pod_engine_crew: `FO1 ${pick(['Lopez', 'Rivera', 'Morales', 'Cruz'])}`,
      pod_driver: `FO2 ${pick(['Aquino', 'Villanueva', 'Diaz', 'Castro'])}`,
      pod_safety_officer: `${pick(['FINSP', 'FO3'])} ${pick(CMDS).split(' ').slice(1).join(' ')}`,
      pod_safety_officer_contact: `09${ri(100000000, 999999999)}`,
      pod_inv_name: `${pick(['FINSP', 'FSUPT'])} ${pick(CMDS).split(' ').slice(1).join(' ')}`,
      pod_inv_contact: `09${ri(100000000, 999999999)}`,
      narrative_report: pick(NARRATIVES),
      problems_encountered: (() => {
        const shuffled = [...ALL_PROBLEM_OPTIONS].sort(() => Math.random() - 0.5);
        return shuffled.slice(0, 3);
      })(),
      problems_others: pick(['Poor inter-agency communication, Lack of manpower', 'Narrow access road, Uncooperative bystanders', 'Low water pressure from hydrant, Communication breakdown']),
      recommendations: 'Conduct regular fire drills and safety inspection. Install proper fire exits and smoke detectors in all floors.',
      disposition: 'As of this date, no formal complaint has been filed. Fire investigation is ongoing.',
      disposition_prepared_by: pick(CMDS),
      disposition_noted_by: pick(CMDS),
    }));
    setOtherPersonnel([
      { name: `FO2 ${pick(['Santos', 'Reyes', 'Garcia', 'Lopez'])}`, designation: 'BFP Personnel' },
      { name: `FO1 ${pick(['Cruz', 'Bautista', 'Ramos', 'Mendoza'])}`, designation: 'BFP Personnel' },
      { name: pick(['Barangay Captain Juan Dela Cruz', 'Kagawad Pedro Santos', 'Barangay Captain Maria Reyes']), designation: 'Barangay Official' },
      { name: pick(['Dr. Maria Reyes', 'EMT Ana Lopez', 'Nurse Carlo Gomez']), designation: 'DRRMO / Medical Response' },
    ]);
  };

  // ── JSX helpers ────────────────────────────────────────────────────────────

  const inputCls = 'w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm';
  const errCls = (field: string) =>
    `w-full rounded p-2 text-gray-900 font-medium text-sm border ${fieldErrors.has(field) ? 'border-red-500 bg-red-50' : 'border-gray-300'}`;
  const labelCls = 'block text-sm font-bold text-gray-900 mb-1';
  const reqMark = <span className="text-red-600"> *</span>;
  const isEditMode = !!existingIncidentId;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-4xl mx-auto space-y-6">
      {/* Floating toast popup */}
      {toast && (
        <div
          role="alert"
          className="fixed top-5 left-1/2 -translate-x-1/2 z-[200] flex items-start gap-3 bg-red-700 text-white text-sm font-semibold px-5 py-3.5 rounded-xl shadow-2xl max-w-sm w-full"
          style={{ pointerEvents: 'auto' }}
        >
          <span className="flex-1 leading-snug">{toast}</span>
          <button type="button" onClick={() => setToast(null)} className="text-white/70 hover:text-white text-xl leading-none -mt-0.5 shrink-0">×</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-wrap justify-between items-center gap-2 bg-red-800 -m-6 mb-4 p-4 rounded-t-lg text-white">
        <h2 className="text-xl font-bold">{isEditMode ? 'Edit Incident Report' : 'AFOR Report Entry'}</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAutoFill}
            className="inline-flex items-center gap-1.5 text-xs bg-yellow-400 text-red-900 px-3 py-1.5 rounded font-bold hover:bg-yellow-300"
            title="Fill all fields with randomized test data"
          >
            <Shuffle className="w-3.5 h-3.5" />
            Auto-fill (Test)
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => syncPending()}
              className="text-xs bg-white/20 text-white px-2 py-1 rounded font-bold hover:bg-white/30"
            >
              {pendingCount} Pending Sync
            </button>
          )}
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-8 text-gray-900"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
            e.preventDefault();
          }
        }}
      >

        {/* ── A. RESPONSE DETAILS ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">A. Response Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div data-field-error={fieldErrors.has('responder_type') ? 'true' : undefined}>
              <label className={labelCls}>Type of Responder{reqMark}</label>
              <select name="responder_type" className={errCls('responder_type')} value={formState.responder_type} onChange={handleChange}>
                <option value="">Select Responder Type</option>
                <option>First Responder</option>
                <option>Augmenting Team</option>
              </select>
            </div>

            <div data-field-error={fieldErrors.has('fire_station_name') ? 'true' : undefined}>
              <label className={labelCls}>Name of Fire Station / Team{reqMark}</label>
              <input name="fire_station_name" type="text" className={errCls('fire_station_name')} value={formState.fire_station_name} onChange={handleChange} />
            </div>

            <div>
              <label className={labelCls}>Station Code</label>
              <input
                name="station_code"
                type="text"
                className={inputCls}
                placeholder="e.g. QC01 (leave as TBA if unknown)"
                value={formState.station_code}
                onChange={handleChange}
              />
              <p className="text-xs text-gray-500 mt-1">Used in the AFOR Reference Number. Defaults to TBA.</p>
            </div>

            <div data-field-error={fieldErrors.has('notification_dt_date') ? 'true' : undefined}>
              <label className={labelCls}>Date Fire Notification Received{reqMark}</label>
              <input name="notification_dt_date" type="date" className={errCls('notification_dt_date')} value={formState.notification_dt_date} onChange={handleChange} />
            </div>

            <div data-field-error={fieldErrors.has('notification_dt_time') ? 'true' : undefined}>
              <label className={labelCls}>Time Fire Notification Received{reqMark}</label>
              <input name="notification_dt_time" type="time" className={errCls('notification_dt_time')} value={formState.notification_dt_time} onChange={handleChange} />
            </div>

            <div data-field-error={fieldErrors.has('region') ? 'true' : undefined}>
              <label className={labelCls}>Region{reqMark}</label>
              {isEncoder && assignedRegionId ? (
                <>
                  <p className={`${inputCls} text-gray-700 bg-gray-50 cursor-default`}>
                    {PH_REGIONS.find((r) => r.regionId === assignedRegionId)?.regionName ?? formState.region}
                  </p>
                  <p className="mt-1 text-xs text-gray-400">Region is set to your assigned area.</p>
                </>
              ) : (
                <select
                  className={fieldErrors.has('region') ? errCls('region') : inputCls}
                  value={selectedRegionId ?? ''}
                  onChange={(e) => {
                    const rid = Number(e.target.value);
                    setSelectedRegionId(rid || null);
                    const r = PH_REGIONS.find((r) => r.regionId === rid);
                    setFormState((prev) => ({ ...prev, region: r?.regionName ?? '', province_district: '', city_municipality: '' }));
                  }}
                >
                  <option value="">Select Region</option>
                  {PH_REGIONS.map((r) => (
                    <option key={r.regionId} value={r.regionId}>{r.regionName}</option>
                  ))}
                </select>
              )}
            </div>

            <div data-field-error={fieldErrors.has('province_district') ? 'true' : undefined}>
              <label className={labelCls}>Province / District{reqMark}</label>
              {(() => {
                const dropRegionId = getEffectiveRegionId();
                return (
                  <select
                    className={errCls('province_district')}
                    value={formState.province_district}
                    disabled={!dropRegionId}
                    onChange={(e) => {
                      setFormState((prev) => ({ ...prev, province_district: e.target.value, city_municipality: '' }));
                    }}
                  >
                    <option value="">{dropRegionId ? 'Select Province' : 'Select region first'}</option>
                    {getProvincesForRegion(dropRegionId).map((p) => (
                      <option key={p.provinceName} value={p.provinceName}>{p.provinceName}</option>
                    ))}
                  </select>
                );
              })()}
            </div>

            <div data-field-error={fieldErrors.has('city_municipality') ? 'true' : undefined}>
              <label className={labelCls}>City / Municipality{reqMark}</label>
              {(() => {
                const effectiveRegionId = getEffectiveRegionId();
                const cities = getCitiesForProvince(effectiveRegionId, formState.province_district);
                return cities.length > 0 ? (
                  <select
                    className={errCls('city_municipality')}
                    value={formState.city_municipality}
                    onChange={(e) => setFormState((prev) => ({ ...prev, city_municipality: e.target.value }))}
                  >
                    <option value="">Select City / Municipality</option>
                    {cities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className={errCls('city_municipality')}
                    placeholder="Type city or municipality name"
                    value={formState.city_municipality}
                    onChange={(e) => setFormState((prev) => ({ ...prev, city_municipality: e.target.value }))}
                  />
                );
              })()}
            </div>

            <div>
              <label className={labelCls}>Barangay</label>
              <input
                name="barangay"
                type="text"
                className={inputCls}
                placeholder="e.g. Barangay San Jose"
                value={formState.barangay}
                onChange={handleChange}
              />
            </div>

            <div className="md:col-span-2" data-field-error={fieldErrors.has('incident_address') ? 'true' : undefined}>
              <label className={labelCls}>Complete Address of Fire Incident{reqMark}</label>
              <input
                name="incident_address"
                type="text"
                className={errCls('incident_address')}
                placeholder="House/Building No., Street, Barangay, City/Municipality, Province"
                value={formState.incident_address}
                onChange={handleChange}
                onBlur={() => {
                  const addr = formState.incident_address.trim();
                  if (addr && latitude === null && longitude === null) {
                    setMapSearchQuery(`${addr}, Philippines`);
                  }
                }}
              />
            </div>

            {/* ── Map Pin (inline in Response Details) ── */}
            <div className="md:col-span-2 space-y-2" data-field-error={fieldErrors.has('map_location') ? 'true' : undefined}>
              <label className={`${labelCls} flex items-center gap-1`}>
                Fire Scene Location (Map Pin){reqMark}
              </label>
              {fieldErrors.has('map_location') && <p className="text-xs font-semibold text-red-600">Pin the fire location on the map before saving.</p>}
              <p className="text-xs text-gray-500">Click or search the map to pin the fire scene. The map auto-searches when you fill in the complete address above.</p>
              {formState.incident_address && (
                <button
                  type="button"
                  onClick={() => {
                    const addr = formState.incident_address.trim();
                    if (addr) setMapSearchQuery(`${addr}, Philippines`);
                  }}
                  className="text-xs text-blue-700 underline hover:text-blue-900"
                >
                  Re-pin from Address
                </button>
              )}
              <div className={`rounded ${fieldErrors.has('map_location') ? 'border-2 border-red-500' : 'border border-gray-300'}`}>
                <MapPicker
                  searchQuery={mapSearchQuery}
                  center={latitude && longitude ? [latitude, longitude] : [14.5995, 120.9842]}
                  value={latitude && longitude ? { lat: latitude, lng: longitude } : null}
                  onChange={async (lat, lng) => {
                    setLatitude(lat);
                    setLongitude(lng);
                    const geo = await reverseGeocode(lat, lng);
                    if (geo?.barangay) {
                      setFormState((prev) => ({ ...prev, barangay: geo.barangay }));
                    }
                  }}
                />
              </div>
              {latitude !== null && longitude !== null ? (
                <p className="text-xs text-green-700 font-medium">
                  📍 Location pinned: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                  <button type="button" onClick={() => { setLatitude(null); setLongitude(null); }} className="ml-3 text-red-600 hover:underline">Clear</button>
                </p>
              ) : (
                <p className="text-xs text-amber-700 font-medium">No location pinned — click the map to mark the fire scene.</p>
              )}
            </div>

            <div>
              <label className={labelCls}>Nearest Landmark (if applicable)</label>
              <input name="nearest_landmark" type="text" className={inputCls} value={formState.nearest_landmark} onChange={handleChange} />
            </div>

            <div>
              <label className={labelCls}>Name and Contact of Caller/Reporter</label>
              <div className="flex gap-2">
                <input name="caller_name" type="text" placeholder="Name" className={inputCls} value={formState.caller_name} onChange={handleChange} />
                <input name="caller_number" type="tel" placeholder="Number" className={inputCls} value={formState.caller_number} onChange={handleChange} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Personnel Who Received Call/Report</label>
              <input name="receiver_name" type="text" className={inputCls} value={formState.receiver_name} onChange={handleChange} />
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>Engine(s) Dispatched</label>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs border border-gray-300 mt-1">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="border px-2 py-1 text-left w-1/3">Name of Engine</th>
                      <th className="border px-2 py-1 text-left w-1/3">Time Engine Dispatched</th>
                      <th className="border px-2 py-1 text-left w-1/3">Time Arrived at Fire Scene</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formState.engines.map((eng, i) => (
                      <tr key={i}>
                        <td className="border px-1 py-1">
                          <input type="text" placeholder="e.g. BFP Engine Unit 1" className="w-full border-0 bg-transparent text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={eng.name} onChange={(ev) => setFormState((prev) => { const engines = prev.engines.map((e, j) => j === i ? { ...e, name: ev.target.value } : e); return { ...prev, engines }; })} />
                        </td>
                        <td className="border px-1 py-1">
                          <input type="time" className="w-full border-0 bg-transparent text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={eng.time_dispatched} onChange={(ev) => setFormState((prev) => { const engines = prev.engines.map((e, j) => j === i ? { ...e, time_dispatched: ev.target.value } : e); return { ...prev, engines }; })} />
                        </td>
                        <td className="border px-1 py-1">
                          <input type="time" className="w-full border-0 bg-transparent text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={eng.time_arrived} onChange={(ev) => setFormState((prev) => { const engines = prev.engines.map((e, j) => j === i ? { ...e, time_arrived: ev.target.value } : e); return { ...prev, engines }; })} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div>
              <label className={labelCls}>Total Response Time (minutes)</label>
              <input name="total_response_time_minutes" type="number" min="0" className={inputCls} value={formState.total_response_time_minutes} onChange={handleChange} />
            </div>

            <div>
              <label className={labelCls}>Approximate Distance to Fire Scene (km)</label>
              <input name="distance_to_fire_scene_km" type="number" min="0" step="0.1" className={inputCls} value={formState.distance_to_fire_scene_km} onChange={handleChange} />
            </div>

            <div data-field-error={fieldErrors.has('alarm_level') ? 'true' : undefined}>
              <label className={labelCls}>Highest Alarm Level Tapped{reqMark}</label>
              <select name="alarm_level" className={errCls('alarm_level')} value={formState.alarm_level} onChange={handleChange}>
                <option value="">Select Alarm Level</option>
                <option>First Alarm</option>
                <option>Second Alarm</option>
                <option>Third Alarm</option>
                <option>Fourth Alarm</option>
                <option>Fifth Alarm</option>
                <option>Task Force Alpha</option>
                <option>Task Force Bravo</option>
                <option>Task Force Charlie</option>
                <option>Task Force Delta</option>
                <option>General Alarm</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Time Returned to Base</label>
              <input name="time_returned_to_base" type="time" className={inputCls} value={formState.time_returned_to_base} onChange={handleChange} />
            </div>

            <div>
              <label className={labelCls}>Total Gas Consumed (liters)</label>
              <input name="total_gas_consumed_liters" type="number" min="0" step="0.1" className={inputCls} value={formState.total_gas_consumed_liters} onChange={handleChange} />
            </div>

          </div>
        </section>

        {/* ── B. NATURE AND CLASSIFICATION ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">B. Nature and Classification of Involved</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            <div data-field-error={fieldErrors.has('classification_of_involved') ? 'true' : undefined}>
              <label className={labelCls}>Classification of Involved{reqMark}</label>
              <select
                name="classification_of_involved"
                className={errCls('classification_of_involved')}
                value={formState.classification_of_involved}
                onChange={handleClassificationChange}
              >
                <option value="">Select Classification</option>
                <option value="STRUCTURAL">Structural</option>
                <option value="NON_STRUCTURAL">Non-Structural</option>
                <option value="WILDLAND">Wildland</option>
                <option value="TRANSPORTATION">Transportation</option>
              </select>
            </div>

            <div data-field-error={fieldErrors.has('type_of_involved_general_category') ? 'true' : undefined}>
              <label className={labelCls}>Type of Involved{reqMark}</label>
              {formState.classification_of_involved ? (
                <>
                  <select
                    name="type_of_involved_general_category"
                    className={errCls('type_of_involved_general_category')}
                    value={formState.type_of_involved_general_category}
                    onChange={handleChange}
                  >
                    <option value="">Select Type</option>
                    {getTypeOptionsForClassification(formState.classification_of_involved).map((opt) => (
                      <option key={opt.code} value={opt.name}>
                        {opt.name} ({opt.code})
                      </option>
                    ))}
                  </select>
                  {incidentTypeCode && (
                    <p className="text-xs text-gray-500 mt-1">
                      AFOR code: <span className="font-mono font-semibold text-gray-700">{incidentTypeCode}</span>
                    </p>
                  )}
                </>
              ) : (
                <select className={inputCls} disabled>
                  <option>Select a classification first</option>
                </select>
              )}
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>Name of Owner/Establishment</label>
              <input name="owner_name" type="text" className={inputCls} placeholder="e.g. Juan dela Cruz / ABC Corp" value={formState.owner_name} onChange={handleChange} />
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>General Description of Involved</label>
              <textarea name="general_description_of_involved" rows={2} className={inputCls} placeholder="Basic construction type, make, built, brand, model of the involved" value={formState.general_description_of_involved} onChange={handleChange} />
            </div>

            <div>
              <label className={labelCls}>Area of Origin</label>
              <input name="area_of_origin" type="text" className={inputCls} placeholder="e.g. Kitchen / Cooking Area" value={formState.area_of_origin} onChange={handleChange} />
            </div>

            <div>
              <label className={labelCls}>Stage of Fire Upon Arrival</label>
              <select name="stage_of_fire_upon_arrival" className={inputCls} value={formState.stage_of_fire_upon_arrival} onChange={handleChange}>
                <option value="">Select Stage</option>
                {STAGE_OF_FIRE_OPTIONS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            <div className="md:col-span-2 space-y-2" data-field-error={fieldErrors.has('extent_of_damage') ? 'true' : undefined}>
              <label className={labelCls}>Extent of Damage (select one){reqMark}</label>
              {fieldErrors.has('extent_of_damage') && <p className="text-xs font-semibold text-red-600">Please select the extent of damage.</p>}
              <div className={`grid grid-cols-1 md:grid-cols-3 gap-2 text-sm rounded p-2 ${fieldErrors.has('extent_of_damage') ? 'border-2 border-red-500 bg-red-50' : ''}`}>
                {['None / Minor Damage', 'Confined to Object/Vehicle', 'Confined to Room', 'Confined to Structure or Property', 'Total Loss', 'Extended Beyond Structure or Property'].map((opt) => (
                  <label key={opt} className="flex items-center gap-2">
                    <input type="radio" name="extent_of_damage" value={opt} checked={formState.extent_of_damage === opt} onChange={() => handleRadioChange('extent_of_damage', opt)} className="h-4 w-4" />
                    <span className="text-xs">{opt}</span>
                  </label>
                ))}
              </div>
              {(formState.extent_of_damage === 'None / Minor Damage' || formState.extent_of_damage === 'Confined to Object/Vehicle') && (
                <div className="mt-2">
                  <label className="block text-xs font-bold text-gray-700 mb-1">Description of Object / Damage</label>
                  <input name="extent_description" type="text" className={inputCls} placeholder="Short description" value={formState.extent_description} onChange={handleChange} />
                </div>
              )}
              {formState.extent_of_damage === 'Confined to Room' && (
                <div className="mt-2 max-w-xs">
                  <label className="block text-xs font-bold text-gray-700 mb-1">Total Floor Area (sqm)</label>
                  <input name="extent_total_floor_area_sqm" type="number" min="0" step="0.1" className={inputCls} value={formState.extent_total_floor_area_sqm} onChange={handleChange} />
                </div>
              )}
              {(formState.extent_of_damage === 'Confined to Structure or Property' || formState.extent_of_damage === 'Total Loss') && (
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Total Floor Area (sqm)</label>
                    <input name="extent_total_floor_area_sqm" type="number" min="0" step="0.1" className={inputCls} value={formState.extent_total_floor_area_sqm} onChange={handleChange} />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">Total Land Area (hectares)</label>
                    <input name="extent_total_land_area_hectares" type="number" min="0" step="0.001" className={inputCls} value={formState.extent_total_land_area_hectares} onChange={handleChange} />
                  </div>
                </div>
              )}
            </div>

            <div className="md:col-span-2">
              <label className={labelCls}>Number Affected</label>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { key: 'structures_affected', label: 'Structures' },
                  { key: 'households_affected', label: 'Households' },
                  { key: 'families_affected', label: 'Families' },
                  { key: 'individuals_affected', label: 'Individuals' },
                  { key: 'vehicles_affected', label: 'Vehicles' },
                ].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-xs font-bold text-gray-600 mb-1">{label}</label>
                    <input type="number" name={key} min="0" className={inputCls} value={(formState as Record<string, unknown>)[key] as string ?? ''} onChange={handleChange} />
                  </div>
                ))}
              </div>
            </div>

          </div>
        </section>

        {/* ── C. ASSETS AND RESOURCES ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">C. Assets and Resources</h3>

          <div>
            <p className="text-xs font-bold text-gray-600 uppercase mb-2">Response Vehicles</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {VEHICLE_ROWS.map(({ key, label }) => (
                <div key={key}>
                  <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
                  <input type="number" name={key} min="0" className={inputCls} value={(formState as Record<string, unknown>)[key] as string ?? ''} onChange={handleChange} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Others (specify)</label>
                <input type="text" name="resources_others" className={inputCls} placeholder="e.g. Water tanker x1" value={formState.resources_others} onChange={handleChange} />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold text-gray-600 uppercase mb-2 mt-3">Tools and Equipment</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {TOOL_ROWS.map(({ key, label, type }) => (
                <div key={key}>
                  <label className="block text-xs font-bold text-gray-700 mb-1">{label}</label>
                  <input type={type} name={key} min={type === 'number' ? '0' : undefined} className={inputCls} value={(formState as Record<string, unknown>)[key] as string ?? ''} onChange={handleChange} />
                </div>
              ))}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Others (specify)</label>
                <input type="text" name="tools_others" className={inputCls} value={formState.tools_others} onChange={handleChange} />
              </div>
            </div>
          </div>

          <div>
            <label className={labelCls}>Location and Distance of Nearest Serviceable Fire Hydrant</label>
            <input name="hydrant_location_distance" type="text" className={inputCls} placeholder="e.g. 150m from the scene, corner Rizal Ave." value={formState.hydrant_location_distance} onChange={handleChange} />
          </div>
        </section>

        {/* ── D. FIRE ALARM LEVEL ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">D. Fire Alarm Level</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border px-3 py-2 text-left w-40">Alarm Level</th>
                  <th className="border px-3 py-2 text-left">Date &amp; Time</th>
                  <th className="border px-3 py-2 text-left">Incident / Ground Commander</th>
                </tr>
              </thead>
              <tbody>
                {ALARM_ROWS.map(({ key, label }) => (
                  <tr key={key}>
                    <td className="border px-3 py-1 font-semibold text-gray-700">{label}</td>
                    <td className="border px-1 py-1">
                      <input
                        type="datetime-local"
                        name={key}
                        className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded"
                        value={(formState as Record<string, unknown>)[key] as string ?? ''}
                        onChange={handleChange}
                      />
                    </td>
                    <td className="border px-1 py-1">
                      <input
                        type="text"
                        name={`${key}_commander`}
                        placeholder="Name (Ground/Incident Commander)"
                        className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded"
                        value={(formState as Record<string, unknown>)[`${key}_commander`] as string ?? ''}
                        onChange={handleChange}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div>
              <label className={labelCls}>Incident Command Post (ICP)</label>
              <div className="flex gap-4 mt-1">
                {['with', 'without'].map((v) => (
                  <label key={v} className="flex items-center gap-2 text-sm capitalize">
                    <input type="radio" name="icp_present" value={v} checked={formState.icp_present === v} onChange={() => handleRadioChange('icp_present', v)} className="h-4 w-4" />
                    {v}
                  </label>
                ))}
              </div>
            </div>
            {formState.icp_present === 'with' && (
              <div>
                <label className={labelCls}>Specify ICP Location</label>
                <input name="icp_location" type="text" className={inputCls} placeholder="e.g. Corner of Rizal and Mabini Sts." value={formState.icp_location} onChange={handleChange} />
              </div>
            )}
          </div>
        </section>

        {/* ── E. PROFILE OF CASUALTIES ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">E. Profile of Casualties</h3>
          <table className="min-w-full text-xs border border-gray-300">
            <thead className="bg-gray-100">
              <tr>
                <th className="border px-3 py-2 text-left">Category</th>
                <th className="border px-3 py-2 text-center w-24">Male</th>
                <th className="border px-3 py-2 text-center w-24">Female</th>
              </tr>
            </thead>
            <tbody>
              {CASUALTY_ROWS.map(({ key, label }) => (
                <tr key={key}>
                  <td className="border px-3 py-1 font-semibold text-gray-700">{label}</td>
                  <td className="border px-1 py-1">
                    <input type="number" name={`${key}_m`} min="0" className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={(formState as Record<string, unknown>)[`${key}_m`] as string ?? ''} onChange={handleChange} />
                  </td>
                  <td className="border px-1 py-1">
                    <input type="number" name={`${key}_f`} min="0" className="w-full border-0 bg-transparent text-gray-900 text-xs p-1 focus:outline-none focus:ring-1 focus:ring-red-300 rounded" value={(formState as Record<string, unknown>)[`${key}_f`] as string ?? ''} onChange={handleChange} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── F. PERSONNEL ON DUTY ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">F. Personnel On Duty</h3>
          <div className="space-y-3">
            {POD_ROLES.map(({ key, label, contactKey }) => (
              <div key={key} className="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
                <span className="text-sm font-semibold text-gray-700 md:col-span-1">{label}</span>
                <input
                  type="text"
                  name={key}
                  placeholder="Rank / Name"
                  className={`${inputCls} md:col-span-1`}
                  value={(formState as Record<string, unknown>)[key] as string ?? ''}
                  onChange={handleChange}
                />
                {contactKey ? (
                  <input
                    type="tel"
                    name={contactKey}
                    placeholder="Contact number"
                    className={`${inputCls} md:col-span-1`}
                    value={(formState as Record<string, unknown>)[contactKey] as string ?? ''}
                    onChange={handleChange}
                  />
                ) : (
                  <div />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── G. OTHER BFP PERSONNEL ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">G. Other BFP Personnel and Significant Personalities at the Scene</h3>
          <div className="space-y-2">
            {otherPersonnel.map((person, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <input type="text" placeholder="Name" className={inputCls} value={person.name} onChange={(e) => handleOtherPersonnelChange(index, 'name', e.target.value)} />
                <input type="text" placeholder="Designation / Agency" className={inputCls} value={person.designation} onChange={(e) => handleOtherPersonnelChange(index, 'designation', e.target.value)} />
              </div>
            ))}
            <button type="button" onClick={() => setOtherPersonnel([...otherPersonnel, { name: '', designation: '' }])} className="text-xs text-blue-600 hover:underline">
              + Add Row
            </button>
          </div>
        </section>

        {/* ── H. NARRATIVE ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">H. Narrative Content (In Chronological Order)</h3>
          <textarea
            name="narrative_report"
            rows={6}
            className={inputCls}
            placeholder="On or about (time, date) call/report received, (Name of duty Floor watch/FCOS) received a call from (name of caller) with (telephone/CP number) regarding (description of type of involved) at (address) near (landmark)..."
            value={formState.narrative_report}
            onChange={handleChange}
          />
        </section>

        {/* ── I. PROBLEMS ENCOUNTERED ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">I. Problems Encountered</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {ALL_PROBLEM_OPTIONS.map((prob, idx) => {
              // Normalize the label to ensure consistent comparison
              const normalizedProb = normalizeProblemLabel(prob);
              const isChecked = (formState.problems_encountered || []).some((p) => normalizeProblemLabel(p) === normalizedProb);
              const checkboxId = `problem-checkbox-${idx}`;
              const isOthers = normalizedProb === normalizeProblemLabel('Others');

              return (
                <label key={`${idx}-${prob}`} htmlFor={checkboxId} className="flex items-start gap-2 cursor-pointer">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 flex-shrink-0 cursor-pointer"
                    checked={isChecked}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setFormState((prev) => {
                        const current = prev.problems_encountered || [];
                        let updated: string[];

                        if (checked) {
                          // Add the canonical form if not already present
                          if (!current.some((p) => normalizeProblemLabel(p) === normalizedProb)) {
                            updated = [...current, prob];
                          } else {
                            updated = current;
                          }
                        } else {
                          // Remove all variants that normalize to this problem
                          updated = current.filter((p) => normalizeProblemLabel(p) !== normalizedProb);
                        }

                        // M4 Bug 8-D: unchecking Others also clears the free-text input
                        if (!checked && isOthers) {
                          return { ...prev, problems_encountered: updated, problems_others: '' };
                        }
                        return { ...prev, problems_encountered: updated };
                      });
                    }}
                  />
                  <span className="select-none">{prob}</span>
                </label>
              );
            })}
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-900 mb-1">Others (specify, separate by comma)</label>
            <input
              type="text"
              name="problems_others"
              className={inputCls}
              placeholder="e.g. Flooding in access road, Low visibility due to fog"
              value={formState.problems_others || ''}
              onChange={handleChange}
              disabled={(formState.problems_encountered || []).every((p) => normalizeProblemLabel(p) !== 'Others')}
            />
          </div>
        </section>

        {/* ── J. RECOMMENDATIONS ── */}
        <section className="space-y-4 border-b pb-6">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">J. Recommendations</h3>
          <textarea name="recommendations" rows={4} className={inputCls} placeholder="Provide clear and actionable recommendations..." value={formState.recommendations} onChange={handleChange} />
        </section>

        {/* ── K. DISPOSITION ── */}
        <section className="space-y-4">
          <h3 className="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">K. Disposition</h3>
          <textarea name="disposition" rows={4} className={inputCls} placeholder="As of this date, no complaint has been filed..." value={formState.disposition} onChange={handleChange} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div data-field-error={fieldErrors.has('disposition_prepared_by') ? 'true' : undefined}>
              <label className={labelCls}>Prepared by (Shift-in-Charge){reqMark}</label>
              <input type="text" name="disposition_prepared_by" className={errCls('disposition_prepared_by')} value={formState.disposition_prepared_by} onChange={handleChange} />
            </div>
            <div data-field-error={fieldErrors.has('disposition_noted_by') ? 'true' : undefined}>
              <label className={labelCls}>Noted by (Engine Company Commander){reqMark}</label>
              <input type="text" name="disposition_noted_by" className={errCls('disposition_noted_by')} value={formState.disposition_noted_by} onChange={handleChange} />
            </div>
          </div>
        </section>

        {referenceNumberPreview && (
          <div className="border border-gray-200 rounded-lg bg-gray-50 px-4 py-3">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Reference Number Preview</p>
            <span className="font-mono text-sm text-gray-800 tracking-wide">{referenceNumberPreview}</span>
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-3">
          <button type="submit" disabled={loading} className="flex-1 bg-gray-700 text-white py-3 rounded font-bold hover:bg-gray-600 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg">
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Save className="w-5 h-5" />}
            {loading ? (isEditMode ? 'Saving Changes…' : 'Saving Draft…') : (isEditMode ? 'Save Changes' : 'Save as Draft')}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={(e) => void handleSubmitForReview(e)}
            className="flex-1 bg-red-800 text-white py-3 rounded font-bold hover:bg-red-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg"
          >
            {loading ? <Loader2 className="animate-spin w-5 h-5" /> : <Send className="w-5 h-5" />}
            {loading ? 'Submitting…' : 'Submit for Review'}
          </button>
        </div>

      </form>

      {/* ── Duplicate Incident Modal ── */}
      {duplicateModalData && (
        <DuplicateIncidentModal
          duplicates={duplicateModalData.duplicates}
          currentForm={{
            region: formState.region || (PH_REGIONS.find((r) => r.regionId === selectedRegionId)?.regionName ?? ''),
            classification: formatClassification(formState.classification_of_involved),
            typeOfInvolved: formState.type_of_involved_general_category,
            incidentTypeCode,
            stationCode: formState.station_code || 'TBA',
            stationName: formState.fire_station_name || formState.station_code || 'TBA',
            fireDate: formState.notification_dt_date,
            fireTime: formState.notification_dt_time,
            alarmLevel: formState.alarm_level,
            address: formState.incident_address,
            referencePreview: referenceNumberPreview || '(incomplete — fill region, type, and date)',
          }}
          onKeepBoth={() => {
            void duplicateModalData.proceedCallback();
          }}
          onReplace={(existingId) => {
            const existingStatus = duplicateModalData?.duplicates.find((d) => d.incident_id === existingId)?.verification_status;
            setDuplicateModalData(null);
            const replacePayload: Record<string, unknown> = {
              notification_dt: buildNotificationDateTime(formState.notification_dt_date, formState.notification_dt_time),
              alarm_level: formState.alarm_level,
              general_category: formState.classification_of_involved,
              sub_category: formState.type_of_involved_general_category,
              responder_type: formState.responder_type,
              fire_station_name: formState.fire_station_name,
              station_code: formState.station_code || 'TBA',
              incident_type_code: incidentTypeCode || undefined,
              city_municipality: formState.city_municipality,
              province_district: formState.province_district,
              fire_origin: formState.area_of_origin,
              extent_of_damage: formState.extent_of_damage,
              stage_of_fire: formState.stage_of_fire_upon_arrival,
              structures_affected: parseInt(formState.structures_affected) || 0,
              households_affected: parseInt(formState.households_affected) || 0,
              families_affected: parseInt(formState.families_affected) || 0,
              individuals_affected: parseInt(formState.individuals_affected) || 0,
              recommendations: formState.recommendations || 'N/A',
              street_address: formState.incident_address,
              landmark: formState.nearest_landmark,
              narrative_report: formState.narrative_report,
              caller_name: formState.caller_name,
              caller_number: formState.caller_number,
              receiver_name: formState.receiver_name,
              latitude: latitude ?? undefined,
              longitude: longitude ?? undefined,
            };
            void (async () => {
              setLoading(true);
              try {
                // PENDING incidents use force-replace (bypasses withdraw requirement, audited)
                if (existingStatus === 'PENDING') {
                  await forceReplaceIncident(existingId, replacePayload);
                } else {
                  await updateRegionalIncident(existingId, replacePayload);
                }
                showToast(`Incident #${existingId} updated with your data.`);
                router.push(`/dashboard/regional/incidents/${existingId}`);
              } catch (err: unknown) {
                showToast(`Replace failed: ${(err as Error).message}`);
              } finally {
                setLoading(false);
              }
            })();
          }}
          onRequestUpdate={(existingId) => {
            // Creates a new DRAFT incident with parent_incident_id pointing to the VERIFIED original.
            // The encoder submits it for review from the detail page; the validator will then
            // inherit the original's reference number and archive it on approval.
            setDuplicateModalData(null);
            const effectiveRegionId = resolveRegionId();
            if (!effectiveRegionId) { showToast('Region not set — cannot save.'); return; }
            const updateNote = `[UPDATE REQUEST for incident #${existingId}]\n`;
            const currentNarrative = formState.narrative_report || '';
            const narrativeWithNote = currentNarrative.startsWith('[UPDATE REQUEST')
              ? currentNarrative
              : updateNote + currentNarrative;
            void (async () => {
              setLoading(true);
              try {
                const result = await createRegionalIncident({
                  latitude: latitude ?? 0,
                  longitude: longitude ?? 0,
                  region_id: effectiveRegionId,
                  notification_dt: buildNotificationDateTime(formState.notification_dt_date, formState.notification_dt_time),
                  alarm_level: formState.alarm_level,
                  general_category: formState.classification_of_involved,
                  sub_category: formState.type_of_involved_general_category,
                  incident_type_code: incidentTypeCode || undefined,
                  station_code: formState.station_code || 'TBA',
                  fire_station_name: formState.fire_station_name,
                  responder_type: formState.responder_type,
                  structures_affected: parseInt(formState.structures_affected) || 0,
                  households_affected: parseInt(formState.households_affected) || 0,
                  families_affected: parseInt(formState.families_affected) || 0,
                  individuals_affected: parseInt(formState.individuals_affected) || 0,
                  province_district: formState.province_district,
                  city_municipality: formState.city_municipality,
                  fire_origin: formState.area_of_origin,
                  extent_of_damage: formState.extent_of_damage,
                  stage_of_fire: formState.stage_of_fire_upon_arrival,
                  street_address: formState.incident_address,
                  landmark: formState.nearest_landmark,
                  narrative_report: narrativeWithNote,
                  caller_name: formState.caller_name,
                  caller_number: formState.caller_number,
                  receiver_name: formState.receiver_name,
                  recommendations: formState.recommendations || 'N/A',
                  parent_incident_id: existingId,
                }, { skipAuthRedirect: true });
                // Navigate to detail page — encoder submits for review from there
                showToast(`Update draft #${result.incident_id} saved. Open it to submit for review.`);
                router.push(`/dashboard/regional/incidents/${result.incident_id}`);
              } catch (err: unknown) {
                const msg = (err as Error).message ?? 'Unknown error';
                if (msg.toLowerCase().includes('session') || msg.includes('401')) {
                  showToast('Session expired — please log in again. Your form data is still here.');
                } else {
                  showToast(`Save failed: ${msg}`);
                }
              } finally {
                setLoading(false);
              }
            })();
          }}
          onEditCurrent={() => setDuplicateModalData(null)}
        />
      )}

    </div>
  );
}
