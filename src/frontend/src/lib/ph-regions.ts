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

const _PLAIN_REGION_CODES = new Set(['NCR', 'CAR', 'BARMM', 'NIR']);

/** Returns a short region label (e.g. "Region I", "NCR") for display—without the descriptive suffix. */
export function getShortRegionName(regionId: number): string {
  const r = PH_REGIONS.find((x) => x.regionId === regionId);
  if (!r) return `Region ${regionId}`;
  return _PLAIN_REGION_CODES.has(r.regionCode) ? r.regionCode : `Region ${r.regionCode}`;
}

/** Maps region_id → AFOR reference-number identifier (Arabic numerals, matches backend _REGION_CODE_TO_AFOR). */
const AFOR_REGION_IDENTIFIERS: Record<number, string> = {
  1:  'NCR',  2:  'CAR',
  3:  '1',    4:  '2',    5:  '3',
  6:  '4A',   7:  '4B',   8:  '5',
  9:  '6',    10: '7',    11: '8',
  12: '9',    13: '10',   14: '11',
  15: '12',   16: '13',
  17: 'BARMM', 18: 'NIR',
};

/**
 * Returns the AFOR-friendly region identifier for use in reference number generation.
 * E.g. regionId 3 (Region I) → "1", regionId 1 (NCR) → "NCR".
 * Use with formatAforRegionCode() to get the full "RGN-1" prefix.
 */
export function getAforRegionIdentifier(regionId: number): string {
  return AFOR_REGION_IDENTIFIERS[regionId] ?? String(regionId);
}

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

  // Region VII
  { regionId: 10, provinceName: 'Bohol' },
  { regionId: 10, provinceName: 'Cebu' },

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
  { regionId: 18, provinceName: 'Siquijor' },
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

/** Region IV-A (CALABARZON) — city/municipality options per province */
const REGION_IVA_CITIES: Record<string, string[]> = {
  'Batangas': [
    'Agoncillo', 'Alitagtag', 'Balayan', 'Balete', 'Batangas City', 'Bauan', 'Calaca', 'Calatagan',
    'Cuenca', 'Ibaan', 'Laurel', 'Lemery', 'Lian', 'Lipa City', 'Lobo', 'Mabini', 'Malvar',
    'Mataasnakahoy', 'Nasugbu', 'Padre Garcia', 'Rosario', 'San Jose', 'San Juan', 'San Luis',
    'San Nicolas', 'San Pascual', 'Santa Teresita', 'Santo Tomas', 'Taal', 'Talisay',
    'Tanauan City', 'Taysan', 'Tingloy', 'Tuy',
  ],
  'Cavite': [
    'Alfonso', 'Amadeo', 'Bacoor City', 'Carmona', 'Cavite City', 'Dasmarinas City',
    'General Emilio Aguinaldo', 'General Mariano Alvarez', 'General Trias City', 'Imus City',
    'Indang', 'Kawit', 'Magallanes', 'Maragondon', 'Mendez', 'Naic', 'Noveleta',
    'Rosario', 'Silang', 'Tagaytay City', 'Tanza', 'Ternate', 'Trece Martires City',
  ],
  'Laguna': [
    'Alaminos', 'Bay', 'Binan City', 'Cabuyao City', 'Calamba City', 'Calauan', 'Cavinti',
    'Famy', 'Kalayaan', 'Liliw', 'Los Banos', 'Luisiana', 'Lumban', 'Mabitac', 'Magdalena',
    'Majayjay', 'Nagcarlan', 'Paete', 'Pagsanjan', 'Pakil', 'Pangil', 'Pila', 'Rizal',
    'San Pablo City', 'San Pedro City', 'Santa Cruz', 'Santa Maria', 'Santa Rosa City',
    'Siniloan', 'Victoria',
  ],
  'Quezon': [
    'Agdangan', 'Alabat', 'Atimonan', 'Buenavista', 'Burdeos', 'Calauag', 'Candelaria',
    'Catanauan', 'Dolores', 'General Luna', 'General Nakar', 'Guinayangan', 'Gumaca',
    'Infanta', 'Jomalig', 'Lopez', 'Lucban', 'Lucena City', 'Macalelon', 'Mauban', 'Mulanay',
    'Padre Burgos', 'Pagbilao', 'Panukulan', 'Patnanungan', 'Perez', 'Pitogo', 'Plaridel',
    'Polillo', 'Quezon', 'Real', 'Sampaloc', 'San Andres', 'San Antonio', 'San Francisco',
    'San Narciso', 'Sariaya', 'Tagkawayan', 'Tayabas City', 'Tiaong', 'Unisan',
  ],
  'Rizal': [
    'Angono', 'Antipolo City', 'Baras', 'Binangonan', 'Cainta', 'Cardona',
    'Jala-Jala', 'Morong', 'Pililla', 'Rodriguez', 'San Mateo', 'Tanay', 'Taytay', 'Teresa',
  ],
};

