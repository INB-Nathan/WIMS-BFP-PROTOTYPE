import type { AnalystIncidentListParams } from '@/lib/api';

export type TopNDimension = 'region' | 'municipality' | 'fire_station' | 'barangay';

export interface TopNRegionLookup {
  region_id: number;
  region_name: string;
  region_code?: string | null;
}

export function getTopNDimensionLabel(dimension: TopNDimension): string {
  if (dimension === 'fire_station') return 'Fire station';
  if (dimension === 'municipality') return 'Municipality';
  if (dimension === 'barangay') return 'Barangay';
  return 'Region';
}

export function buildTopNDrilldownFilters(
  baseFilters: AnalystIncidentListParams,
  dimension: TopNDimension,
  hotspotName: string,
  regions: TopNRegionLookup[] = [],
): AnalystIncidentListParams | null {
  if (!hotspotName) return null;

  if (dimension === 'region') {
    const matchedRegion = regions.find((region) =>
      region.region_name === hotspotName || region.region_code === hotspotName,
    );
    const fallbackRegionId = /^\d+$/.test(hotspotName) ? Number(hotspotName) : undefined;
    const regionId = matchedRegion?.region_id ?? fallbackRegionId;
    if (regionId == null) return null;
    return {
      ...baseFilters,
      region_id: regionId,
      municipality: undefined,
      fire_station: undefined,
    };
  }

  if (dimension === 'municipality') {
    return {
      ...baseFilters,
      municipality: hotspotName,
      fire_station: undefined,
    };
  }

  if (dimension === 'barangay') {
    return {
      ...baseFilters,
      barangay_name: hotspotName,
      fire_station: undefined,
    };
  }

  return {
    ...baseFilters,
    fire_station: hotspotName,
  };
}
