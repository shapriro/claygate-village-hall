// Admin Dashboard Logic: Bookings & Pricing Administration
let token = sessionStorage.getItem("cvh_admin_token") || "";
let currentPricingList = [];

// Room sort weight priority
const ROOM_ORDER = {
  main_hall: 1,
  small_hall: 2,
  committee_room: 3,
  entire_venue: 4,
  stage_av: 5,
  kitchen_commercial: 6,
  deposit: 7
};

document.addEventListener("DOMContentLoaded", () => {
  const loginForm = document.getElementById("adminLoginForm");
  const loginCard = document.getElementById("loginCard");
  const dashboardSection = document.getElementById("dashboardSection");
  const logoutBtn = document.getElementById("logoutBtn");
  const refreshBtn = document.getElementById("refreshBtn");
  const filterStatus = document.getElementById("filterStatus");
  const savePricesBtn = document.getElementById("savePricesBtn");
  const toggleAddPriceBtn = document.getElementById("toggleAddPriceBtn");
  const addPriceCard = document.getElementById("addPriceCard");
  const addPriceForm = document.getElementById("addPriceForm");

  // Tab switching
  const tabBtns = document.querySelectorAll(".admin-tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const target = document.getElementById(btn.getAttribute("data-tab"));
      if (target) target.classList.add("active");
    });
  });

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

  refreshBtn.addEventListener("click", () => { loadBookings(); loadPricing(); });
  filterStatus.addEventListener("change", () => loadBookings());
  savePricesBtn.addEventListener("click", () => savePricing());

  // Toggle add price card
  if (toggleAddPriceBtn) {
    toggleAddPriceBtn.addEventListener("click", () => {
      const isHidden = addPriceCard.style.display === "none";
      addPriceCard.style.display = isHidden ? "block" : "none";
      toggleAddPriceBtn.textContent = isHidden ? "✕ Close Add Form" : "➕ Add New Price Rule";
    });
  }

  // Handle new price row submission
  if (addPriceForm) {
    addPriceForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const room = document.getElementById("newPriceRoom").value;
      const category = document.getElementById("newPriceCategory").value;
      const name = document.getElementById("newPriceName").value.trim();
      const unit = document.getElementById("newPriceUnit").value;
      const rate = parseFloat(document.getElementById("newPriceRate").value) || 0.0;

      // Unique key: facility + type of booking
      const key = `${room}_${category}`;

      // Check if rule already exists, update or add
      const existingIdx = currentPricingList.findIndex(item => item.key === key);
      const newRule = {
        key: key,
        room: room,
        category: category,
        name: name || `${formatRoom(room)} (${formatCategory(category)})`,
        unit: unit,
        price: rate
      };

      if (existingIdx >= 0) {
        currentPricingList[existingIdx] = newRule;
      } else {
        currentPricingList.push(newRule);
      }

      // Always sort by room type
      sortPricingList(currentPricingList);

      // Re-render table
      renderPricingTable(currentPricingList);

      // Reset & hide form
      addPriceForm.reset();
      addPriceCard.style.display = "none";
      if (toggleAddPriceBtn) toggleAddPriceBtn.textContent = "➕ Add New Price Rule";

      const notice = document.getElementById("pricingNotice");
      notice.className = "alert alert-success";
      notice.textContent = `Rule "${newRule.name}" added! Click "Save Price Changes" to publish.`;
      notice.style.display = "block";
      setTimeout(() => { notice.style.display = "none"; }, 3500);
    });
  }
});

async function showDashboard() {
  document.getElementById("loginCard").style.display = "none";
  document.getElementById("dashboardSection").style.display = "block";
  document.getElementById("logoutBtn").style.display = "inline-block";
  await loadBookings();
  await loadPricing();
}