/** Region IV-B (MIMAROPA) — city/municipality options per province */
const REGION_IVB_CITIES: Record<string, string[]> = {
  'Marinduque': ['Boac', 'Buenavista', 'Gasan', 'Mogpog', 'Santa Cruz', 'Torrijos'],
  'Occidental Mindoro': [
    'Abra de Ilog', 'Calintaan', 'Looc', 'Lubang', 'Magsaysay', 'Mamburao',
    'Paluan', 'Rizal', 'Sablayan', 'San Jose', 'Santa Cruz',
  ],
  'Oriental Mindoro': [
    'Baco', 'Bansud', 'Bongabong', 'Bulalacao', 'Calapan City', 'Gloria',
    'Mansalay', 'Naujan', 'Pinamalayan', 'Pola', 'Puerto Galera', 'Roxas',
    'San Teodoro', 'Socorro', 'Victoria',
  ],
  'Palawan': [
    'Aborlan', 'Agutaya', 'Araceli', 'Balabac', 'Bataraza', "Brooke's Point",
    'Busuanga', 'Cagayancillo', 'Coron', 'Culion', 'Dumaran', 'El Nido', 'Kalayaan',
    'Linapacan', 'Magsaysay', 'Narra', 'Puerto Princesa City', 'Quezon', 'Rizal',
    'Roxas', 'San Vicente', 'Sofronio Espanola', 'Taytay',
  ],
  'Romblon': [
    'Alcantara', 'Banton', 'Cajidiocan', 'Calatrava', 'Concepcion', 'Corcuera',
    'Ferrol', 'Looc', 'Magdiwang', 'Odiongan', 'Romblon', 'San Agustin',
    'San Andres', 'San Fernando', 'San Jose', 'Santa Fe', 'Santa Maria',
  ],
};

/** CAR (Cordillera Administrative Region) — city/municipality options per province */
const REGION_CAR_CITIES: Record<string, string[]> = {
  'Abra': ['Bangued', 'Boliney', 'Bucay', 'Bucloc', 'Daguioman', 'Danglas', 'Dolores', 'La Paz', 'Lacub', 'Lagangilang', 'Lagayan', 'Langiden', 'Licuan Baay', 'Luba', 'Malibcong', 'Manabo', 'Peñarrubia', 'Pidigan', 'Pilar', 'Sallapadan', 'San Isidro', 'San Juan', 'San Quintin', 'Tayum', 'Tineg', 'Tubo', 'Villaviciosa'],
  'Apayao': ['Calanasan', 'Conner', 'Flora', 'Kabugao', 'Luna', 'Pudtol', 'Santa Marcela'],
  'Benguet': ['Atok', 'Baguio City', 'Bakun', 'Bokod', 'Buguias', 'Itogon', 'Kabayan', 'Kapangan', 'Kibungan', 'La Trinidad', 'Mankayan', 'Sablan', 'Tuba', 'Tublay'],
  'Ifugao': ['Aguinaldo', 'Alfonso Lista', 'Asipulo', 'Banaue', 'Hingyon', 'Hungduan', 'Kiangan', 'Lagawe', 'Lamut', 'Mayoyao', 'Tinoc'],
  'Kalinga': ['Balbalan', 'Lubuagan', 'Pasil', 'Pinukpuk', 'Rizal', 'Tanudan', 'Tinglayan', 'Tabuk City'],
  'Mountain Province': ['Barlig', 'Bauko', 'Besao', 'Bontoc', 'Natonin', 'Paracelis', 'Sabangan', 'Sadanga', 'Sagada', 'Tadian'],
};

