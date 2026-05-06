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

/** Region I (Ilocos Region) — city/municipality options per province */
const REGION_I_CITIES: Record<string, string[]> = {
  'Ilocos Norte': ['Adams', 'Bacarra', 'Badoc', 'Bangui', 'Banna', 'Batac City', 'Burgos', 'Carasi', 'Currimao', 'Dumalneg', 'Dingras', 'Laoag City', 'Marcos', 'Nueva Era', 'Pagudpud', 'Paoay', 'Pasuquin', 'Piddig', 'Pinili', 'San Nicolas', 'Sarrat', 'Solsona', 'Vintar'],
  'Ilocos Sur': ['Alilem', 'Banayoyo', 'Bantay', 'Burgos', 'Cabugao', 'Candon City', 'Caoayan', 'Cervantes', 'Galimuyod', 'Gregorio del Pilar', 'Lidlida', 'Magsingal', 'Nagbukel', 'Narvacan', 'Quirino', 'Salcedo', 'San Emilio', 'San Esteban', 'San Ildefonso', 'San Juan', 'San Vicente', 'Santa', 'Santa Catalina', 'Santa Cruz', 'Santa Lucia', 'Santa Maria', 'Santiago', 'Santo Domingo', 'Sigay', 'Sinait', 'Sugpon', 'Suyo', 'Tagudin', 'Vigan City'],
  'La Union': ['Agoo', 'Aringay', 'Bacnotan', 'Bagulin', 'Balaoan', 'Bangar', 'Bauang', 'Burgos', 'Caba', 'Luna', 'Naguilian', 'Pugo', 'Rosario', 'San Fernando City', 'San Gabriel', 'San Juan', 'Santo Tomas', 'Santol', 'Sudipen', 'Tubao'],
  'Pangasinan': ['Agno', 'Aguilar', 'Alaminos City', 'Alcala', 'Anda', 'Asingan', 'Balungao', 'Bani', 'Basista', 'Bautista', 'Bayambang', 'Binalonan', 'Binmaley', 'Bolinao', 'Bugallon', 'Burgos', 'Calasiao', 'Dagupan City', 'Dasol', 'Infanta', 'Labrador', 'Laoac', 'Lingayen', 'Mabini', 'Malasiqui', 'Manaoag', 'Mangaldan', 'Mangatarem', 'Mapandan', 'Natividad', 'Pozzorubio', 'Rosales', 'San Carlos City', 'San Fabian', 'San Jacinto', 'San Manuel', 'San Nicolas', 'San Quintin', 'Santa Barbarra', 'Santa Maria', 'Santo Tomas', 'Sison', 'Sual', 'Tayug', 'Umingan', 'Urbiztondo', 'Urdaneta City', 'Villasis'],
};

/** Region II (Cagayan Valley) — city/municipality options per province */
const REGION_II_CITIES: Record<string, string[]> = {
  'Batanes': ['Basco', 'Itbayat', 'Ivana', 'Mahatao', 'Sabtang', 'Uyugan'],
  'Cagayan': ['Abulug', 'Alcala', 'Allacapan', 'Amulung', 'Aparri', 'Baggao', 'Ballesteros', 'Buguey', 'Calayan', 'Camalaniugan', 'Claveria', 'Enrile', 'Gattaran', 'Gonzaga', 'Iguig', 'Lal-lo', 'Lasam', 'Pamplona', 'Peñablanca', 'Piat', 'Rizal', 'Sanchez Mira', 'Solana', 'Santa Praxedes', 'Santa Ana', 'Santa Teresita', 'Santo Niño', 'Tuao', 'Tuguegarao'],
  'Isabela': ['Alicia', 'Angadanan', 'Aurora', 'Benito Soliven', 'Divilican', 'Maconacon', 'Palanan', 'Dinapigue', 'Burgos', 'Cabagan', 'Cabatuan', 'Cauayan City', 'Cordon', 'Delfin Albano', 'Echague', 'Gamu', 'Ilagan City', 'Jones', 'Luna', 'Mallig', 'Naguilian', 'Quezon', 'Quirino', 'Ramon', 'Reina Mercedes', 'Roxas', 'San Agustin', 'San Guillermo', 'San Isidro', 'San Manuel', 'San Mariano', 'San Mateo', 'San Pablo', 'Santa Maria', 'Santiago City', 'Santo Tomas', 'Tumauini'],
  'Nueva Vizcaya': ['Alfonso Castañeda', 'Ambaguio', 'Aritao', 'Bagabag', 'Bambang', 'Bayombong', 'Diadi', 'Dupax del Norte', 'Dupax del Sur', 'Kasibu', 'Kayapa', 'Quezon', 'Santa Fe', 'Solano', 'Villaverde'],
  'Quirino': ['Aglipay', 'Cabarroguis', 'Diffun', 'Maddela', 'Nagtipunan', 'Saguday'],
};

