<div class="space-y-6">
  <!-- Top Bar -->
  <div class="flex items-center gap-4">
    <a class="p-2 hover:bg-gray-100 rounded-full transition-colors" href="/dashboard">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-chevron-left w-6 h-6 text-gray-600" aria-hidden="true">
        <path d="m15 18-6-6 6-6"></path>
      </svg>
    </a>
    <h1 class="text-2xl font-bold text-gray-900">Manual Incident Entry</h1>
  </div>

  <div class="bg-white p-6 rounded-lg shadow-md max-w-4xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-1 text-center text-xs text-gray-700">
      <div class="font-bold uppercase tracking-wide">Republic of the Philippines</div>
      <div>Department of the Interior and Local Government</div>
      <div class="font-semibold">Bureau of Fire Protection</div>
      <div class="text-[11px] italic">INSERT REGION · INSERT ADDRESS · INSERT CONTACT NUMBER · EMAIL ADDRESS</div>
      <div class="mt-2 font-bold text-sm uppercase tracking-wide">After Fire Operations Report (AFOR)</div>
      <p class="mt-1 text-[11px] text-gray-600">
        Please fill out all required fields carefully and double‑check your answers before submitting. If a question does not apply, type "N/A".
      </p>
    </div>

    <!-- AFOR Header Bar -->
    <div class="flex justify-between items-center bg-red-800 -m-6 mb-4 p-4 rounded-t-lg text-white">
      <h2 class="text-xl font-bold">AFOR Report Entry</h2>
      <button class="text-xs bg-yellow-400 text-red-900 px-2 py-1 rounded font-bold hover:bg-yellow-300">
        1 Pending Sync
      </button>
    </div>

    <form class="space-y-8 text-gray-900">
      <!-- A. RESPONSE DETAILS (1–15) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          A. Response Details
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- 1 Type of Responder -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Type of Responder
              <span class="text-red-600">*</span>
            </label>
            <select class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium">
              <option value="">Select Responder Type</option>
              <option>First Responder</option>
              <option>Augmenting Team</option>
            </select>
          </div>

          <!-- Name of Fire Station -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Name of Fire Station / Team
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 2 Date Fire Notification Received -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Date Fire Notification Received (mm-dd-yyyy)
            </label>
            <input type="date" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 3 Time Fire Notification Received -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Time Fire Notification Received (24-hour)
            </label>
            <input type="time" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 4 Region / Province / City / Complete Address -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">Region</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="e.g. Region 3" />
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Province / District
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              City / Municipality
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div class="md:col-span-2">
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Complete Address of Fire Incident
            </label>
            <input
              type="text"
              class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium placeholder-gray-500"
              placeholder="House/Building No., Street Name, Barangay, City/Municipality, Province"
            />
          </div>

          <!-- 5 Nearest Landmark -->
          <div class="md:col-span-2">
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Nearest Landmark (if applicable)
            </label>
            <input
              type="text"
              class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
            />
          </div>

          <!-- 6 Caller -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Name of Caller / Reporter
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Contact Number of Caller / Reporter
            </label>
            <input type="tel" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 7 Personnel Who Received Call -->
          <div class="md:col-span-2">
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Name of Personnel Who Received the Call / Report
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 8 Engine Dispatched -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Name of Engine Dispatched
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 9 Time Engine Dispatched -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Time Engine Dispatched (24-hour)
            </label>
            <input type="time" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 10 Time Arrived at Fire Scene -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Time Arrived at Fire Scene (24-hour)
            </label>
            <input type="time" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 11 Total Response Time -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Total Response Time (minutes)
            </label>
            <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 12 Distance to Fire Scene -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Approximate Distance to Fire Scene (km)
            </label>
            <input type="number" min="0" step="0.01" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 13 Highest Alarm Level -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Highest Alarm Level Tapped
            </label>
            <select class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium">
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

          <!-- 14 Time Returned to Base -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Time Returned to Base (24-hour)
            </label>
            <input type="time" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 15 Total Gas Consumed -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Total Gas Consumed (Liters)
            </label>
            <input type="number" min="0" step="0.01" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
        </div>
      </div>

      <!-- B. NATURE AND CLASSIFICATION OF INVOLVED (16–26) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          B. Nature and Classification of Involved
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- 16 Classification of Involved -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Classification of Involved
            </label>
            <select class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium">
              <option value="">Select Classification</option>
              <option>Structural</option>
              <option>Non-Structural</option>
              <option>Transportation</option>
            </select>
          </div>

          <!-- 16 Type of Involved (general category) -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Type of Involved (General Category)
            </label>
            <input
              type="text"
              class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium placeholder-gray-500"
              placeholder="e.g. Single-family dwelling, Apartment, Vehicle type"
            />
          </div>

          <!-- 17 Name of Owner -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Name of Owner
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 17 Name of Establishment -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Name of Establishment
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <!-- 18 General Description of Involved -->
          <div class="md:col-span-2">
            <label class="block text-sm font-bold text-gray-900 mb-1">
              General Description of Involved
            </label>
            <textarea
              class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium h-20 placeholder-gray-500"
              placeholder="Basic construction type, make, build, brand, model of the involved"
            ></textarea>
          </div>

          <!-- 19 Area of Origin -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Area of Origin
            </label>
            <input
              type="text"
              class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium placeholder-gray-500"
              placeholder="e.g. Living room, kitchen, bedroom, vehicle compartment"
            />
          </div>

          <!-- 20 Stage of Fire Upon Arrival -->
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Stage of Fire Upon Arrival
            </label>
            <select class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium">
              <option value="">Select Stage of Fire</option>
              <option>Incipient</option>
              <option>Growth</option>
              <option>Fully Developed</option>
              <option>Decay</option>
            </select>
          </div>

          <!-- 21 Extent of Damage -->
          <div class="md:col-span-2 space-y-2">
            <label class="block text-sm font-bold text-gray-900">
              Extent of Damage (select only one)
            </label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
              <label class="flex items-center gap-2">
                <input type="radio" name="extentDamage" class="h-4 w-4" />
                <span>None / Minor Damage (describe object or damage)</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="radio" name="extentDamage" class="h-4 w-4" />
                <span>Confined to Object / Vehicle (describe object or damage)</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="radio" name="extentDamage" class="h-4 w-4" />
                <span>Confined to Room (total floor area in sq. m)</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="radio" name="extentDamage" class="h-4 w-4" />
                <span>Confined to Structure / Property (floor area & land area)</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="radio" name="extentDamage" class="h-4 w-4" />
                <span>Total Loss (floor area & land area)</span>
              </label>
              <label class="flex items-center gap-2">
                <input type="radio" name="extentDamage" class="h-4 w-4" />
                <span>Extended Beyond Structure / Property (no. of affected)</span>
              </label>
            </div>

            <!-- Extent details -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2 text-sm">
              <div>
                <label class="block text-xs font-bold text-gray-900 mb-1">
                  Total Floor Area (sq. m)
                </label>
                <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-900 mb-1">
                  Total Land Area (hectares)
                </label>
                <input type="number" min="0" step="0.01" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-900 mb-1">
                  No. of Structures / Objects / Vehicles Affected
                </label>
                <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
              </div>
            </div>
          </div>

          <!-- 22–26 Affected counts -->
          <div class="grid grid-cols-2 md:grid-cols-3 gap-2 md:col-span-2 mt-2">
            <div>
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Number of Structures Affected
              </label>
              <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Number of Households Affected
              </label>
              <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Number of Families Affected
              </label>
              <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Number of Individuals Affected
              </label>
              <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
            <div>
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Number of Vehicles Affected
              </label>
              <input type="number" min="0" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
          </div>
        </div>
      </div>

      <!-- C. ASSETS AND RESOURCES (27–29) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          C. Assets and Resources
        </h3>

        <!-- 27 Response Vehicles -->
        <div class="space-y-2">
          <h4 class="text-sm font-bold text-gray-900">
            27. Response Vehicles (check all applicable)
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>BFP Fire Trucks</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium md:col-span-1" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>BFP Manned Fire Trucks (LGU Owned)</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Non‑BFP Fire Trucks</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>BFP Ambulance</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Non‑BFP Ambulance</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>BFP Rescue Trucks</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Non‑BFP Rescue Trucks</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <div class="md:col-span-2">
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Others (ex. heli‑bucket, fire/rescue boat, mobile kitchen, etc.)
              </label>
              <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
          </div>
        </div>

        <!-- 28 Tools and Equipment -->
        <div class="space-y-2">
          <h4 class="text-sm font-bold text-gray-900">
            28. Tools and Equipment (check all applicable)
          </h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Self‑Contained Breathing Apparatus (SCBA)</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Rope</span>
            </label>
            <input type="text" placeholder="Total length (m)" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Ladder</span>
            </label>
            <input type="number" min="0" placeholder="Number of ladders" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Hoseline</span>
            </label>
            <input type="text" placeholder="Size and number" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <label class="flex items-center gap-2">
              <input type="checkbox" class="h-4 w-4" />
              <span>Hydraulic Tools / Equipment</span>
            </label>
            <input type="number" min="0" placeholder="Number of units" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />

            <div class="md:col-span-2">
              <label class="block text-xs font-bold text-gray-900 mb-1">
                Others (specify)
              </label>
              <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
            </div>
          </div>
        </div>

        <!-- 29 Fire Hydrant -->
        <div>
          <label class="block text-sm font-bold text-gray-900 mb-1">
            29. Location and Distance of Nearest Serviceable Fire Hydrant
          </label>
          <input
            type="text"
            class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
            placeholder="Describe location and approximate distance"
          />
        </div>
      </div>

      <!-- D. FIRE ALARM LEVEL (30–31) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          D. Fire Alarm Level
        </h3>

        <p class="text-xs text-gray-600">
          Indicate date and time in 24‑hour format, and the Incident Commander / Ground Commander for each alarm status.
        </p>

        <div class="space-y-3 text-xs">
          <!-- 30 Alarm timeline -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div>
              <label class="block font-bold mb-1">1st Alarm</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">2nd Alarm</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">3rd Alarm</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div>
              <label class="block font-bold mb-1">4th Alarm</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">5th Alarm</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">Task Force Alpha</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div>
              <label class="block font-bold mb-1">Task Force Bravo</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">Task Force Charlie</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">Task Force Delta</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-end">
            <div>
              <label class="block font-bold mb-1">General Alarm</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">Fire Under Control (FUC)</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
            <div>
              <label class="block font-bold mb-1">Fire Out (FO)</label>
              <input type="datetime-local" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm" />
            </div>
          </div>
        </div>

        <!-- Incident / Ground Commander -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-3">
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Incident Commander
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block text-sm font-bold text-gray-900 mb-1">
              Ground Commander
            </label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
        </div>

        <!-- 31 ICP -->
        <div class="mt-3">
          <label class="block text-sm font-bold text-gray-900 mb-1">
            31. Incident Command Post (ICP)
          </label>
          <div class="flex flex-col md:flex-row gap-2 text-sm items-center">
            <label class="flex items-center gap-2">
              <input type="radio" name="icp" class="h-4 w-4" />
              <span>With ICP</span>
            </label>
            <label class="flex items-center gap-2">
              <input type="radio" name="icp" class="h-4 w-4" />
              <span>Without ICP</span>
            </label>
          </div>
          <input
            type="text"
            class="mt-2 w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm"
            placeholder="If with ICP, specify location"
          />
        </div>
      </div>

      <!-- E. PROFILE OF CASUALTIES (32) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          E. Profile of Casualties
        </h3>

        <div class="overflow-x-auto">
          <table class="min-w-full text-xs border border-gray-300">
            <thead class="bg-gray-100">
              <tr>
                <th class="border border-gray-300 px-2 py-1 text-left font-bold">Category</th>
                <th class="border border-gray-300 px-2 py-1 text-center font-bold">Male</th>
                <th class="border border-gray-300 px-2 py-1 text-center font-bold">Female</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td class="border border-gray-300 px-2 py-1">Injured Civilian</td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
              </tr>
              <tr>
                <td class="border border-gray-300 px-2 py-1">Injured BFP Firefighter</td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
              </tr>
              <tr>
                <td class="border border-gray-300 px-2 py-1">Injured Fire Auxiliary</td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
              </tr>
              <tr>
                <td class="border border-gray-300 px-2 py-1">Civilian Fatalities</td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
              </tr>
              <tr>
                <td class="border border-gray-300 px-2 py-1">BFP Firefighter Fatalities</td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
              </tr>
              <tr>
                <td class="border border-gray-300 px-2 py-1">Fire Auxiliary Fatalities</td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
                <td class="border border-gray-300 px-1 py-1 text-center">
                  <input type="number" min="0" class="w-16 border border-gray-300 rounded p-1 text-gray-900 font-medium" />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- F. PERSONNEL-ON-DUTY (33) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          F. Personnel On Duty
        </h3>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <div>
            <label class="block font-bold mb-1">Engine Commander</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Shift‑in‑Charge</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Nozzleman</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Lineman</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Engine Crew</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Driver</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Pump Operator / DPO</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>

          <div>
            <label class="block font-bold mb-1">Safety Officer (in charge)</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium mb-1" />
            <input
              type="tel"
              class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
              placeholder="Contact number"
            />
          </div>

          <div class="md:col-span-2">
            <label class="block font-bold mb-1">
              Fire and Arson Investigators (in charge)
            </label>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
              <input
                type="text"
                class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                placeholder="Name"
              />
              <input
                type="tel"
                class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium"
                placeholder="Contact number"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- G. OTHER BFP PERSONNEL AND SIGNIFICANT PERSONALITIES (34) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          G. Other BFP Personnel and Significant Personalities Present
        </h3>

        <p class="text-xs text-gray-600">
          Indicate other BFP personnel and significant personalities present at the fire scene, including their designation and agency.
        </p>

        <div class="space-y-3 text-xs">
          <!-- Three rows as default, can be made dynamic in app logic -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Name" />
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Designation / Agency" />
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Remarks" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Name" />
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Designation / Agency" />
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Remarks" />
          </div>
          <div class="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Name" />
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Designation / Agency" />
            <input type="text" class="border border-gray-300 rounded p-2 text-gray-900 font-medium" placeholder="Remarks" />
          </div>
        </div>
      </div>

      <!-- H. SKETCH OF THE FIRE SCENE (35) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          H. Sketch of the Fire Scene
        </h3>
        <p class="text-xs text-gray-600">
          Upload a sketch or satellite view image of the fire scene (JPEG, PNG, or similar image file).
        </p>
        <!-- Image attachment field -->
        <input
          type="file"
          accept="image/*"
          class="w-full border border-dashed border-gray-400 rounded p-3 text-gray-700 text-sm"
        />
      </div>

      <!-- I. NARRATIVE CONTENT (36) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          I. Narrative Content
        </h3>
        <p class="text-xs text-gray-600">
          Write the narrative in chronological order, covering receipt of call, dispatch, response, arrival, operations, casualties, and other significant events.
        </p>
        <textarea
          class="text-gray-900 border border-gray-300 rounded p-2 h-40 w-full font-medium placeholder-gray-500 text-sm"
          placeholder="On or about (time, date) call/report received, (Name of duty Floor watch/FCOS) received a call from (name of caller) with (telephone/CP number) regarding (description of type of involved) at (address) near (landmark)..."
        ></textarea>
      </div>

      <!-- J. PROBLEMS ENCOUNTERED (37) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          J. Problems Encountered
        </h3>
        <p class="text-xs text-gray-600">
          Check all applicable problems encountered before, during, and after fire operations, and specify others if needed.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Inaccurate address / no landmarks (difficulty finding the involved)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Geographically challenged (distance of fire station to community, mountainous, inter‑island, etc.)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Road conditions (double parking, narrow or obstructed streets, rough roads, etc.)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Road under construction / under repair</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Traffic congestion</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Road accidents</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Vehicles failure to yield</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Natural disasters / natural phenomena (flooding, landslides, earthquakes, etc.)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Civil disturbance (riots, rallies)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Uncooperative / panicked residents</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Safety and security threats (insurgents, terrorists, violent residents)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Response delays due to lack of cooperation from property security and/or owner (e.g. PEZA)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Engine failure / mechanical problems en route</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Uncooperative fire auxiliary</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Poor water supply / access</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Intense heat and smoke during firefighting operation</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Structural hazards (building collapse, electrical hazard, falling debris)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Equipment malfunction (faulty hoses, overheating, mechanical issues)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Lack of coordination with other emergency teams (police, medics, etc.)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Breakdown in radio communication (distance, structures, system failure)</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>HazMat contamination / chemical leaks</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Physical exhaustion and injuries among responders</span>
          </label>
          <label class="flex items-start gap-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Emotional and psychological effects</span>
          </label>
          <label class="flex items-start gap-2 md:col-span-2">
            <input type="checkbox" class="mt-1 h-4 w-4" />
            <span>Community complaints against responders</span>
          </label>
        </div>

        <div class="mt-2">
          <label class="block text-xs font-bold text-gray-900 mb-1">
            Others (specify)
          </label>
          <input
            type="text"
            class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium text-sm"
          />
        </div>
      </div>

      <!-- K. RECOMMENDATIONS (38) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          K. Recommendations
        </h3>
        <p class="text-xs text-gray-600">
          Recommendations should address and solve the problems encountered above.
        </p>
        <textarea
          class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium h-28 text-sm"
          placeholder="Provide clear and actionable recommendations..."
        ></textarea>
      </div>

      <!-- L. DISPOSITION (39) -->
      <div class="space-y-4 border-b pb-4">
        <h3 class="font-bold text-lg text-red-900 border-l-4 border-red-800 pl-2">
          L. Disposition
        </h3>
        <textarea
          class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium h-28 text-sm"
          placeholder="As of this date, no complaint has been filed against this Fire Station in relation to the fire suppression operation conducted. Accordingly, this report is hereby referred to the Intelligence and Investigation Unit/Section for further verification and fire cause determination..."
        ></textarea>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mt-2">
          <div>
            <label class="block font-bold mb-1">Prepared by (Shift‑in‑Charge)</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
          <div>
            <label class="block font-bold mb-1">Noted by (Engine Company Commander)</label>
            <input type="text" class="w-full border border-gray-300 rounded p-2 text-gray-900 font-medium" />
          </div>
        </div>
      </div>

      <!-- Region ID / Footer -->
      <div class="text-xs text-gray-500 text-center font-bold">
        Region ID:
      </div>

      <!-- Submit Button -->
      <button
        type="submit"
        class="w-full bg-red-800 text-white py-3 rounded font-bold hover:bg-red-700 disabled:opacity-50 flex justify-center items-center gap-2 shadow-lg"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-save w-5 h-5" aria-hidden="true">
          <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path>
          <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"></path>
          <path d="M7 3v4a1 1 0 0 0 1 1h7"></path>
        </svg>
        Submit AFOR Report
      </button>
    </form>
  </div>
</div>