/** Region V (Bicol Region) — city/municipality options per province */
const REGION_V_CITIES: Record<string, string[]> = {
  'Albay': ['Bacacay', 'Camalig', 'Daraga', 'Guinobatan', 'Jovellar', 'Legazpi City', 'Libon', 'Ligao City', 'Malilipot', 'Malinao', 'Manito', 'Oas', 'Pio Duran', 'Polangui', 'Rapu Rapu', 'Santo Domingo', 'Tabaco City', 'Tiwi'],
  'Camarines Norte': ['Basud', 'Capalonga', 'Daet', 'Jose Panganiban', 'Labo', 'Mercedes', 'Paracale', 'San Lorenzo Ruiz', 'San Vicente', 'Santa Elena', 'Talisay', 'Vinzons'],
  'Camarines Sur': ['Baao', 'Balatan', 'Bato', 'Bombon', 'Buhi', 'Bula', 'Cabusao', 'Calabanga', 'Camaligan', 'Canaman', 'Caramoan', 'Del Gallego', 'Gachitorena', 'Gainza', 'Goa', 'Iriga City', 'Lagonoy', 'Libmanan', 'Lupi', 'Magarao', 'Milaor', 'Minalabac', 'Nabua', 'Naga City', 'Ocampo', 'Pamplona', 'Pasacao', 'Pili', 'Presentacion', 'Ragay', 'Sagnay', 'San Fernando', 'San Jose', 'Sipocot', 'Siruma', 'Tigaon', 'Tinambac'],
  'Catanduanes': ['Bagamanok', 'Baras', 'Bato', 'Caramoran', 'Gigmoto', 'Pandan', 'Panganiban', 'San Andres', 'San Miguel', 'Viga', 'Virac'],
  'Masbate': ['Aroroy', 'Baleno', 'Balud', 'Batuan', 'Cataingan', 'Cawayan', 'Claveria', 'Dimasalang', 'Esperanza', 'Mandaon', 'Masbate City', 'Milagros', 'Mobo', 'Monreal', 'Palanas', 'Pio V Corpuz', 'Placer', 'San Fernando', 'San Jacinto', 'San Pascual', 'Uson'],
  'Sorsogon': ['Barcelona', 'Bulan', 'Bulusan', 'Casiguran', 'Castilla', 'Donsol', 'Gubat', 'Irosin', 'Juban', 'Magallanes', 'Matnog', 'Pilar', 'Prieto Diaz', 'Santa Magdalena', 'Sorsogon City'],
};

/** Region VI (Western Visayas) — city/municipality options per province */
const REGION_VI_CITIES: Record<string, string[]> = {
  'Aklan': ['Altavas', 'Balete', 'Banga', 'Batan', 'Buruanga', 'Ibajay', 'Kalibo', 'Lezo', 'Libacao', 'Madalag', 'Makato', 'Malay', 'Malinao', 'Nabas', 'New Washington', 'Numancia', 'Tangalan'],
  'Antique': ['Anini-y', 'Barbaza', 'Belison', 'Bugasong', 'Caluya', 'Culasi', 'Hamtic', 'Laua-an', 'Libertad', 'Pandan', 'Patnongon', 'San Jose', 'San Remigio', 'Sebaste', 'Sibalom', 'Tibiao', 'Tobias Fornier', 'Valderrama'],
  'Capiz': ['Cuartero', 'Dao', 'Dumalag', 'Dumarao', 'Ivisan', 'Jamindan', 'Maayon', 'Mambusao', 'Panay', 'Panitan', 'Pilar', 'Pontevedra', 'President Roxas', 'Roxas City', 'Sapian', 'Sigma', 'Tapaz'],
  'Guimaras': ['Buenavista', 'Jordan', 'Nueva Valencia', 'San Lorenzo', 'Sibunag'],
  'Iloilo': ['Ajuy', 'Alimodian', 'Anilao', 'Badiangan', 'Balasan', 'Banate', 'Barotac Nuevo', 'Barotac Viejo', 'Batad', 'Bingawan', 'Cabatuan', 'Calinog', 'Carles', 'Concepcion', 'Dingle', 'Dueñas', 'Dumangas', 'Estancia', 'Guimbal', 'Igbaras', 'Iloilo City', 'Janiuay', 'Lambunao', 'Leganes', 'Lemery', 'Leon', 'Maasin', 'Miagao', 'Mina', 'New Lucena', 'Oton', 'Passi City', 'Pavia', 'Pototan', 'San Dionisio', 'San Enrique', 'San Joaquin', 'San Miguel', 'San Rafael', 'Sara', 'Santa Barbara', 'Tigbauan', 'Tubungan', 'Zarraga'],
};

