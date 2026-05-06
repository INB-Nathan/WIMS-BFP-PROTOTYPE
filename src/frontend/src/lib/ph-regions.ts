/** Static Philippine administrative data (18 regions + provinces).
 *  region_id values MUST match wims.ref_regions in the DB (see 21_all_regions.sql). */

export interface PhRegion {
  regionId: number;
  regionName: string;
  regionCode: string;
}

export interface PhProvince {
  regionId: number;
  provinceName: string;
}

export const PH_REGIONS: PhRegion[] = [
  { regionId: 1,  regionName: 'National Capital Region',          regionCode: 'NCR'   },
  { regionId: 2,  regionName: 'Cordillera Administrative Region', regionCode: 'CAR'   },
  { regionId: 3,  regionName: 'Region I - Ilocos Region',        regionCode: 'I'     },
  { regionId: 4,  regionName: 'Region II - Cagayan Valley',       regionCode: 'II'    },
  { regionId: 5,  regionName: 'Region III - Central Luzon',       regionCode: 'III'   },
  { regionId: 6,  regionName: 'Region IV-A - CALABARZON',        regionCode: 'IV-A'  },
  { regionId: 7,  regionName: 'Region IV-B - MIMAROPA',          regionCode: 'IV-B'  },
  { regionId: 8,  regionName: 'Region V - Bicol Region',          regionCode: 'V'     },
  { regionId: 9,  regionName: 'Region VI - Western Visayas',      regionCode: 'VI'    },
  { regionId: 10, regionName: 'Region VII - Central Visayas',     regionCode: 'VII'   },
  { regionId: 11, regionName: 'Region VIII - Eastern Visayas',    regionCode: 'VIII'  },
  { regionId: 12, regionName: 'Region IX - Zamboanga Peninsula',  regionCode: 'IX'    },
  { regionId: 13, regionName: 'Region X - Northern Mindanao',     regionCode: 'X'     },
  { regionId: 14, regionName: 'Region XI - Davao Region',         regionCode: 'XI'    },
  { regionId: 15, regionName: 'Region XII - SOCCSKSARGEN',       regionCode: 'XII'   },
  { regionId: 16, regionName: 'Region XIII - CARAGA',             regionCode: 'XIII'  },
  { regionId: 17, regionName: 'BARMM',                            regionCode: 'BARMM' },
  { regionId: 18, regionName: 'NIR - Negros Island Region',       regionCode: 'NIR'   },
];