async function loadBookings() {
  const tbody = document.getElementById("bookingsTableBody");
  const notice = document.getElementById("statusNotice");
  const filter = document.getElementById("filterStatus").value;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem;">Loading bookings...</td></tr>`;

  try {
    const url = `/api/bookings${filter ? `?status=${filter}` : ""}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        sessionStorage.removeItem("cvh_admin_token");
        alert("Unauthorized secret key. Please log in again.");
        location.reload();
        return;
      }
      throw new Error(data.error || "Failed to load bookings");
    }

    const bookings = data.bookings || [];
    if (bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--text-muted);">No booking requests found.</td></tr>`;
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
          <small>${formatCategory(b.event_type)} (${b.guest_count} guests)</small>
        </td>
        <td>
          ${b.requires_stage ? '<span class="badge badge-amber" style="font-size:0.7rem;">Stage</span> ' : ''}
          ${b.requires_kitchen ? '<span class="badge badge-green" style="font-size:0.7rem;">Kitchen</span>' : ''}
          ${!b.requires_stage && !b.requires_kitchen ? '<small style="color:var(--text-muted);">None</small>' : ''}
        </td>
        <td>
          <strong style="color:#166534;">£${(parseFloat(b.estimated_cost) || 0.0).toFixed(2)}</strong>
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
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

// Sort pricing list always by room type order, then category
function sortPricingList(list) {
  list.sort((a, b) => {
    const orderA = ROOM_ORDER[a.room] || 99;
    const orderB = ROOM_ORDER[b.room] || 99;
    if (orderA !== orderB) return orderA - orderB;
    return (a.category || "").localeCompare(b.category || "");
  });
}

async function loadPricing() {
  const tbody = document.getElementById("pricingTableBody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 1.5rem;">Loading pricing settings...</td></tr>`;

  try {
    const res = await fetch("/api/pricing");
    const data = await res.json();
    let list = data.pricing || [];

    // Ensure room and category exist on each row
    list = list.map(item => {
      let room = item.room;
      let category = item.category;

      if (!room) {
        if (item.key.includes("main_hall")) room = "main_hall";
        else if (item.key.includes("small_hall")) room = "small_hall";
        else if (item.key.includes("committee_room")) room = "committee_room";
        else if (item.key.includes("entire_venue")) room = "entire_venue";
        else if (item.key.includes("stage")) room = "stage_av";
        else if (item.key.includes("kitchen")) room = "kitchen_commercial";
        else if (item.key.includes("deposit")) room = "deposit";
        else room = "other";
      }

      if (!category || category === "room_rate" || category === "addon" || category === "deposit") {
        category = "all";
      }

      return {
        ...item,
        room: room,
        category: category
      };
    });

    sortPricingList(list);
    currentPricingList = list;
    renderPricingTable(currentPricingList);

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--danger); padding:1rem;">Failed to load pricing: ${err.message}</td></tr>`;
  }
}

function renderPricingTable(list) {
  const tbody = document.getElementById("pricingTableBody");

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color:var(--text-muted);">No pricing rules configured. Click "Add New Price Rule" above.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map((item, idx) => `
    <tr>
      <td>
        <span class="badge ${getRoomBadgeClass(item.room)}" style="font-size:0.78rem;">
          ${formatRoom(item.room)}
        </span>
      </td>
      <td>
        <strong>${formatCategory(item.category)}</strong>
      </td>
      <td>
        <span style="font-weight:600; color:#1e293b;">${escapeHtml(item.name)}</span>
        <br><small style="color:var(--text-muted); font-family:monospace; font-size:0.75rem;">Key: ${escapeHtml(item.key)}</small>
      </td>
      <td>
        ${escapeHtml((item.unit || "per_hour").replace("_", " "))}
      </td>
      <td>
        £ <input type="number" step="0.50" min="0" class="price-input" data-index="${idx}" data-key="${item.key}" value="${parseFloat(item.price).toFixed(2)}">
      </td>
      <td style="text-align:center;">
        <button type="button" class="btn btn-outline btn-sm" style="color:#b91c1c; border-color:#fecaca; padding:0.25rem 0.55rem; font-size:0.75rem;" onclick="removePricingRow(${idx})">✕</button>
      </td>
    </tr>
  `).join("");
}

function removePricingRow(idx) {
  const item = currentPricingList[idx];
  if (!confirm(`Delete price rule "${item.name}"?`)) return;
  currentPricingList.splice(idx, 1);
  sortPricingList(currentPricingList);
  renderPricingTable(currentPricingList);
}

async function savePricing() {
  const notice = document.getElementById("pricingNotice");
  const saveBtn = document.getElementById("savePricesBtn");
  const inputs = document.querySelectorAll(".price-input");

  // Update rates from inputs
  inputs.forEach(inp => {
    const idx = parseInt(inp.getAttribute("data-index"), 10);
    if (!isNaN(idx) && currentPricingList[idx]) {
      currentPricingList[idx].price = parseFloat(inp.value) || 0.0;
    }
  });

  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const res = await fetch("/api/pricing", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ pricing: currentPricingList })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      notice.className = "alert alert-success";
      notice.textContent = "Pricing configuration successfully updated! All new public inquiries will use these rates.";
      notice.style.display = "block";
      setTimeout(() => { notice.style.display = "none"; }, 4000);
    } else {
      throw new Error(data.error || "Failed to update pricing");
    }
  } catch (err) {
    notice.className = "alert alert-error";
    notice.textContent = "Error saving prices: " + err.message;
    notice.style.display = "block";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Save Price Changes";
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
    entire_venue: "Entire Complex",
    stage_av: "Stage & AV System",
    kitchen_commercial: "Commercial Kitchen",
    deposit: "Security Deposit"
  };
  return map[room] || room;
}

function getRoomBadgeClass(room) {
  const map = {
    main_hall: "badge-main",
    small_hall: "badge-small",
    committee_room: "badge-committee",
    entire_venue: "badge-amber",
    stage_av: "badge-amber",
    kitchen_commercial: "badge-committee",
    deposit: "badge-small"
  };
  return map[room] || "badge-blue";
}

function formatCategory(cat) {
  const map = {
    all: "Standard / All Categories",
    private_party: "Children / Family Party",
    wedding_reception: "Wedding Reception",
    fitness_class: "Class / Fitness / Regular",
    theatrical_performance: "Stage / Drama / Show",
    meeting_conference: "Meeting / Corporate",
    other: "Other Community"
  };
  return map[cat] || cat;
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
