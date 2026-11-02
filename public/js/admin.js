// Admin Dashboard Logic
let token = sessionStorage.getItem("cvh_admin_token") || "";

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("adminLoginForm");
  const loginCard = document.getElementById("loginCard");
  const dashboardSection = document.getElementById("dashboardSection");
  const logoutBtn = document.getElementById("logoutBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const filterStatus = document.getElementById("filterStatus");

  if (token) {
    showDashboard();
  }

  loginForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const secret = document.getElementById("adminSecret").value.trim();
    if (!secret) return;

    token = secret;
    sessionStorage.setItem("cvh_admin_token", token);
    showDashboard();
  });

  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("cvh_admin_token");
    token = "";
    loginCard.style.display = "block";
    dashboardSection.style.display = "none";
    logoutBtn.style.display = "none";
  });

  refreshBtn.addEventListener("click", () => loadBookings());
  filterStatus.addEventListener("change", () => loadBookings());
});

async function showDashboard() {
  document.getElementById("loginCard").style.display = "none";
  document.getElementById("dashboardSection").style.display = "block";
  document.getElementById("logoutBtn").style.display = "inline-block";
  await loadBookings();
}

async function loadBookings() {
  const tbody = document.getElementById("bookingsTableBody");
  const notice = document.getElementById("statusNotice");
  const filter = document.getElementById("filterStatus").value;

  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem;">Loading bookings...</td></tr>`;

  try {
    const url = `/api/bookings${filter ? `?status=${filter}` : ""}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        sessionStorage.removeItem("cvh_admin_token");
        alert("Unauthorized secret key. Please log in again.");
        location.reload();
        return;
      }
      if (res.status === 503) {
        notice.className = "alert alert-error";
        notice.textContent = "Notice: Cloudflare D1 database binding 'DB' is not configured yet. Showing demo data or empty.";
        notice.style.display = "block";
      }
      throw new Error(data.error || "Failed to load bookings");
    }

    const bookings = data.bookings || [];
    if (bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--text-muted);">No booking requests found.</td></tr>`;
      return;
    }

    tbody.innerHTML = bookings.map(b => `
      <tr>
        <td><strong>${escapeHtml(b.reference_code)}</strong></td>
        <td>
          <strong>${escapeHtml(b.event_date)}</strong><br>
          <small style="color:var(--text-muted);">${escapeHtml(b.start_time)} - ${escapeHtml(b.end_time)}</small>
        </td>
        <td>
          <strong>${escapeHtml(b.full_name)}</strong><br>
          <small>${escapeHtml(b.email)} | ${escapeHtml(b.phone)}</small>
          ${b.organization ? `<br><small style="color:var(--text-muted);">Org: ${escapeHtml(b.organization)}</small>` : ""}
        </td>
        <td>
          <span style="font-weight:600;">${formatRoom(b.room)}</span><br>
          <small>${formatEventType(b.event_type)} (${b.guest_count} guests)</small>
        </td>
        <td>
          ${b.requires_stage ? '<span class="badge badge-amber" style="font-size:0.7rem;">Stage</span> ' : ''}
          ${b.requires_kitchen ? '<span class="badge badge-green" style="font-size:0.7rem;">Kitchen</span>' : ''}
          ${!b.requires_stage && !b.requires_kitchen ? '<small style="color:var(--text-muted);">None</small>' : ''}
        </td>
        <td>
          <span class="status-tag status-${b.status.toLowerCase()}">${escapeHtml(b.status)}</span>
        </td>
        <td>
          <div style="display:flex; gap:0.35rem;">
            ${b.status !== 'confirmed' ? `<button class="btn btn-sm btn-primary" onclick="updateStatus(${b.id}, 'confirmed')">Confirm</button>` : ''}
            ${b.status !== 'declined' ? `<button class="btn btn-sm btn-outline" onclick="updateStatus(${b.id}, 'declined')">Decline</button>` : ''}
          </div>
        </td>
      </tr>
    `).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

async function updateStatus(id, newStatus) {
  if (!confirm(`Are you sure you want to mark booking #${id} as ${newStatus}?`)) return;

  try {
    const res = await fetch("/api/bookings", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id, status: newStatus })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      loadBookings();
    } else {
      alert("Error updating status: " + (data.error || "Unknown error"));
    }
  } catch (err) {
    alert("Network error: " + err.message);
  }
}

function formatRoom(room) {
  const map = {
    main_hall: "Main Hall",
    small_hall: "Small Hall",
    committee_room: "Committee Room",
    entire_venue: "Entire Complex"
  };
  return map[room] || room;
}

function formatEventType(evt) {
  const map = {
    private_party: "Private Party",
    wedding_reception: "Wedding Reception",
    fitness_class: "Fitness/Class",
    theatrical_performance: "Theatrical/Stage",
    meeting_conference: "Meeting/Conference",
    other: "Other"
  };
  return map[evt] || evt;
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