export const PH_PROVINCES: PhProvince[] = [
  // NCR — Fire Districts (used as Province / District for BFP)
  { regionId: 1, provinceName: 'Fire District 1' },
  { regionId: 1, provinceName: 'Fire District 2' },
  { regionId: 1, provinceName: 'Fire District 3' },
  { regionId: 1, provinceName: 'Fire District 4' },
  { regionId: 1, provinceName: 'Fire District 5' },

  // CAR
  { regionId: 2,  provinceName: 'Abra' },
  { regionId: 2,  provinceName: 'Apayao' },
  { regionId: 2,  provinceName: 'Benguet' },
  { regionId: 2,  provinceName: 'Ifugao' },
  { regionId: 2,  provinceName: 'Kalinga' },
  { regionId: 2,  provinceName: 'Mountain Province' },
  { regionId: 2,  provinceName: 'Baguio City' },

  // Region I
  { regionId: 3,  provinceName: 'Ilocos Norte' },
  { regionId: 3,  provinceName: 'Ilocos Sur' },
  { regionId: 3,  provinceName: 'La Union' },
  { regionId: 3,  provinceName: 'Pangasinan' },

  // Region II
  { regionId: 4,  provinceName: 'Batanes' },
  { regionId: 4,  provinceName: 'Cagayan' },
  { regionId: 4,  provinceName: 'Isabela' },
  { regionId: 4,  provinceName: 'Nueva Vizcaya' },
  { regionId: 4,  provinceName: 'Quirino' },

  // Region III
  { regionId: 5,  provinceName: 'Aurora' },
  { regionId: 5,  provinceName: 'Bataan' },
  { regionId: 5,  provinceName: 'Bulacan' },
  { regionId: 5,  provinceName: 'Nueva Ecija' },
  { regionId: 5,  provinceName: 'Pampanga' },
  { regionId: 5,  provinceName: 'Tarlac' },
  { regionId: 5,  provinceName: 'Zambales' },

  // Region IV-A
  { regionId: 6,  provinceName: 'Batangas' },
  { regionId: 6,  provinceName: 'Cavite' },
  { regionId: 6,  provinceName: 'Laguna' },
  { regionId: 6,  provinceName: 'Quezon' },
  { regionId: 6,  provinceName: 'Rizal' },

  // Region IV-B
  { regionId: 7,  provinceName: 'Marinduque' },
  { regionId: 7,  provinceName: 'Occidental Mindoro' },
  { regionId: 7,  provinceName: 'Oriental Mindoro' },
  { regionId: 7,  provinceName: 'Palawan' },
  { regionId: 7,  provinceName: 'Romblon' },

  // Region V
  { regionId: 8,  provinceName: 'Albay' },
  { regionId: 8,  provinceName: 'Camarines Norte' },
  { regionId: 8,  provinceName: 'Camarines Sur' },
  { regionId: 8,  provinceName: 'Catanduanes' },
  { regionId: 8,  provinceName: 'Masbate' },
  { regionId: 8,  provinceName: 'Sorsogon' },

  // Region VI
  { regionId: 9,  provinceName: 'Aklan' },
  { regionId: 9,  provinceName: 'Antique' },
  { regionId: 9,  provinceName: 'Capiz' },
  { regionId: 9,  provinceName: 'Guimaras' },
  { regionId: 9,  provinceName: 'Iloilo' },
  { regionId: 9,  provinceName: 'Negros Occidental' },

  // Region VII
  { regionId: 10, provinceName: 'Bohol' },
  { regionId: 10, provinceName: 'Cebu' },
  { regionId: 10, provinceName: 'Negros Oriental' },
  { regionId: 10, provinceName: 'Siquijor' },

  // Region VIII
  { regionId: 11, provinceName: 'Biliran' },
  { regionId: 11, provinceName: 'Eastern Samar' },
  { regionId: 11, provinceName: 'Leyte' },
  { regionId: 11, provinceName: 'Northern Samar' },
  { regionId: 11, provinceName: 'Samar' },
  { regionId: 11, provinceName: 'Southern Leyte' },

  // Region IX
  { regionId: 12, provinceName: 'Zamboanga del Norte' },
  { regionId: 12, provinceName: 'Zamboanga del Sur' },
  { regionId: 12, provinceName: 'Zamboanga Sibugay' },

  // Region X
  { regionId: 13, provinceName: 'Bukidnon' },
  { regionId: 13, provinceName: 'Camiguin' },
  { regionId: 13, provinceName: 'Lanao del Norte' },
  { regionId: 13, provinceName: 'Misamis Occidental' },
  { regionId: 13, provinceName: 'Misamis Oriental' },

  // Region XI
  { regionId: 14, provinceName: 'Davao de Oro' },
  { regionId: 14, provinceName: 'Davao del Norte' },
  { regionId: 14, provinceName: 'Davao del Sur' },
  { regionId: 14, provinceName: 'Davao Occidental' },
  { regionId: 14, provinceName: 'Davao Oriental' },

  // Region XII
  { regionId: 15, provinceName: 'North Cotabato' },
  { regionId: 15, provinceName: 'Sarangani' },
  { regionId: 15, provinceName: 'South Cotabato' },
  { regionId: 15, provinceName: 'Sultan Kudarat' },

  // Region XIII
  { regionId: 16, provinceName: 'Agusan del Norte' },
  { regionId: 16, provinceName: 'Agusan del Sur' },
  { regionId: 16, provinceName: 'Dinagat Islands' },
  { regionId: 16, provinceName: 'Surigao del Norte' },
  { regionId: 16, provinceName: 'Surigao del Sur' },

  // BARMM
  { regionId: 17, provinceName: 'Basilan' },
  { regionId: 17, provinceName: 'Lanao del Sur' },
  { regionId: 17, provinceName: 'Maguindanao del Norte' },
  { regionId: 17, provinceName: 'Maguindanao del Sur' },
  { regionId: 17, provinceName: 'Sulu' },
  { regionId: 17, provinceName: 'Tawi-Tawi' },

  // NIR
  { regionId: 18, provinceName: 'Negros Occidental' },
  { regionId: 18, provinceName: 'Negros Oriental' },
];

/** NCR city/municipality options per Fire District. */
const NCR_CITIES: Record<string, string[]> = {
  'Fire District 1': ['City of Manila'],
  'Fire District 2': ['Caloocan City', 'Malabon City', 'Navotas City', 'Valenzuela City'],
  'Fire District 3': ['Pasay City', 'Makati City', 'Parañaque City', 'Las Piñas City', 'Muntinlupa City'],
  'Fire District 4': ['Marikina City', 'Pasig City', 'Pateros', 'Taguig City', 'Mandaluyong City', 'San Juan City'],
  'Fire District 5': ['Quezon City'],
};

/** Returns provinces for a given regionId. */
export function getProvincesForRegion(regionId: number): PhProvince[] {
  return PH_PROVINCES.filter((p) => p.regionId === regionId);
}

/** Returns city/municipality options for the given region + province.
 *  Returns an empty array for non-NCR regions (use free-text input instead). */
export function getCitiesForProvince(regionId: number, province: string): string[] {
  if (regionId !== 1) return [];
  return NCR_CITIES[province] ?? [];
}

/** Returns the region_code string for a given regionId, or '' if not found. */
export function getRegionCode(regionId: number): string {
  return PH_REGIONS.find((r) => r.regionId === regionId)?.regionCode ?? '';
}
