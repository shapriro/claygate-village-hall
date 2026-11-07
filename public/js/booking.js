// Booking form handling with dynamic availability schedule, live price calculator, and collision checks
document.addEventListener("DOMContentLoaded", async () => {
  const form = document.getElementById("bookingForm");
  const alertBox = document.getElementById("alertBox");
  const submitBtn = document.getElementById("submitBtn");

  const roomSelect = document.getElementById("room");
  const dateInput = document.getElementById("event_date");
  const startTimeInput = document.getElementById("start_time");
  const endTimeInput = document.getElementById("end_time");
  const stageCheckbox = document.getElementById("requires_stage");
  const kitchenCheckbox = document.getElementById("requires_kitchen");

  const availabilityContainer = document.getElementById("availabilityContainer");
  const availabilityTitle = document.getElementById("availabilityDateTitle");
  const slotsGrid = document.getElementById("slotsGrid");

  const costContainer = document.getElementById("costSummaryContainer");
  const costBreakdownList = document.getElementById("costBreakdownList");
  const displayTotalCost = document.getElementById("displayTotalCost");

  let bookedSlots = [];
  let currentCost = 0.0;

  // Default prices fallback
  let pricingTable = {
    rate_main_hall: 16.0,
    rate_small_hall: 11.0,
    rate_committee_room: 8.0,
    rate_entire_venue: 25.0,
    rate_stage_av: 25.0,
    rate_kitchen_commercial: 10.0,
    rate_deposit: 50.0
  };

  // Fetch live pricing from server
  try {
    const pRes = await fetch("/api/pricing");
    if (pRes.ok) {
      const pData = await pRes.json();
      (pData.pricing || []).forEach(p => {
        pricingTable[p.key] = parseFloat(p.price) || 0.0;
      });
    }
  } catch (err) {
    console.warn("Using fallback pricing table:", err);
  }

  // Inputs for Phone, Postcode & Address
  const phoneInput = document.getElementById("phone");
  const phoneHint = document.getElementById("phoneHint");
  const addressLine1 = document.getElementById("address_line1");
  const addressCity = document.getElementById("address_city");
  const addressPostcode = document.getElementById("address_postcode");
  const addressHidden = document.getElementById("address");
  const postcodeHint = document.getElementById("postcodeHint");
  const postcodeSearch = document.getElementById("postcode_search");
  const btnFindAddress = document.getElementById("btnFindAddress");
  const postcodeSearchHint = document.getElementById("postcodeSearchHint");
  const manualAddressToggle = document.getElementById("manualAddressToggle");
  const postcodeLookupRow = document.getElementById("postcodeLookupRow");

  // 1. Phone number validation and restriction (digits only, valid length 10-11)
  if (phoneInput) {
    phoneInput.addEventListener("input", (e) => {
      // Allow only digits and spaces/plus initially, but clean to digits
      const raw = e.target.value;
      // Strip out anything that is not digit or leading +
      let cleaned = raw.replace(/[^\d+ ]/g, "");
      // Replace double spaces
      cleaned = cleaned.replace(/ +/g, " ");
      if (e.target.value !== cleaned) {
        e.target.value = cleaned;
      }
      validatePhone();
    });

    phoneInput.addEventListener("blur", validatePhone);
  }

  function validatePhone() {
    const raw = phoneInput.value.trim();
    // Normalize: remove all spaces, dashes, parentheses
    let digits = raw.replace(/\D/g, "");
    
    // If user typed +44, replace with 0
    if (raw.startsWith("+44")) {
      digits = "0" + digits.substring(2);
    }

    if (!raw) {
      setFieldStatus(phoneInput, phoneHint, "", "UK telephone number (10–11 digits)");
      return false;
    }

    // UK telephone numbers are either 10 digits (some landlines) or 11 digits (standard mobile & landline)
    // Starting with 01, 02, 03, 07, 08
    const isValidLength = digits.length >= 10 && digits.length <= 11;
    const startsWithUK = digits.startsWith("0") || raw.startsWith("+");

    if (isValidLength && startsWithUK) {
      setFieldStatus(phoneInput, phoneHint, "success", "✓ Valid UK phone number format");
      return true;
    } else {
      let msg = "Invalid UK phone number: ";
      if (digits.length < 10) msg += `Too short (${digits.length} digits, must be 10 or 11)`;
      else if (digits.length > 11) msg += `Too long (${digits.length} digits, must be 10 or 11)`;
      else if (!startsWithUK) msg += "Must start with a UK prefix (e.g. 07 or 01/02)";
      setFieldStatus(phoneInput, phoneHint, "error", msg);
      return false;
    }
  }

  // 2. Postcode validation (official UK format: e.g. KT10 0PQ, SW1A 1AA, etc.)
  const UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/i;

  function formatPostcode(str) {
    const clean = str.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (clean.length > 3) {
      return clean.slice(0, -3) + " " + clean.slice(-3);
    }
    return clean;
  }

  if (addressPostcode) {
    addressPostcode.addEventListener("input", (e) => {
      // Restrict characters: alphanumeric only
      let val = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
      if (val.length > 8) val = val.slice(0, 8);
      e.target.value = val;
      validatePostcodeField();
    });

    addressPostcode.addEventListener("blur", () => {
      if (addressPostcode.value.trim()) {
        addressPostcode.value = formatPostcode(addressPostcode.value.trim());
      }
      validatePostcodeField();
    });
  }

  function validatePostcodeField() {
    const val = addressPostcode.value.trim();
    if (!val) {
      setFieldStatus(addressPostcode, postcodeHint, "", "UK postcode format (e.g. KT10 0PQ)");
      return false;
    }
    const clean = val.replace(/\s+/g, "");
    if (clean.length >= 5 && clean.length <= 7 && UK_POSTCODE_REGEX.test(val)) {
      setFieldStatus(addressPostcode, postcodeHint, "success", "✓ Valid UK postcode");
      return true;
    } else {
      setFieldStatus(addressPostcode, postcodeHint, "error", "Invalid postcode format (must match UK standard like KT10 0PQ)");
      return false;
    }
  }

  // 3. Postcode Lookup (Automatic via postcodes.io + Fallback)
  if (btnFindAddress && postcodeSearch) {
    btnFindAddress.addEventListener("click", performPostcodeLookup);
    postcodeSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        performPostcodeLookup();
      }
    });

    postcodeSearch.addEventListener("input", (e) => {
      let val = e.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, "");
      if (val.length > 8) val = val.slice(0, 8);
      e.target.value = val;
    });
  }

  async function performPostcodeLookup() {
    const raw = postcodeSearch.value.trim();
    if (!raw) {
      setFieldStatus(postcodeSearch, postcodeSearchHint, "error", "Please enter a postcode to search.");
      return;
    }

    const clean = raw.replace(/\s+/g, "");
    if (!UK_POSTCODE_REGEX.test(raw)) {
      setFieldStatus(postcodeSearch, postcodeSearchHint, "error", "Invalid UK postcode format (e.g. KT10 0PQ).");
      return;
    }

    btnFindAddress.disabled = true;
    btnFindAddress.textContent = "Searching...";
    setFieldStatus(postcodeSearch, postcodeSearchHint, "", "Looking up address details...");

    try {
      const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`);
      const data = await res.json();

      if (res.ok && data.status === 200 && data.result) {
        const r = data.result;
        const formattedPc = r.postcode;
        // Derive Town / City
        const locality = r.parish || r.admin_ward || "";
        const district = r.admin_district || "";
        let cityTown = "";
        if (locality && district && locality !== district) {
          cityTown = `${locality}, ${district}`;
        } else {
          cityTown = district || locality || r.region || "United Kingdom";
        }

        addressPostcode.value = formattedPc;
        addressCity.value = cityTown;
        validatePostcodeField();

        setFieldStatus(postcodeSearch, postcodeSearchHint, "success", `✓ Found: ${cityTown} (${formattedPc}). Please enter your house number/street below.`);
        addressLine1.focus();
      } else {
        throw new Error(data.error || "Postcode not found in UK database.");
      }
    } catch (err) {
      setFieldStatus(postcodeSearch, postcodeSearchHint, "error", `Lookup note: ${err.message}. You can enter your full address manually below.`);
      addressPostcode.value = formatPostcode(raw);
    } finally {
      btnFindAddress.disabled = false;
      btnFindAddress.textContent = "Find Address";
    }
  }

  // 4. Toggle manual address mode
  if (manualAddressToggle) {
    let manualMode = false;
    manualAddressToggle.addEventListener("click", () => {
      manualMode = !manualMode;
      if (manualMode) {
        postcodeLookupRow.style.display = "none";
        manualAddressToggle.textContent = "Use Postcode Lookup";
      } else {
        postcodeLookupRow.style.display = "block";
        manualAddressToggle.textContent = "Enter address manually";
      }
      addressLine1.focus();
    });
  }

  function setFieldStatus(inputEl, hintEl, state, message) {
    inputEl.classList.remove("is-valid", "is-invalid");
    hintEl.classList.remove("success", "error");
    if (state === "valid" || state === "success") {
      inputEl.classList.add("is-valid");
      hintEl.classList.add("success");
    } else if (state === "invalid" || state === "error") {
      inputEl.classList.add("is-invalid");
      hintEl.classList.add("error");
    }
    hintEl.textContent = message;
  }

  // Assemble full address for submission and hidden input
  function updateConsolidatedAddress() {
    const l1 = addressLine1 ? addressLine1.value.trim() : "";
    const city = addressCity ? addressCity.value.trim() : "";
    const pc = addressPostcode ? addressPostcode.value.trim() : "";
    const parts = [l1, city, pc].filter(Boolean);
    const full = parts.join(", ");
    if (addressHidden) {
      addressHidden.value = full;
    }
    return full;
  }

  [addressLine1, addressCity, addressPostcode].forEach(el => {
    if (el) el.addEventListener("input", updateConsolidatedAddress);
  });

  // Minimum date is today
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.min = today;
  }

  // Event listeners for schedule & price recalculations
  roomSelect.addEventListener("change", () => { checkSchedule(); calculateCost(); });
  dateInput.addEventListener("change", checkSchedule);
  startTimeInput.addEventListener("change", () => { validateChosenTimes(); calculateCost(); });
  endTimeInput.addEventListener("change", () => { validateChosenTimes(); calculateCost(); });
  stageCheckbox.addEventListener("change", calculateCost);
  kitchenCheckbox.addEventListener("change", calculateCost);

  async function checkSchedule() {
    const dateVal = dateInput.value;
    const roomVal = roomSelect.value;

    if (!dateVal || !roomVal) {
      availabilityContainer.style.display = "none";
      return;
    }

    availabilityContainer.style.display = "block";
    availabilityTitle.textContent = `Availability for ${formatRoom(roomVal)} on ${dateVal}`;
    slotsGrid.innerHTML = `<div style="grid-column: 1/-1; font-size:0.85rem; color:var(--text-muted);">Checking hall timetable & bookings...</div>`;

    try {
      const res = await fetch(`/api/bookings?availability=1&date=${encodeURIComponent(dateVal)}&room=${encodeURIComponent(roomVal)}`);
      if (res.ok) {
        const data = await res.json();
        bookedSlots = data.bookedSlots || [];
      } else {
        bookedSlots = [];
      }
    } catch {
      bookedSlots = [];
    }

    renderSlots();
    validateChosenTimes();
  }

  function renderSlots() {
    slotsGrid.innerHTML = "";
    const hours = [
      "08:00", "09:00", "10:00", "11:00", "12:00", "13:00",
      "14:00", "15:00", "16:00", "17:00", "18:00", "19:00",
      "20:00", "21:00", "22:00"
    ];

    hours.forEach(hour => {
      const busyItem = getBusyConflict(hour);
      const isBooked = !!busyItem;
      const slot = document.createElement("div");
      slot.className = `time-slot ${isBooked ? "slot-busy" : "slot-available"}`;
      
      const label = isBooked ? (busyItem.title || busyItem.reason || "Booked") : "Open";
      slot.innerHTML = `<span>${hour}</span><br><small style="font-size:0.65rem; display:block; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;" title="${label}">${isBooked ? "Booked" : "Open"}</small>`;

      if (!isBooked) {
        slot.style.cursor = "pointer";
        slot.title = `Click to choose ${hour} as start time`;
        slot.addEventListener("click", () => {
          startTimeInput.value = hour;
          validateChosenTimes();
          calculateCost();
        });
      }

      slotsGrid.appendChild(slot);
    });
  }

  function getBusyConflict(time) {
    return bookedSlots.find(b => time >= b.start_time && time < b.end_time);
  }

  function validateChosenTimes() {
    const s = startTimeInput.value;
    const e = endTimeInput.value;

    if (!s || !e) return;

    if (s >= e) {
      showError("End time must be later than start time.");
      submitBtn.disabled = true;
      return;
    }

    const collision = bookedSlots.find(b => s < b.end_time && e > b.start_time);
    if (collision) {
      const reason = collision.title || collision.reason || "an existing booking";
      showError(`The selected time period (${s} - ${e}) clashes with ${reason} (${collision.start_time} - ${collision.end_time}). Please adjust your times.`);
      submitBtn.disabled = true;
    } else {
      clearError();
      submitBtn.disabled = false;
    }
  }

  // --- Dynamic Live Cost Calculator ---
  function calculateCost() {
    const room = roomSelect.value;
    const s = startTimeInput.value;
    const e = endTimeInput.value;

    if (!room || !s || !e || s >= e) {
      costContainer.style.display = "none";
      currentCost = 0.0;
      return;
    }

    const startParts = s.split(":").map(Number);
    const endParts = e.split(":").map(Number);
    const durationHours = (endParts[0] + endParts[1] / 60) - (startParts[0] + startParts[1] / 60);

    if (durationHours <= 0) {
      costContainer.style.display = "none";
      return;
    }

    const hourlyRateKey = `rate_${room}`;
    const hourlyRate = pricingTable[hourlyRateKey] || 16.0;
    const roomCost = durationHours * hourlyRate;

    let total = roomCost;
    const breakdown = [
      `<li><span>${formatRoom(room)} (${durationHours.toFixed(1)} hrs @ £${hourlyRate.toFixed(2)}/hr)</span> <strong>£${roomCost.toFixed(2)}</strong></li>`
    ];

    if (stageCheckbox.checked) {
      const stageFee = pricingTable["rate_stage_av"] || 25.0;
      total += stageFee;
      breakdown.push(`<li><span>Stage & PA System (Flat fee)</span> <strong>£${stageFee.toFixed(2)}</strong></li>`);
    }

    if (kitchenCheckbox.checked) {
      const kitchenFee = pricingTable["rate_kitchen_commercial"] || 10.0;
      total += kitchenFee;
      breakdown.push(`<li><span>Commercial Kitchen / Dishwasher Usage</span> <strong>£${kitchenFee.toFixed(2)}</strong></li>`);
    }

    currentCost = total;
    displayTotalCost.textContent = `£${total.toFixed(2)}`;
    costBreakdownList.innerHTML = breakdown.join("");
    costContainer.style.display = "block";
  }

  function showError(msg) {
    alertBox.className = "alert alert-error";
    alertBox.textContent = msg;
    alertBox.style.display = "block";
  }

  function clearError() {
    alertBox.style.display = "none";
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    clearError();

    // Validate phone number
    if (!validatePhone()) {
      showError("Please enter a valid UK phone number (10 or 11 digits, numbers only).");
      phoneInput.focus();
      return;
    }

    // Validate postcode
    if (!validatePostcodeField()) {
      showError("Please enter a valid UK postcode (e.g. KT10 0PQ).");
      addressPostcode.focus();
      return;
    }

    // Validate address line 1 & city
    if (!addressLine1.value.trim()) {
      showError("Please enter your Address Line 1.");
      addressLine1.focus();
      return;
    }

    if (!addressCity.value.trim()) {
      showError("Please enter your Town or City.");
      addressCity.focus();
      return;
    }

    const consolidatedAddr = updateConsolidatedAddress();

    const payload = {
      full_name: document.getElementById("full_name").value.trim(),
      organization: document.getElementById("organization").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: phoneInput.value.trim(),
      address: consolidatedAddr,
      address_line1: addressLine1.value.trim(),
      address_city: addressCity.value.trim(),
      address_postcode: addressPostcode.value.trim(),
      room: document.getElementById("room").value,
      event_type: document.getElementById("event_type").value,
      event_date: document.getElementById("event_date").value,
      start_time: document.getElementById("start_time").value,
      end_time: document.getElementById("end_time").value,
      guest_count: parseInt(document.getElementById("guest_count").value, 10) || 0,
      requires_stage: document.getElementById("requires_stage").checked,
      requires_kitchen: document.getElementById("requires_kitchen").checked,
      special_requirements: document.getElementById("special_requirements").value.trim(),
      estimated_cost: currentCost
    };

    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting Reservation...";

    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await res.json();

      if (res.ok && result.success) {
        alertBox.className = "alert alert-success";
        alertBox.innerHTML = `
          <strong>Thank you! Your booking inquiry has been recorded.</strong><br>
          Your Reference Code: <strong style="font-family: monospace; font-size:1.15rem; color:#1e3a8a;">${result.reference_code}</strong><br>
          Estimated Hire Cost: <strong>£${currentCost.toFixed(2)}</strong><br>
          <span style="font-size:0.9rem;">The lettings manager will review your submission and contact you with booking confirmation.</span>
        `;
        alertBox.style.display = "block";
        form.reset();
        availabilityContainer.style.display = "none";
        costContainer.style.display = "none";
        window.scrollTo({ top: alertBox.offsetTop - 80, behavior: "smooth" });
      } else {
        throw new Error(result.error || "Failed to submit reservation.");
      }
    } catch (err) {
      showError("Submission Error: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Booking Request";
    }
  });

  function formatRoom(room) {
    const map = {
      main_hall: "Main Hall",
      small_hall: "Small Hall",
      committee_room: "Committee Room",
      entire_venue: "Entire Venue"
    };
    return map[room] || room;
  }
});
