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

    const payload = {
      full_name: document.getElementById("full_name").value.trim(),
      organization: document.getElementById("organization").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      address: document.getElementById("address").value.trim(),
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
