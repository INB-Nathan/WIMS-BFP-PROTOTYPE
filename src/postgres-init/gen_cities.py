"""Generate cities INSERT SQL and append to 03_seed_reference.sql"""
import os

# (region_code, province_name, [city/municipality names])
DATA = [
    ("NCR","Metro Manila",[
        "City of Manila","Quezon City","City of Caloocan","City of Las Pinas",
        "City of Makati","City of Malabon","City of Mandaluyong","City of Marikina",
        "City of Muntinlupa","City of Navotas","City of Paranaque","City of Pasay",
        "City of Pasig","City of San Juan","City of Taguig","City of Valenzuela","Pateros",
    ]),
    ("REGION_I","Ilocos Norte",[
        "Laoag City","Adams","Bacarra","Badoc","Bangui","Banna","Burgos","Carasi",
        "Currimao","Dingras","Dumalneg","Marcos","Nueva Era","Pagudpud","Paoay",
        "Pasuquin","Piddig","Pinili","San Nicolas","Sarrat","Solsona","Vintar",
    ]),
    ("REGION_I","Ilocos Sur",[
        "Vigan City","Alilem","Banayoyo","Bantay","Burgos","Cabugao","Candon City",
        "Caoayan","Cervantes","Galimuyod","Gregorio del Pilar","Lidlidda","Magsingal",
        "Nagbukel","Narvacan","Quirino","Salcedo","San Emilio","San Esteban",
        "San Ildefonso","San Juan","San Vicente","Santa","Santa Catalina","Santa Cruz",
        "Santa Lucia","Santa Maria","Santiago","Santo Domingo","Sigay","Sinait",
        "Sugpon","Suyo","Tagudin",
    ]),
    ("REGION_I","La Union",[
        "San Fernando City","Agoo","Aringay","Bacnotan","Bagulin","Balaoan","Bangar",
        "Bauang","Burgos","Caba","Luna","Naguilian","Pugo","Rosario","San Gabriel",
        "San Juan","Santo Tomas","Santol","Sudipen","Tubao",
    ]),
    ("REGION_I","Pangasinan",[
        "Dagupan City","San Carlos City","Urdaneta City","Alaminos City","Agno","Aguilar",
        "Alcala","Anda","Asingan","Balungao","Bani","Basista","Bautista","Bayambang",
        "Binalonan","Binmaley","Bolinao","Bugallon","Burgos","Calasiao","Dasol",
        "Infanta","Labrador","Laoac","Lingayen","Mabini","Malasiqui","Manaoag",
        "Mangaldan","Mangatarem","Mapandan","Natividad","Pozorrubio","Rosales",
        "San Fabian","San Jacinto","San Manuel","San Nicolas","San Quintin",
        "Santa Barbara","Santa Maria","Santo Tomas","Sison","Sual","Tayug",
        "Umingan","Urbiztondo","Villasis",
    ]),
    ("REGION_II","Batanes",["Basco","Itbayat","Ivana","Mahatao","Sabtang","Uyugan"]),
    ("REGION_II","Cagayan",[
        "Tuguegarao City","Abulug","Alcala","Allacapan","Amulung","Aparri","Baggao",
        "Ballesteros","Buguey","Calayan","Camalaniugan","Claveria","Enrile","Gattaran",
        "Gonzaga","Iguig","Lal-lo","Lasam","Pamplona","Penablanca","Piat","Rizal",
        "Sanchez-Mira","Santa Ana","Santa Praxedes","Santa Teresita","Santo Nino",
        "Solana","Tuao",
    ]),
    ("REGION_II","Isabela",[
        "Ilagan City","Alicia","Angadanan","Aurora","Benito Soliven","Burgos","Cabagan",
        "Cabatuan","Cauayan City","Cordon","Delfin Albano","Dinapigue","Divilacan",
        "Echague","Gamu","Jones","Luna","Maconacon","Mallig","Naguilian","Palanan",
        "Quezon","Quirino","Ramon","Reina Mercedes","Roxas","San Agustin",
        "San Guillermo","San Isidro","San Manuel","San Mariano","San Mateo","San Pablo",
        "Santiago City","Santo Tomas","Tumauini",
    ]),
    ("REGION_II","Nueva Vizcaya",[
        "Bayombong","Alfonso Castaneda","Ambaguio","Aritao","Bagabag","Bambang",
        "Diadi","Dupax del Norte","Dupax del Sur","Kasibu","Kayapa","Quezon",
        "Santa Fe","Solano","Villaverde",
    ]),
    ("REGION_II","Quirino",["Cabarroguis","Aglipay","Diffun","Maddela","Nagtipunan","Saguday"]),
    ("REGION_III","Aurora",[
        "Baler","Casiguran","Dilasag","Dinalungan","Dingalan","Dipaculao",
        "Maria Aurora","San Luis",
    ]),
    ("REGION_III","Bataan",[
        "Balanga City","Abucay","Bagac","Dinalupihan","Hermosa","Limay",
        "Mariveles","Morong","Orani","Orion","Pilar","Samal",
    ]),
    ("REGION_III","Bulacan",[
        "Malolos City","Angat","Balagtas","Baliuag","Bocaue","Bulakan","Bustos",
        "Calumpit","Dona Remedios Trinidad","Guiguinto","Hagonoy","Marilao",
        "Meycauayan City","Norzagaray","Obando","Pandi","Paombong","Plaridel",
        "Pulilan","San Ildefonso","San Jose del Monte City","San Miguel",
        "San Rafael","Santa Maria",
    ]),
    ("REGION_III","Nueva Ecija",[
        "Palayan City","Cabanatuan City","Gapan City","San Jose City","Munoz",
        "Aliaga","Bongabon","Cabiao","Carranglan","Cuyapo","Gabaldon",
        "General Mamerto Natividad","General Tinio","Guimba","Jaen","Laur",
        "Licab","Llanera","Lupao","Nampicuan","Pantabangan","Penaranda",
        "Quezon","Rizal","San Antonio","San Isidro","San Leonardo","Santa Rosa",
        "Santo Domingo","Talavera","Talugtug","Zaragoza",
    ]),
    ("REGION_III","Pampanga",[
        "San Fernando City","Angeles City","Apalit","Arayat","Bacolor","Candaba",
        "Floridablanca","Guagua","Lubao","Mabalacat City","Macabebe","Magalang",
        "Masantol","Mexico","Minalin","Porac","San Luis","San Simon","Santa Ana",
        "Santa Rita","Santo Tomas","Sasmuan",
    ]),
    ("REGION_III","Tarlac",[
        "Tarlac City","Anao","Bamban","Camiling","Capas","Concepcion","Gerona",
        "La Paz","Mayantoc","Moncada","Paniqui","Pura","Ramos","San Clemente",
        "San Jose","San Manuel","Santa Ignacia","Victoria",
    ]),
    ("REGION_III","Zambales",[
        "Iba","Botolan","Cabangan","Candelaria","Castillejos","Masinloc",
        "Olongapo City","Palauig","San Antonio","San Felipe","San Marcelino",
        "San Narciso","Santa Cruz","Subic",
    ]),
    ("REGION_IV_A","Batangas",[
        "Batangas City","Lipa City","Tanauan City","Agoncillo","Alitagtag",
        "Balayan","Balete","Bauan","Calaca","Calatagan","Cuenca","Ibaan",
        "Laurel","Lemery","Lian","Lobo","Mabini","Malvar","Mataas na Kahoy",
        "Nasugbu","Padre Garcia","Rosario","San Jose","San Juan","San Luis",
        "San Nicolas","San Pascual","Santa Teresita","Santo Tomas","Taal",
        "Talisay","Taysan","Tingloy","Tuy",
    ]),
    ("REGION_IV_A","Cavite",[
        "Trece Martires City","Bacoor City","Cavite City","Dasmarinas City",
        "General Trias City","Imus City","Tagaytay City","Alfonso","Amadeo",
        "Carmona","Indang","Kawit","Magallanes","Maragondon","Mendez","Naic",
        "Noveleta","Rosario","Silang","Tanza","Ternate",
    ]),
    ("REGION_IV_A","Laguna",[
        "Santa Cruz","Calamba City","San Pablo City","Alaminos","Bay",
        "Binan City","Cabuyao City","Calauan","Cavinti","Famy","Kalayaan",
        "Liliw","Los Banos","Luisiana","Lumban","Mabitac","Magdalena",
        "Majayjay","Nagcarlan","Paete","Pagsanjan","Pakil","Pangil","Pila",
        "Rizal","San Pedro City","Santa Maria","Santa Rosa City","Siniloan","Victoria",
    ]),
    ("REGION_IV_A","Quezon",[
        "Lucena City","Tayabas City","Agdangan","Alabat","Atimonan","Buenavista",
        "Burdeos","Calauag","Candelaria","Catanauan","Dolores","General Luna",
        "General Nakar","Guinayangan","Gumaca","Infanta","Jomalig","Lopez",
        "Lucban","Macalelon","Mauban","Mulanay","Padre Burgos","Pagbilao",
        "Panukulan","Patnanungan","Perez","Pitogo","Plaridel","Polillo","Quezon",
        "Real","Sampaloc","San Andres","San Antonio","San Francisco","San Narciso",
        "Sariaya","Tagkawayan","Tiaong","Unisan",
    ]),
    ("REGION_IV_A","Rizal",[
        "Antipolo City","Angono","Baras","Binangonan","Cainta","Cardona",
        "Jala-Jala","Morong","Pililla","Rodriguez","San Mateo","Tanay","Taytay","Teresa",
    ]),
    ("REGION_IV_B","Marinduque",[
        "Boac","Buenavista","Gasan","Mogpog","Santa Cruz","Torrijos",
    ]),
    ("REGION_IV_B","Occidental Mindoro",[
        "Mamburao","Abra de Ilog","Calintaan","Looc","Lubang","Magsaysay",
        "Paluan","Rizal","Sablayan","San Jose","Santa Cruz",
    ]),
    ("REGION_IV_B","Oriental Mindoro",[
        "Calapan City","Baco","Bansud","Bongabong","Bulalacao","Gloria",
        "Mansalay","Naujan","Pinamalayan","Pola","Puerto Galera","Roxas",
        "San Teodoro","Socorro","Victoria",
    ]),
    ("REGION_IV_B","Palawan",[
        "Puerto Princesa City","Aborlan","Agutaya","Araceli","Balabac","Bataraza",
        "Brooke's Point","Busuanga","Cagayancillo","Coron","Culion","Dumaran",
        "El Nido","Kalayaan","Linapacan","Magsaysay","Narra","Quezon","Rizal",
        "Roxas","San Vicente","Sofronio Espanola","Taytay",
    ]),
    ("REGION_IV_B","Romblon",[
        "Romblon","Alcantara","Banton","Cajidiocan","Calatrava","Concepcion",
        "Corcuera","Ferrol","Looc","Magdiwang","Odiongan","San Agustin",
        "San Andres","San Fernando","San Jose","Santa Fe","Santa Maria",
    ]),
    ("REGION_V","Albay",[
        "Legazpi City","Tabaco City","Bacacay","Camalig","Daraga","Guinobatan",
        "Jovellar","Libon","Ligao City","Malilipot","Malinao","Manito","Oas",
        "Pio Duran","Polangui","Rapu-Rapu","Santo Domingo","Tiwi",
    ]),
    ("REGION_V","Camarines Norte",[
        "Daet","Basud","Capalonga","Jose Panganiban","Labo","Mercedes","Paracale",
        "San Lorenzo Ruiz","San Vicente","Santa Elena","Talisay","Vinzons",
    ]),
    ("REGION_V","Camarines Sur",[
        "Pili","Baao","Balatan","Bato","Bombon","Buhi","Bula","Cabusao",
        "Calabanga","Camaligan","Canaman","Caramoan","Del Gallego","Gainza",
        "Garchitorena","Goa","Iriga City","Lagonoy","Libmanan","Lupi","Magarao",
        "Milaor","Minalabac","Nabua","Naga City","Ocampo","Pamplona","Pasacao",
        "Ragay","Sagnay","San Fernando","San Jose","Sipocot","Siruma","Tigaon","Tinambac",
    ]),
    ("REGION_V","Catanduanes",[
        "Virac","Bagamanoc","Baras","Bato","Caramoran","Gigmoto","Pandan",
        "Panganiban","San Andres","San Miguel","Viga",
    ]),
    ("REGION_V","Masbate",[
        "Masbate City","Aroroy","Baleno","Balud","Batuan","Cataingan","Cawayan",
        "Claveria","Dimasalang","Esperanza","Mandaon","Milagros","Mobo","Monreal",
        "Palanas","Pio V. Corpuz","Placer","San Fernando","San Jacinto",
        "San Pascual","Uson",
    ]),
    ("REGION_V","Sorsogon",[
        "Sorsogon City","Barcelona","Bulan","Bulusan","Casiguran","Castilla",
        "Donsol","Gubat","Irosin","Juban","Magallanes","Matnog","Pilar",
        "Prieto Diaz","Santa Magdalena",
    ]),
    ("REGION_VI","Aklan",[
        "Kalibo","Altavas","Balete","Banga","Batan","Buruanga","Ibajay","Lezo",
        "Libacao","Madalag","Makato","Malay","Malinao","Nabas",
        "New Washington","Numancia","Tangalan",
    ]),
    ("REGION_VI","Antique",[
        "San Jose de Buenavista","Anini-y","Barbaza","Belison","Bugasong",
        "Caluya","Culasi","Hamtic","Laua-an","Libertad","Pandan","Patnongon",
        "San Remigio","Sebaste","Sibalom","Tibiao","Tobias Fornier","Valderrama",
    ]),
    ("REGION_VI","Capiz",[
        "Roxas City","Cuartero","Dao","Dumalag","Dumarao","Ivisan","Jamindan",
        "Ma-ayon","Mambusao","Panay","Panitian","Pilar","Pontevedra",
        "President Roxas","Sapi-an","Sigma","Tapaz",
    ]),
    ("REGION_VI","Guimaras",[
        "Jordan","Buenavista","Nueva Valencia","San Lorenzo","Sibunag",
    ]),
    ("REGION_VI","Iloilo",[
        "Iloilo City","Ajuy","Alimodian","Anilao","Badiangan","Balasan","Banate",
        "Barotac Nuevo","Barotac Viejo","Batad","Bingawan","Cabatuan","Calinog",
        "Carles","Concepcion","Dingle","Duenas","Dumangas","Estancia","Guimbal",
        "Igbaras","Janiuay","Lambunao","Leganes","Lemery","Leon","Maasin",
        "Miagao","Mina","New Lucena","Oton","Passi City","Pavia","Pototan",
        "San Dionisio","San Enrique","San Joaquin","San Miguel","San Rafael",
        "Santa Barbara","Sara","Tigbauan","Tubungan","Zarraga",
    ]),
    ("REGION_VI","Negros Occidental",[
        "Bacolod City","Cadiz City","Escalante City","Himamaylan City",
        "Kabankalan City","La Carlota City","Sagay City","San Carlos City",
        "Silay City","Sipalay City","Talisay City","Victorias City","Binalbagan",
        "Calatrava","Candoni","Cauayan","Enrique B. Magalona","Hinigaran",
        "Hinoba-an","Ilog","Isabela","La Castellana","Manapla","Moises Padilla",
        "Murcia","Pontevedra","Pulupandan","San Enrique","Toboso","Valladolid",
    ]),
    ("REGION_VII","Bohol",[
        "Tagbilaran City","Alburquerque","Alicia","Anda","Antequera","Baclayon",
        "Balilihan","Batuan","Bien Unido","Bilar","Buenavista","Calape",
        "Candijay","Carmen","Catigbian","Clarin","Corella","Cortes","Dagohoy",
        "Danao","Dauis","Dimiao","Duero","Garcia Hernandez","Getafe","Guindulman",
        "Inabanga","Jagna","Lila","Loay","Loboc","Loon","Mabini","Maribojoc",
        "Panglao","Pilar","President Carlos P. Garcia","Sagbayan","San Isidro",
        "San Miguel","Sevilla","Sierra Bullones","Sikatuna","Talibon","Trinidad",
        "Tubigon","Ubay","Valencia",
    ]),
    ("REGION_VII","Cebu",[
        "Cebu City","Lapu-Lapu City","Mandaue City","Alcantara","Alcoy","Alegria",
        "Aloguinsan","Argao","Asturias","Badian","Balamban","Bantayan","Barili",
        "Bogo City","Boljoon","Borbon","Carmen","Catmon","Compostela","Consolacion",
        "Cordova","Daanbantayan","Dalaguete","Danao City","Dumanjug","Ginatilan",
        "Liloan","Madridejos","Malabuyoc","Medellin","Minglanilla","Moalboal",
        "Naga City","Oslob","Pilar","Pinamungajan","Poro","Ronda","Samboan",
        "San Fernando","San Francisco","San Remigio","Santa Fe","Santander",
        "Sibonga","Sogod","Tabogon","Tabuelan","Talisay City","Toledo City",
        "Tuburan","Tudela",
    ]),
    ("REGION_VII","Negros Oriental",[
        "Dumaguete City","Amlan","Ayungon","Bacong","Bais City","Basay",
        "Bayawan City","Bindoy","Canlaon City","Dauin","Guihulngan City",
        "Jimalalud","La Libertad","Mabinay","Manjuyod","Pamplona","San Jose",
        "Santa Catalina","Siaton","Sibulan","Tanjay City","Tayasan","Valencia",
        "Vallehermoso","Zamboanguita",
    ]),
    ("REGION_VII","Siquijor",[
        "Siquijor","Enrique Villanueva","Larena","Lazi","Maria","San Juan",
    ]),
    ("REGION_VIII","Biliran",[
        "Naval","Almeria","Biliran","Cabucgayan","Caibiran","Culaba","Kawayan","Maripipi",
    ]),
    ("REGION_VIII","Eastern Samar",[
        "Borongan City","Arteche","Balangiga","Balangkayan","Can-avid","Dolores",
        "General MacArthur","Giporlos","Guiuan","Hernani","Jipapad","Lawaan",
        "Llorente","Maslog","Maydolong","Mercedes","Oras","Quinapondan",
        "Salcedo","San Julian","San Policarpo","Sulat","Taft",
    ]),
    ("REGION_VIII","Leyte",[
        "Tacloban City","Abuyog","Alangalang","Albuera","Babatngon","Barugo",
        "Bato","Baybay City","Burauen","Calubian","Capoocan","Carigara","Dagami",
        "Dulag","Hilongos","Hindang","Inopacan","Isabel","Jaro","Javier","Julita",
        "Kananga","La Paz","Leyte","MacArthur","Mahaplag","Matag-ob","Mayorga",
        "Merida","Ormoc City","Palo","Palompon","Pastrana","San Isidro","San Miguel",
        "Santa Fe","Tabango","Tabontabon","Tanauan","Tolosa","Tunga","Villaba",
    ]),
    ("REGION_VIII","Northern Samar",[
        "Catarman","Allen","Biri","Bobon","Capul","Catubig","Gamay","Laoang",
        "Lapinig","Las Navas","Lavezares","Lope de Vega","Mapanas","Mondragon",
        "Palapag","Pambujan","Rosario","San Antonio","San Isidro","San Jose",
        "San Roque","San Vicente","Silvino Lobos","Victoria",
    ]),
    ("REGION_VIII","Samar",[
        "Catbalogan City","Almagro","Basey","Calbayog City","Calbiga","Daram",
        "Gandara","Hinabangan","Jiabong","Marabut","Matuguinao","Motiong",
        "Pagsanghan","Paranas","Pinabacdao","San Jorge","San Jose de Buan",
        "San Sebastian","Santa Margarita","Santa Rita","Santo Nino",
        "Tagapul-an","Talalora","Tarangnan","Villareal","Zumarraga",
    ]),
    ("REGION_VIII","Southern Leyte",[
        "Maasin City","Anahawan","Bontoc","Hinundayan","Hinunangan","Libagon",
        "Liloan","Limasawa","Macrohon","Malitbog","Padre Burgos","Pintuyan",
        "Saint Bernard","San Francisco","San Juan","San Ricardo","Silago",
        "Sogod","Tomas Oppus",
    ]),
    ("REGION_IX","Zamboanga del Norte",[
        "Dipolog City","Dapitan City","Jose Dalman","Kalawit","Katipunan",
        "La Libertad","Labason","Leon B. Postigo","Liloy","Manukan","Mutia",
        "Pinan","Polanco","President Manuel A. Roxas","Rizal","Salug",
        "San Miguel","Sergio Osmena Sr.","Siayan","Sibuco","Sibutad",
        "Sindangan","Siocon","Sirawai","Tampilisan",
    ]),
    ("REGION_IX","Zamboanga del Sur",[
        "Pagadian City","Aurora","Bayog","Dimataling","Dinas","Dumalinao",
        "Dumingag","Guipos","Josefina","Kumalarang","Labangan","Lapuyan",
        "Mahayag","Margosatubig","Midsalip","Molave","Pitogo","Ramon Magsaysay",
        "San Miguel","San Pablo","Sominot","Tabina","Tambulig","Tigbao",
        "Tukuran","Vincenzo A. Sagun","Zamboanga City",
    ]),
    ("REGION_IX","Zamboanga Sibugay",[
        "Ipil","Alicia","Buug","Diplahan","Imelda","Kabasalan","Mabuhay",
        "Malangas","Naga","Olutanga","Payao","Roseller T. Lim","Siay",
        "Talusan","Titay","Tungawan",
    ]),
    ("REGION_X","Bukidnon",[
        "Malaybalay City","Valencia City","Baungon","Cabanglasan","Damulog",
        "Dangcagan","Don Carlos","Impasugong","Kadingilan","Kalilangan","Kibawe",
        "Kitaotao","Lantapan","Libona","Malitbog","Manolo Fortich","Maramag",
        "Pangantucan","Quezon","San Fernando","Talakag",
    ]),
    ("REGION_X","Camiguin",["Mambajao","Catarman","Guinsiliban","Mahinog","Sagay"]),
    ("REGION_X","Lanao del Norte",[
        "Tubod","Iligan City","Bacolod","Baloi","Baroy","Buntawan","Kapatagan",
        "Kauswagan","Kolambugan","Lala","Linamon","Magsaysay","Maigo","Munai",
        "Nunungan","Pantao Ragat","Pantar","Poona Piagapo","Salvador","Sapad",
        "Sultan Naga Dimaporo","Tagoloan","Tangcal",
    ]),
    ("REGION_X","Misamis Occidental",[
        "Oroquieta City","Ozamis City","Tangub City","Aloran","Baliangao",
        "Bonifacio","Calamba","Clarin","Concepcion","Don Victoriano Chiongbian",
        "Jimenez","Lopez Jaena","Panaon","Plaridel","Sapang Dalaga","Sinacaban","Tudela",
    ]),
    ("REGION_X","Misamis Oriental",[
        "Cagayan de Oro City","Gingoog City","Alubijid","Balingasag","Balingoan",
        "Binuangan","Claveria","El Salvador City","Gitagum","Initao","Jasaan",
        "Kinoguitan","Lagonglong","Laguindingan","Libertad","Lugait","Magsaysay",
        "Manticao","Medina","Naawan","Opol","Salay","Sugbongcogon","Tagoloan",
        "Talisayan","Villanueva",
    ]),
    ("REGION_XI","Davao de Oro",[
        "Nabunturan","Compostela","Laak","Mabini","Maco","Maragusan","Mawab",
        "Monkayo","Montevista","New Bataan","Pantukan",
    ]),
    ("REGION_XI","Davao del Norte",[
        "Tagum City","Island Garden City of Samal","Asuncion","Braulio E. Dujali",
        "Carmen","Kapalong","New Corella","Panabo City","San Isidro",
        "Santo Tomas","Talaingod",
    ]),
    ("REGION_XI","Davao del Sur",[
        "Digos City","Bansalan","Don Marcelino","Hagonoy","Jose Abad Santos",
        "Kiblawan","Magsaysay","Malalag","Matanao","Padada","Santa Cruz","Sulop",
    ]),
    ("REGION_XI","Davao Occidental",[
        "Malita","Don Marcelino","Jose Abad Santos","Santa Maria","Sarangani",
    ]),
    ("REGION_XI","Davao Oriental",[
        "Mati City","Baganga","Banaybanay","Boston","Caraga","Cateel",
        "Governor Generoso","Lupon","Manay","San Isidro","Tarragona",
    ]),
    ("REGION_XII","Cotabato",[
        "Kidapawan City","Alamada","Aleosan","Antipas","Arakan","Banisilan",
        "Carmen","Kabacan","Libungan","M'lang","Magpet","Makilala","Matalam",
        "Midsayap","Pigkawayan","Pikit","President Roxas","Tulunan",
    ]),
    ("REGION_XII","Sarangani",[
        "Alabel","Glan","Kiamba","Maasim","Maitum","Malapatan","Malungon",
    ]),
    ("REGION_XII","South Cotabato",[
        "Koronadal City","Banga","Lake Sebu","Norala","Polomolok","Santo Nino",
        "Surallah","T'boli","Tampakan","Tantangan","Tupi",
    ]),
    ("REGION_XII","Sultan Kudarat",[
        "Isulan","Bagumbayan","Columbio","Esperanza","Kalamansig","Lambayong",
        "Lebak","Lutayan","Palimbang","President Quirino","Sen. Ninoy Aquino",
        "Tacurong City",
    ]),
    ("REGION_XIII","Agusan del Norte",[
        "Butuan City","Cabadbaran City","Buenavista","Carmen","Jabonga",
        "Kitcharao","Las Nieves","Magallanes","Nasipit",
        "Remedios T. Romualdez","Santiago","Tubay",
    ]),
    ("REGION_XIII","Agusan del Sur",[
        "Prosperidad","Bayugan City","Bunawan","Esperanza","La Paz","Loreto",
        "Rosario","San Francisco","San Luis","Santa Josefa","Sibagat",
        "Talacogon","Trento","Veruela",
    ]),
    ("REGION_XIII","Dinagat Islands",[
        "San Jose","Basilisa","Cagdianao","Dinagat","Libjo","Loreto","Tubajon",
    ]),
    ("REGION_XIII","Surigao del Norte",[
        "Surigao City","Alegria","Bacuag","Burgos","Claver","Dapa","Del Carmen",
        "General Luna","Gigaquit","Mainit","Malimono","Pilar","Placer",
        "San Benito","San Francisco","San Isidro","Santa Monica","Sison",
        "Socorro","Tagana-an","Tubod",
    ]),
    ("REGION_XIII","Surigao del Sur",[
        "Tandag City","Barobo","Bayabas","Bislig City","Cagwait","Cantilan",
        "Carmen","Carrascal","Cortes","Hinatuan","Lanuza","Lianga","Lingig",
        "Madrid","Marihatag","San Agustin","San Miguel","Tagbina","Tago",
    ]),
    ("CAR","Abra",[
        "Bangued","Boliney","Bucay","Bucloc","Daguioman","Danglas","Dolores",
        "La Paz","Lacub","Lagangilang","Lagayan","Langiden","Licuan-Baay","Luba",
        "Malibcong","Manabo","Penarrubia","Pidigan","Pilar","Sallapadan",
        "San Isidro","San Juan","San Quintin","Tayum","Tineg","Tubo","Villaviciosa",
    ]),
    ("CAR","Apayao",["Kabugao","Calanasan","Conner","Flora","Luna","Pudtol","Santa Marcela"]),
    ("CAR","Benguet",[
        "La Trinidad","Atok","Baguio City","Bakun","Bokod","Buguias","Itogon",
        "Kabayan","Kapangan","Kibungan","Mankayan","Sablan","Tuba","Tublay",
    ]),
    ("CAR","Ifugao",[
        "Lagawe","Aguinaldo","Alfonso Lista","Asipulo","Banaue","Hingyon",
        "Hungduan","Kiangan","Lamut","Mayoyao","Tinoc",
    ]),
    ("CAR","Kalinga",[
        "Tabuk City","Balbalan","Lubuagan","Pasil","Pinukpuk","Rizal","Tanudan","Tinglayan",
    ]),
    ("CAR","Mountain Province",[
        "Bontoc","Barlig","Bauko","Besao","Natonin","Paracelis","Sabangan",
        "Sadanga","Sagada","Tadian",
    ]),
    ("BARMM","Basilan",[
        "Isabela City","Akbar","Al-Barka","Hadji Mohammad Ajul","Hadji Muhtamad",
        "Lamitan City","Lantawan","Maluso","Sumisip","Tabuan-Lasa","Tipo-Tipo",
        "Tuburan","Ungkaya Pukan",
    ]),
    ("BARMM","Lanao del Sur",[
        "Marawi City","Bacolod-Kalawi","Balabagan","Balindong","Bayang",
        "Binidayan","Bumbaran","Butig","Calanogas","Ditsaan-Ramain","Ganassi",
        "Kapai","Kapatagan","Lumba-Bayabao","Lumbaca-Unayan","Lumbatan",
        "Lumbayanague","Madalum","Madamba","Maguing","Malabang","Marantao",
        "Marogong","Masiu","Mulondo","Pagayawan","Piagapo","Picong",
        "Poona Bayabao","Pualas","Saguiaran","Sultan Dumalondong",
        "Sultan Gumander","Tamparan","Taraka","Tubaran","Tugaya","Wao",
    ]),
    ("BARMM","Maguindanao del Norte",[
        "Datu Odin Sinsuat","Barira","Buldon","Datu Blah T. Sinsuat",
        "Datu Saudi-Ampatuan","Kabuntalan","Matanog","Northern Kabuntalan",
        "Parang","Sultan Mastura","Sultan Sa Barongis","Upi",
    ]),
    ("BARMM","Maguindanao del Sur",[
        "Buluan","Ampatuan","Datu Abdullah Sangki","Datu Anggal Midtimbang",
        "Datu Hoffer Ampatuan","Datu Montawal","Datu Paglas","Datu Piang",
        "Datu Salibo","Datu Unsay","Gen. Sk. Pendatun","Guindulungan",
        "Mamasapano","Mangudadatu","Pagalungan","Paglat","Pandag",
        "Rajah Buayan","Shariff Aguak","Shariff Saydona Mustapha",
        "South Upi","Sultan Kudarat","Talayan","Tumaguinting",
    ]),
    ("BARMM","Sulu",[
        "Jolo","Hadji Panglima Tahil","Indanan","Kalingalan Caluang","Lugus",
        "Luuk","Maimbung","Old Panamao","Omar","Pandami","Panglima Estino",
        "Pangutaran","Parang","Pata","Patikul","Siasi","Talipao","Tapul","Tongkil",
    ]),
    ("BARMM","Tawi-Tawi",[
        "Bongao","Languyan","Mapun","Panglima Sugala","Sapa-Sapa","Sibutu",
        "Simunul","Sitangkai","South Ubian","Tandubas","Turtle Islands",
    ]),
]

rows = []
for rcode, pname, cities in DATA:
    for city in cities:
        escaped_city = city.replace("'", "''")
        escaped_pname = pname.replace("'", "''")
        rows.append(f"  ('{rcode}','{escaped_pname}','{escaped_city}')")

sql = """
-- =========================================================
-- CITIES / MUNICIPALITIES
-- =========================================================
INSERT INTO wims.ref_cities (province_id, city_name)
SELECT p.province_id, v.cname
FROM (VALUES
""" + ",\n".join(rows) + """
) AS v(rcode, pname, cname)
JOIN wims.ref_regions r ON r.region_code = v.rcode
JOIN wims.ref_provinces p ON p.province_name = v.pname AND p.region_id = r.region_id
WHERE NOT EXISTS (
  SELECT 1 FROM wims.ref_cities c
  WHERE c.province_id = p.province_id AND c.city_name = v.cname
);
"""

path = r"c:\proj\WIMS-BFP-PROTOTYPE\src\postgres-init\03_seed_reference.sql"
with open(path, "a", encoding="utf-8") as f:
    f.write(sql)

print(f"Appended {len(rows)} city rows.")