/** Region VII (Central Visayas) — city/municipality options per province */
const REGION_VII_CITIES: Record<string, string[]> = {
  'Bohol': ['Alburquerque', 'Alicia', 'Anda', 'Antequera', 'Baclayon', 'Balilihan', 'Batuan', 'Bien Unido', 'Bilar', 'Buenavista', 'Calape', 'Candijay', 'Pres Carlos P Garcia', 'Carmen', 'Catigbian', 'Clarin', 'Corella', 'Cortes', 'Dagohoy', 'Danao', 'Dauis', 'Dimiao', 'Duero', 'Garcia Hernandez', 'Guindulman', 'Inabanga', 'Jagna', 'Jetafe', 'Lila', 'Loay', 'Loboc', 'Loon', 'Mabini', 'Maribojoc', 'Panglao', 'Pilar', 'Sagbayan', 'San Isidro', 'San Miguel', 'Sevilla', 'Sierra Bullones', 'Sikatuna', 'Tagbilaran City', 'Talibon', 'Trinidad', 'Tubigon', 'Ubay', 'Valencia'],
  'Cebu': ['Alcantara', 'Alcoy', 'Alegria', 'Aloguinsan', 'Argao', 'Asturias', 'Badian', 'Balamban', 'Bantayan', 'Barili', 'Bogo City', 'Boljoon', 'Borbon', 'Carcar City', 'Carmen', 'Catmon', 'Cebu City', 'Compostela', 'Consolacion', 'Cordova', 'Daanbantayan', 'Dalaguete', 'Danao City', 'Dumanjug', 'Ginatilan', 'Lapu-Lapu City', 'Liloan', 'Madredejos', 'Malabuyoc', 'Mandaue City', 'Medellin', 'Minglanilla', 'Moalboal', 'Naga City', 'Oslob', 'Pilar', 'Pinamungajan', 'Poro', 'Ronda', 'Samboan', 'San Fernando', 'San Francisco', 'San Remigio', 'Santander', 'Sibonga', 'Sogod', 'Santa Fe', 'Tabogon', 'Tabuelan', 'Talisay City', 'Toledo City', 'Tuburan', 'Tudela'],
};

/** Region VIII (Eastern Visayas) — city/municipality options per province */
const REGION_VIII_CITIES: Record<string, string[]> = {
  'Biliran': ['Almeria', 'Cabucgayan', 'Caibiran', 'Culaba', 'Kawayan', 'Maripipi', 'Naval'],
  'Eastern Samar': ['Arteche', 'Balangiga', 'Balangkayan', 'Borongan City', 'Can-avid', 'Dolores', 'General MacArthur', 'Giporlos', 'Guiuan', 'Hernani', 'Jipapad', 'Lawaan', 'Llorente', 'Maslog', 'Maydolong', 'Mercedes', 'Oras', 'Quinapondan', 'Salcedo', 'San Julian', 'San Policarpo', 'Sulat', 'Taft'],
  'Leyte': ['Abuyog', 'Alang-alang', 'Albuera', 'Babatngon', 'Barugo', 'Bato', 'Baybay City', 'Burauen', 'Calubian', 'Capoocan', 'Carigara', 'Dagami', 'Dulag', 'Hilongos', 'Hindang', 'Inopacan', 'Isabel', 'Jaro', 'Javier', 'Julita', 'Kananga', 'La Paz', 'Leyte', 'MacArthur', 'Mahaplag', 'Matag-ob', 'Matalom', 'Mayorga', 'Merida', 'Ormoc City', 'Palo', 'Palompon', 'Pastrana', 'San Isidro', 'San Miguel', 'Santa Fe', 'Tabango', 'Tabontabon', 'Tacloban City', 'Tanauan', 'Tolosa', 'Tunga', 'Villaba'],
  'Northern Samar': ['Allen', 'Biri', 'Bobon', 'Capul', 'Catarman', 'Catubig', 'Gamay', 'Laoang', 'Lapinig', 'Las Navas', 'Lavezares', 'Lope de Vega', 'Mapanas', 'Mondragon', 'Palapag', 'Pambujan', 'Rosario', 'San Antonio', 'San Isidro', 'San Jose', 'San Roque', 'San Vicente', 'Silvino Lobos', 'Victoria'],
  'Samar': ['Almagro', 'Basey', 'Calbayog City', 'Calbiga', 'Catbalogan City', 'Daram', 'Gandara', 'Hinabangan', 'Jiabong', 'Marabut', 'Matuguinao', 'Motiong', 'Pagsanghan', 'Paranas', 'Pinabacdao', 'San Jorge', 'San Jose de Buan', 'San Sebastian', 'Santa Margarita', 'Santa Rita', 'Santo Niño', 'Tagapul-an', 'Talalora', 'Tarangnan', 'Villareal', 'Zumarraga'],
  'Southern Leyte': ['Anahawan', 'Bontoc', 'Hinunangan', 'Hinundayan', 'Libagon', 'Liloan', 'Limasawa', 'Maasin City', 'Macrohon', 'Malitbog', 'Padre Burgos', 'Pintuyan', 'Saint Bernard', 'San Francisco', 'San Juan', 'San Ricardo', 'Silago', 'Sogod', 'Tomas Oppus'],
};

