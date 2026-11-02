// Booking form handling
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("bookingForm");
  const alertBox = document.getElementById("alertBox");
  const submitBtn = document.getElementById("submitBtn");

  // Prevent past dates from being chosen
  const dateInput = document.getElementById("event_date");
  if (dateInput) {
    const today = new Date().toISOString().split("T")[0];
    dateInput.min = today;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitting Reservation...";
    alertBox.style.display = "none";

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
          <strong>Thank you! Your booking inquiry has been submitted.</strong><br>
          Your Reference Number: <strong style="font-family: monospace; font-size:1.1rem;">${result.reference_code}</strong><br>
          <span style="font-size:0.9rem;">Please keep this reference for your records. The hall lettings secretary will contact you shortly with confirmation.</span>
        `;
        alertBox.style.display = "block";
        form.reset();
        window.scrollTo({ top: alertBox.offsetTop - 80, behavior: "smooth" });
      } else {
        throw new Error(result.error || "Failed to submit reservation.");
      }
    } catch (err) {
      alertBox.className = "alert alert-error";
      alertBox.textContent = "Error: " + err.message;
      alertBox.style.display = "block";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Submit Booking Request";
    }
  });
});
