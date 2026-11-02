// Booking form handling with dynamic availability schedule & collision checks
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("bookingForm");
  const alertBox = document.getElementById("alertBox");
  const submitBtn = document.getElementById("submitBtn");

  const roomSelect = document.getElementById("room");
  const dateInput = document.getElementById("event_date");
  const startTimeInput = document.getElementById("start_time");
  const endTimeInput = document.getElementById("end_time");

  const availabilityContainer = document.getElementById("availabilityContainer");
  const availabilityTitle = document.getElementById("availabilityDateTitle");
  const slotsGrid = document.getElementById("slotsGrid");

  let bookedSlots = [];

  // Minimum date is today
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.min = today;
  }

  // When room or date changes, fetch and display schedule
  roomSelect.addEventListener("change", checkSchedule);
  dateInput.addEventListener("change", checkSchedule);

  async function checkSchedule() {
    const dateVal = dateInput.value;
    const roomVal = roomSelect.value;

    if (!dateVal || !roomVal) {
      availabilityContainer.style.display = "none";
      return;
    }

    availabilityContainer.style.display = "block";
    availabilityTitle.textContent = `Availability for ${formatRoom(roomVal)} on ${dateVal}`;
    slotsGrid.innerHTML = `<div style="grid-column: 1/-1; font-size:0.85rem; color:var(--text-muted);">Checking hall bookings...</div>`;

    try {
      const res = await fetch(`/api/bookings?availability=1&date=${encodeURIComponent(dateVal)}&room=${encodeURIComponent(roomVal)}`);
      if (res.ok) {
        const data = await res.json();
        bookedSlots = data.bookedSlots || [];
      } else {
        bookedSlots = [];
      }
    } catch {
      // Local development fallback demo
      bookedSlots = [
        { start_time: "10:00", end_time: "12:00" },
        { start_time: "15:00", end_time: "17:30" }
      ];
    }

    renderSlots();
    validateChosenTimes();
  }

  // Render hourly/half-hourly blocks from 08:00 to 23:00
  function renderSlots() {
    slotsGrid.innerHTML = "";
    const hours = [
      "08:00", "09:00", "10:00", "11:00", "12:00", "13:00",
      "14:00", "15:00", "16:00", "17:00", "18:00", "19:00",
      "20:00", "21:00", "22:00"
    ];

    hours.forEach(hour => {
      const isBooked = isTimeBusy(hour);
      const slot = document.createElement("div");
      slot.className = `time-slot ${isBooked ? "slot-busy" : "slot-available"}`;
      slot.innerHTML = `<span>${hour}</span><br><small style="font-size:0.7rem;">${isBooked ? "Booked" : "Open"}</small>`;

      // Allow clicking an open slot to quickly set start time
      if (!isBooked) {
        slot.style.cursor = "pointer";
        slot.title = "Click to select this start time";
        slot.addEventListener("click", () => {
          startTimeInput.value = hour;
          validateChosenTimes();
        });
      }

      slotsGrid.appendChild(slot);
    });
  }

  function isTimeBusy(time) {
    return bookedSlots.some(b => {
      return time >= b.start_time && time < b.end_time;
    });
  }

  // Validate start and end time selections against booked slots
  startTimeInput.addEventListener("change", validateChosenTimes);
  endTimeInput.addEventListener("change", validateChosenTimes);

  function validateChosenTimes() {
    const s = startTimeInput.value;
    const e = endTimeInput.value;

    if (!s || !e) return;

    if (s >= e) {
      showError("End time must be later than start time.");
      return;
    }

    // Check collision: (s < booking.end) AND (e > booking.start)
    const collision = bookedSlots.find(b => s < b.end_time && e > b.start_time);
    if (collision) {
      showError(`The selected time period (${s} - ${e}) clashes with an existing booking (${collision.start_time} - ${collision.end_time}). Please adjust your times.`);
      submitBtn.disabled = true;
    } else {
      clearError();
      submitBtn.disabled = false;
    }
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
      special_requirements: document.getElementById("special_requirements").value.trim()
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
          <span style="font-size:0.9rem;">The lettings team will review your application and issue contractual confirmation.</span>
        `;
        alertBox.style.display = "block";
        form.reset();
        availabilityContainer.style.display = "none";
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