/** Region IX (Zamboanga Peninsula) — city/municipality options per province */
const REGION_IX_CITIES: Record<string, string[]> = {
  'Zamboanga del Norte': ['Baliguian', 'La Libertad', 'Mutia', 'Sergio Osmeña Sr', 'Jose Dalman', 'Gutalac', 'Godod', 'Sirawai', 'Tampilisan', 'Bacungan', 'Kalawit', 'Dapitan City', 'Dipolog City', 'Katipunan', 'Labason', 'Liloy', 'Manukan', 'Piñan', 'Polanco', 'Rizal', 'President Manuel A Roxas', 'Siocon', 'Salug', 'Sibuco', 'Sibutad', 'Sindangan', 'Siocon'],
  'Zamboanga del Sur': ['Aurora', 'Bayog', 'Dimataling', 'Dinas', 'Dumalinao', 'Dumingag', 'Guipos', 'Josefina', 'Kumalarang', 'Labangan', 'Lakewood', 'Lapuyan', 'Mahayag', 'Margosatubig', 'Midsalip', 'Molave', 'Pagadian City', 'Pitogo', 'Ramon Magsaysay', 'San Miguel', 'San Pablo', 'Sominot', 'Tabina', 'Tambulig', 'Tigbao', 'Tukuran', 'Vincenzo A Sagun', 'Zamboanga City'],
  'Zamboanga Sibugay': ['Buug', 'Imelda', 'Alicia', 'Payao', 'Talusan', 'Naga', 'Roseller T Lim', 'Diplahan', 'Ipil', 'Isabela City', 'Kabasalan', 'Mabuhay', 'Malangas', 'Olutanga', 'Siay', 'Titay', 'Tungawan'],
};