/** Region III (Central Luzon) — city/municipality options per province */
const REGION_III_CITIES: Record<string, string[]> = {
  'Aurora': ['Baler', 'Casiguran', 'Dilasag', 'Dinalungan', 'Dingalan', 'Dipaculao', 'Maria Aurora', 'San Luis'],
  'Bataan': ['Abucay', 'Bagac', 'Balanga City', 'Dinalupihan', 'Hermosa', 'Limay', 'Mariveles', 'Morong', 'Orani', 'Orion', 'Pilar', 'Samal'],
  'Bulacan': ['Angat', 'Balagtas', 'Baliuag', 'Bocaue', 'Bulacan', 'Bustos', 'Calumpit', 'Doña Remedios Trinidad', 'Guiguinto', 'Hagonoy', 'Malolos City', 'Marilao', 'Meycauyan', 'Norzagaray', 'Obando', 'Pandi', 'Paombong', 'Plaridel', 'Pulilan', 'San Ildefonso', 'San Jose del Monte City', 'San Miguel', 'San Rafael', 'Santa Maria'],
  'Nueva Ecija': ['Aliaga', 'Bongabon', 'Cabanatuan City', 'Cabiao', 'Carranglan', 'Cuyapo', 'Gabaldon', 'Gapan City', 'General Mamerto Natividad', 'General Tinio', 'Guimba', 'Jaen', 'Laur', 'Licab', 'Llanera', 'Lupao', 'Munoz Science City', 'Nampicuan', 'Palayan City', 'Pantabangan', 'Peñaranda', 'Quezon', 'Rizal', 'San Antonio', 'San Isidro', 'San Jose City', 'San Leonardo', 'Santa Rosa', 'Santo Domingo', 'Talavera', 'Talugtug', 'Zaragoza'],
  'Pampanga': ['Angeles City', 'Apalit', 'Arayat', 'Bacolor', 'Candaba', 'San Fernando City', 'Florida Blanca', 'Guagua', 'Lubao', 'Mabalacat City', 'Macabebe', 'Magalang', 'Masantol', 'Mexico', 'Minalin', 'Porac', 'San Luis', 'San Simon', 'Sasmuan', 'Santa Rita', 'Santa Ana', 'Santo Tomas'],
  'Tarlac': ['Anao', 'Bamban', 'Camiling', 'Capas', 'Concepcion', 'Gerona', 'La Paz', 'Mayantoc', 'Moncada', 'Paniqui', 'Pura', 'Ramos', 'San Clemente', 'San Jose', 'San Manuel', 'Santa Ignacia', 'Tarlac City', 'Victoria'],
  'Zambales': ['Botolan', 'Cabangan', 'Candelaria', 'Castillejos', 'Iba', 'Masinloc', 'Olongapo City', 'Palauig', 'San Antonio', 'San Felipe', 'San Marcelino', 'San Narciso', 'Santa Cruz', 'Subic'],
};

/** Returns city/municipality options for the given region + province.
 *  Supports NCR, Region I, Region II, and Region III with complete city lists.
 *  For other regions, returns an empty array (use free-text input). */
export function getCitiesForProvince(regionId: number, province: string): string[] {
  if (regionId === 1) {
    return NCR_CITIES[province] ?? [];
  }
  if (regionId === 3) {
    return REGION_I_CITIES[province] ?? [];
  }
  if (regionId === 4) {
    return REGION_II_CITIES[province] ?? [];
  }
  if (regionId === 5) {
    return REGION_III_CITIES[province] ?? [];
  }
  return [];
}

/** Returns the region_code string for a given regionId, or '' if not found. */
export function getRegionCode(regionId: number): string {
  return PH_REGIONS.find((r) => r.regionId === regionId)?.regionCode ?? '';
}