/** Region X (Northern Mindanao) — city/municipality options per province */
const REGION_X_CITIES: Record<string, string[]> = {
  'Bukidnon': ['Cabanglasan', 'Dangcagan', 'Don Carlos', 'Impasugong', 'Kadingilan', 'Kalilangan', 'Kibawe', 'Lantapan', 'Libona', 'Malaybalay City', 'Malitbog', 'Manolo Fortich', 'Maramag', 'Baungon', 'Damulog', 'Kitaotao', 'Pangantucan', 'Quezon', 'San Fernando', 'Sumilao', 'Talakag', 'Valencia City'],
  'Camiguin': ['Catarman', 'Guinsiliban', 'Mambajao', 'Mahinog', 'Sagay'],
  'Lanao del Norte': ['Bacolod', 'Baloi', 'Matungao', 'Tagoloan', 'Pantar', 'Pantao Ragat', 'Poona Piagapo', 'Baroy', 'Iligan City', 'Kapatagan', 'Kauswagan', 'Kolambogan', 'Lala', 'Linamon', 'Magsaysay', 'Maigo', 'Munai', 'Nunungan', 'Salvador', 'Sapad', 'Sultan Naga Dimaporo', 'Tangkal', 'Tubod'],
  'Misamis Occidental': ['Aloran', 'Baliangao', 'Bonifacio', 'Calamba', 'Clarin', 'Concepcion', 'Don Victoriano Chiongbian', 'Jimenez', 'Lopez Jaena', 'Oroquieta City', 'Ozamiz City', 'Panaon', 'Plaridel', 'Sapang Dalaga', 'Sinacaban', 'Tangub City', 'Tudela'],
  'Misamis Oriental': ['Alubijid', 'Balingasag', 'Balingoan', 'Binuangan', 'Cagayan de Oro City', 'Claveria', 'El Salvador City', 'Gingoog City', 'Gitagum', 'Initao', 'Jasaan', 'Kinoguitan', 'Lagonglong', 'Laguindingan', 'Libertad', 'Lugait', 'Magsaysay', 'Manticao', 'Medina', 'Naawan', 'Opol', 'Salay', 'Sugbongcogon', 'Tagoloan', 'Talisayan', 'Villanueva'],
};

/** Region XI (Davao Region) — city/municipality options per province */
const REGION_XI_CITIES: Record<string, string[]> = {
  'Davao de Oro': ['Compostela', 'Laak', 'Mabini', 'Maco', 'Maragusan', 'Mawab', 'Monkayo', 'Montevista', 'Nabunturan', 'New Bataan', 'Pantukan'],
  'Davao del Norte': ['Asuncion', 'Carmen', 'Braulio E Dujali', 'Kapalong', 'New Corella', 'Panabo City', 'Island Garden City of Samal', 'San Isidro', 'Santo Tomas', 'Tagum City', 'Talaingod'],
  'Davao del Sur': ['Bansalan', 'Davao City', 'Digos City', 'Hagonoy', 'Kiblawan', 'Magsaysay', 'Malalag', 'Matanao', 'Padada', 'Santa Cruz', 'Sulop'],
  'Davao Occidental': ['Don Marcelino', 'Jose Abad Santos', 'Malita', 'Santa Maria', 'Sarangani'],
  'Davao Oriental': ['Baganga', 'Banaybanay', 'Boston', 'Caraga', 'Cateel', 'Governor Generoso', 'Lupon', 'Manay', 'Mati City', 'San Isidro', 'Tarragona'],
};

/** Region XII (SOCCSKSARGEN) — city/municipality options per province */
const REGION_XII_CITIES: Record<string, string[]> = {
  'North Cotabato': ['Alamada', 'Aleosan', 'Antipas', 'Arakan', 'Banisilan', 'Carmen', 'Cotabato City', 'Kabacan', 'Kidapawan City', 'Libungan', 'Magpet', 'Makilala', 'Matalam', 'Midsayap', 'M\'lang', 'Pigcawayan', 'Pikit', 'President Roxas', 'Tulunan'],
  'Sarangani': ['Alabel', 'Glan', 'Kiamba', 'Maasim', 'Maitum', 'Malapatan', 'Malungon'],
  'South Cotabato': ['Banga', 'General Santos City', 'Koronadal City', 'Lake Sebu', 'Norala', 'Polomolok', 'Santo Niño', 'Surallah', 'Tampakan', 'Tantangan', "T'boli", 'Tupi'],
  'Sultan Kudarat': ['Bagumbayan', 'Colombio', 'Esperanza', 'Isulan', 'Kalamansig', 'Lambayong', 'Lebak', 'Lutayan', 'Palimbang', 'President Quirino', 'Senator Ninoy Aquino', 'Tacurong City'],
};

/** Region XIII / CARAGA — city/municipality options per province */
const REGION_XIII_CITIES: Record<string, string[]> = {
  'Agusan del Norte': ['Buenavista', 'Butuan City', 'Cabadbaran City', 'Carmen', 'Jabonga', 'Kitcharao', 'Las Nieves', 'Magallanes', 'Nasipit', 'Remedios T Romualdez', 'Santiago', 'Tubay'],
  'Agusan del Sur': ['Bayugan City', 'Bunawan', 'Esperanza', 'La Paz', 'Loreto', 'Prosperidad', 'Rosario', 'San Francisco', 'San Luis', 'Sibagat', 'Santa Josefa', 'Talacogon', 'Trento', 'Veruela'],
  'Dinagat Islands': ['Basilisa', 'Cagdianao', 'Dinagat', 'Libjo', 'Loreto', 'San Jose', 'Tubajon'],
  'Surigao del Norte': ['Alegria', 'Bacuag', 'Burgos', 'Claver', 'Dapa', 'Del Carmen', 'General Luna', 'Gigaquit', 'Mainit', 'Malimono', 'Pilar', 'Placer', 'San Benito', 'San Francisco', 'San Isidro', 'Sison', 'Socorro', 'Santa Monica', 'Surigao City', 'Tagana-an', 'Tubod'],
  'Surigao del Sur': ['Barobo', 'Bayabas', 'Bislig City', 'Cagwait', 'Cantilan', 'Carrascal', 'Carmen', 'Cortes', 'Hinatuan', 'Lanuza', 'Lianga', 'Lingig', 'Madrid', 'Marihatag', 'San Agustin', 'San Miguel', 'Tagbina', 'Tago', 'Tandag City'],
};

/** BARMM — city/municipality options per province */
const BARMM_CITIES: Record<string, string[]> = {
  'Basilan': ['Akbar', 'Al-Barka', 'Hadji Mohammad Ajul', 'Hadji Muhtamad', 'Lamitan City', 'Lantawan', 'Maluso', 'Sumisip', 'Tabuan-Lasa', 'Tipo-Tipo', 'Tuburan', 'Ungkaya Pukan'],
  'Lanao del Sur': ['Bacolod-Kalawi', 'Balabagan', 'Balindong', 'Bayang', 'Binidayan', 'Buadiposo-Buntong', 'Bubong', 'Bumbaran', 'Butig', 'Calanogas', 'Ditsaan-Ramain', 'Ganassi', 'Kapai', 'Kapatagan', 'Lumba-Bayabao', 'Lumbaca-Unayan', 'Lumbatan', 'Lumbayanague', 'Madalum', 'Madamba', 'Maguing', 'Malabang', 'Marantao', 'Marawi City', 'Marogong', 'Masiu', 'Mulondo', 'Pagayawan', 'Piagapo', 'Picong', 'Poona Bayabao', 'Pualas', 'Saguiaran', 'Sultan Dumalondong', 'Tagoloan II', 'Tamparan', 'Taraka', 'Tubaran', 'Tugaya', 'Wao'],
  'Maguindanao del Norte': ['Ampatuan', 'Barira', 'Buldon', 'Buluan', 'Datu Abdullah Sangki', 'Datu Anggal Midtimbang', 'Datu Blah T Sinsuat', 'Datu Hoffer Ampatuan', 'Datu Montawal', 'Datu Odin Sinsuat', 'Datu Paglas', 'Datu Piang', 'Datu Salibo', 'Datu Saudi Ampatuan', 'Datu Unsay', 'General Salipada K Pendatun', 'Guindulungan', 'Kabuntalan', 'Mamasapano', 'Mangudadatu', 'Matanog', 'Northern Kabuntalan', 'Pagalungan', 'Paglat', 'Pandag', 'Parang', 'Rajah Buayan', 'Shariff Aguak', 'Shariff Saydona Mustapha', 'South Upi', 'Sultan Mastura', 'Sultan sa Barongis', 'Talayan', 'Talitay', 'Upi'],
  'Maguindanao del Sur': ['Ampatuan', 'Barira', 'Buldon', 'Buluan', 'Datu Abdullah Sangki', 'Datu Anggal Midtimbang', 'Datu Blah T Sinsuat', 'Datu Hoffer Ampatuan', 'Datu Montawal', 'Datu Odin Sinsuat', 'Datu Paglas', 'Datu Piang', 'Datu Salibo', 'Datu Saudi Ampatuan', 'Datu Unsay', 'General Salipada K Pendatun', 'Guindulungan', 'Kabuntalan', 'Mamasapano', 'Mangudadatu', 'Matanog', 'Northern Kabuntalan', 'Pagalungan', 'Paglat', 'Pandag', 'Parang', 'Rajah Buayan', 'Shariff Aguak', 'Shariff Saydona Mustapha', 'South Upi', 'Sultan Mastura', 'Sultan sa Barongis', 'Talayan', 'Talitay', 'Upi'],
  'Sulu': ['Banguingui', 'Hadji Panglima Tahil', 'Indanan', 'Jolo', 'Kalingalan Caluang', 'Lugus', 'Luuk', 'Maimbung', 'Old Panamao', 'Omar', 'Pandami', 'Panglima Estino', 'Pangutaran', 'Parang', 'Pata', 'Patikul', 'Siasi', 'Talipao', 'Tapul'],
  'Tawi-Tawi': ['Bongao', 'Languyan', 'Mapun', 'Panglima Sugala', 'Sapa-Sapa', 'Sibutu', 'Simunul', 'Sitangkai', 'South Ubian', 'Tandubas', 'Turtle Islands'],
};

/** NIR (Negros Island Region) — city/municipality options per province */
const NIR_CITIES: Record<string, string[]> = {
  'Negros Occidental': ['Bacolod City', 'Bago City', 'Binalbagan', 'Cadiz City', 'Calatrava', 'Candoni', 'Cauayan', 'Enrique B Magalona', 'Escalante City', 'Himamaylan City', 'Hinigaran', 'Hinoba-an', 'Ilog', 'Kabankalan City', 'La Carlota City', 'La Castellana', 'Manapla', 'Moises Padilla', 'Murcia', 'Pulupandan', 'Pontevedra', 'Salvador Benedicto', 'Sagay City', 'San Carlos City', 'San Enrique', 'Silay City', 'Sipalay City', 'Talisay City', 'Toboso', 'Valladolid', 'Victorias City'],
  'Negros Oriental': ['Amlan', 'Ayungon', 'Bacong', 'Bais City', 'Basay', 'Bayawan City', 'Bindoy', 'Canlaon City', 'Dauin', 'Dumaguete City', 'Guihulngan City', 'Jimalalud', 'La Libertad', 'Mabinay', 'Manjuyod', 'Pamplona', 'San Jose', 'Siaton', 'Sibulan', 'Santa Catalina', 'Tanjay City', 'Tayasan', 'Valencia', 'Vallehermoso', 'Zamboanguita'],
  'Siquijor': ['Enrique Villanueva', 'Larena', 'Lazi', 'Maria', 'San Juan'],
};

/** Returns city/municipality options for the given region + province.
 *  All 18 PH regions are covered with complete city lists from the authoritative
 *  BFP AFOR Excel (Proposed-New-AFOR_Nov-2025). */
export function getCitiesForProvince(regionId: number, province: string): string[] {
  switch (regionId) {
    case 1:  return NCR_CITIES[province] ?? [];
    case 2:  return REGION_CAR_CITIES[province] ?? [];
    case 3:  return REGION_I_CITIES[province] ?? [];
    case 4:  return REGION_II_CITIES[province] ?? [];
    case 5:  return REGION_III_CITIES[province] ?? [];
    case 6:  return REGION_IVA_CITIES[province] ?? [];
    case 7:  return REGION_IVB_CITIES[province] ?? [];
    case 8:  return REGION_V_CITIES[province] ?? [];
    case 9:  return REGION_VI_CITIES[province] ?? [];
    case 10: return REGION_VII_CITIES[province] ?? [];
    case 11: return REGION_VIII_CITIES[province] ?? [];
    case 12: return REGION_IX_CITIES[province] ?? [];
    case 13: return REGION_X_CITIES[province] ?? [];
    case 14: return REGION_XI_CITIES[province] ?? [];
    case 15: return REGION_XII_CITIES[province] ?? [];
    case 16: return REGION_XIII_CITIES[province] ?? [];
    case 17: return BARMM_CITIES[province] ?? [];
    case 18: return NIR_CITIES[province] ?? [];
    default: return [];
  }
}

/** Returns all provinces for a given regionId. */
export function getProvincesForRegion(regionId: number): PhProvince[] {
  return PH_PROVINCES.filter((p) => p.regionId === regionId);
}

/** Returns the region_code string for a given regionId, or '' if not found. */
export function getRegionCode(regionId: number): string {
  return PH_REGIONS.find((r) => r.regionId === regionId)?.regionCode ?? '';
}
