// Admin Dashboard Logic: Bookings, Pricing, Documents Hub, Users RBAC & Audit History
let token = sessionStorage.getItem("cvh_admin_token") || "";
let currentUser = null;
let currentPricingList = [];
let loadedBookings = [];
let loadedDocuments = [];
let loadedAdminUsers = [];

try {
  const cachedUser = sessionStorage.getItem("cvh_admin_user");
  if (cachedUser) currentUser = JSON.parse(cachedUser);
} catch (e) {
  currentUser = null;
}

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

  // User management elements
  const toggleAddUserBtn = document.getElementById("toggleAddUserBtn");
  const addUserCard = document.getElementById("addUserCard");
  const adminUserForm = document.getElementById("adminUserForm");
  const cancelUserFormBtn = document.getElementById("cancelUserFormBtn");
  const refreshAuditBtn = document.getElementById("refreshAuditBtn");

  // Document Hub elements
  const toggleUploadDocBtn = document.getElementById("toggleUploadDocBtn");
  const uploadDocCard = document.getElementById("uploadDocCard");
  const uploadDocForm = document.getElementById("uploadDocForm");
  const cancelUploadDocBtn = document.getElementById("cancelUploadDocBtn");
  const refreshDocsBtn = document.getElementById("refreshDocsBtn");
  const docCategoryFilter = document.getElementById("docCategoryFilter");

  // Password reset & change password elements
  const forgotPasswordLink = document.getElementById("forgotPasswordLink");
  const forgotPasswordModal = document.getElementById("forgotPasswordModal");
  const closeForgotModalBtn = document.getElementById("closeForgotModalBtn");
  const cancelResetBtn = document.getElementById("cancelResetBtn");
  const tokenResetForm = document.getElementById("tokenResetForm");
  const openChangePasswordBtn = document.getElementById("openChangePasswordBtn");
  const changePasswordModal = document.getElementById("changePasswordModal");
  const closeChangePasswordBtn = document.getElementById("closeChangePasswordBtn");
  const cancelChangePasswordBtn = document.getElementById("cancelChangePasswordBtn");
  const changePasswordForm = document.getElementById("changePasswordForm");

  // Check URL query parameters for ?reset_token=xyz
  const urlParams = new URLSearchParams(window.location.search);
  const resetTokenParam = urlParams.get("reset_token");
  if (resetTokenParam && forgotPasswordModal) {
    document.getElementById("resetTokenInput").value = resetTokenParam;
    forgotPasswordModal.style.display = "flex";
  }

  // Tab switching
  const tabBtns = document.querySelectorAll(".admin-tab-btn");
  tabBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      tabBtns.forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".admin-tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      const target = document.getElementById(targetId);
      if (target) target.classList.add("active");

      // Auto load tab data
      if (targetId === "tab-documents") loadDocuments();
      if (targetId === "tab-users") loadAdminUsers();
      if (targetId === "tab-audit") loadAuditLog();
    });
  });

  if (token) {
    showDashboard();
  }

  // Handle Login form
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const loginAlert = document.getElementById("loginAlert");
    loginAlert.style.display = "none";

    const username = document.getElementById("adminUsername").value.trim();
    const password = document.getElementById("adminPassword").value;
    if (!username || !password) return;

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        loginAlert.textContent = data.error || "Invalid username or password";
        loginAlert.style.display = "block";
        return;
      }

      token = data.token;
      currentUser = data.user;
      sessionStorage.setItem("cvh_admin_token", token);
      sessionStorage.setItem("cvh_admin_user", JSON.stringify(currentUser));
      showDashboard();
    } catch (err) {
      loginAlert.textContent = "Sign in error: " + err.message;
      loginAlert.style.display = "block";
    }
  });

  logoutBtn.addEventListener("click", () => {
    sessionStorage.removeItem("cvh_admin_token");
    sessionStorage.removeItem("cvh_admin_user");
    token = "";
    currentUser = null;
    loginCard.style.display = "block";
    dashboardSection.style.display = "none";
    logoutBtn.style.display = "none";
    document.getElementById("userBadgeItem").style.display = "none";
  });

  refreshBtn.addEventListener("click", () => { loadBookings(); loadPricing(); });
  filterStatus.addEventListener("change", () => loadBookings());
  savePricesBtn.addEventListener("click", () => savePricing());

  if (refreshAuditBtn) {
    refreshAuditBtn.addEventListener("click", () => loadAuditLog());
  }

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

      const key = `${room}_${category}`;
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

      sortPricingList(currentPricingList);
      renderPricingTable(currentPricingList);

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

  // User management triggers
  if (toggleAddUserBtn) {
    toggleAddUserBtn.addEventListener("click", () => {
      resetUserForm();
      const isHidden = addUserCard.style.display === "none";
      addUserCard.style.display = isHidden ? "block" : "none";
      toggleAddUserBtn.textContent = isHidden ? "✕ Close Form" : "➕ Add New Admin User";
    });
  }

  if (cancelUserFormBtn) {
    cancelUserFormBtn.addEventListener("click", () => {
      resetUserForm();
      addUserCard.style.display = "none";
      if (toggleAddUserBtn) toggleAddUserBtn.textContent = "➕ Add New Admin User";
    });
  }

  if (adminUserForm) {
    adminUserForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleSaveAdminUser();
    });
  }

  // Pre-fill permissions when selecting role preset
  const roleSelect = document.getElementById("newAdminRole");
  if (roleSelect) {
    roleSelect.addEventListener("change", () => {
      applyRolePreset(roleSelect.value);
    });
  }

  // Documents triggers
  if (toggleUploadDocBtn) {
    toggleUploadDocBtn.addEventListener("click", () => {
      const isHidden = uploadDocCard.style.display === "none";
      uploadDocCard.style.display = isHidden ? "block" : "none";
      toggleUploadDocBtn.textContent = isHidden ? "✕ Close Upload" : "📤 Upload Document";
    });
  }

  if (cancelUploadDocBtn) {
    cancelUploadDocBtn.addEventListener("click", () => {
      uploadDocCard.style.display = "none";
      if (toggleUploadDocBtn) toggleUploadDocBtn.textContent = "📤 Upload Document";
    });
  }

  if (refreshDocsBtn) {
    refreshDocsBtn.addEventListener("click", () => loadDocuments());
  }

  if (docCategoryFilter) {
    docCategoryFilter.addEventListener("change", () => renderDocumentsTable());
  }

  if (uploadDocForm) {
    uploadDocForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      await handleUploadDocument();
    });
  }

  // Forgot Password Modal Triggers
  if (forgotPasswordLink) {
    forgotPasswordLink.addEventListener("click", (e) => {
      e.preventDefault();
      forgotPasswordModal.style.display = "flex";
    });
  }
  if (closeForgotModalBtn) {
    closeForgotModalBtn.addEventListener("click", () => { forgotPasswordModal.style.display = "none"; });
  }
  if (cancelResetBtn) {
    cancelResetBtn.addEventListener("click", () => { forgotPasswordModal.style.display = "none"; });
  }

  if (tokenResetForm) {
    tokenResetForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const tokenVal = document.getElementById("resetTokenInput").value.trim();
      const pw1 = document.getElementById("resetNewPassword").value;
      const pw2 = document.getElementById("resetConfirmPassword").value;
      const alertBox = document.getElementById("resetAlert");
      alertBox.style.display = "none";

      if (pw1 !== pw2) {
        alertBox.textContent = "Passwords do not match.";
        alertBox.style.display = "block";
        return;
      }

      try {
        const res = await fetch("/api/auth/reset-password", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: tokenVal, newPassword: pw1 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Reset failed");

        alert("Success: " + data.message);
        forgotPasswordModal.style.display = "none";
        tokenResetForm.reset();
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.style.display = "block";
      }
    });
  }

  // Change Password Modal Triggers
  if (openChangePasswordBtn) {
    openChangePasswordBtn.addEventListener("click", () => {
      openChangePasswordModal(false);
    });
  }
  if (closeChangePasswordBtn) {
    closeChangePasswordBtn.addEventListener("click", () => { changePasswordModal.style.display = "none"; });
  }
  if (cancelChangePasswordBtn) {
    cancelChangePasswordBtn.addEventListener("click", () => { changePasswordModal.style.display = "none"; });
  }

  if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const oldPw = document.getElementById("currentPassword").value;
      const pw1 = document.getElementById("newPasswordInput").value;
      const pw2 = document.getElementById("confirmNewPasswordInput").value;
      const alertBox = document.getElementById("changePasswordAlert");
      alertBox.style.display = "none";

      if (pw1 !== pw2) {
        alertBox.textContent = "New passwords do not match.";
        alertBox.style.display = "block";
        return;
      }

      const saveBtn = document.getElementById("saveNewPasswordBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Updating...";

      try {
        const res = await fetch("/api/auth/change-password", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ oldPassword: oldPw, newPassword: pw1 })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to update password");

        alert("Your password has been updated successfully!");
        changePasswordModal.style.display = "none";
        changePasswordForm.reset();

        if (currentUser) {
          currentUser.must_change_password = false;
          sessionStorage.setItem("cvh_admin_user", JSON.stringify(currentUser));
        }
      } catch (err) {
        alertBox.textContent = err.message;
        alertBox.style.display = "block";
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Update Password";
      }
    });
  }
});

function openChangePasswordModal(isForcedFirstLogin = false) {
  const modal = document.getElementById("changePasswordModal");
  const firstNotice = document.getElementById("firstLoginNotice");
  const oldGroup = document.getElementById("oldPasswordGroup");
  const oldInput = document.getElementById("currentPassword");

  if (isForcedFirstLogin) {
    firstNotice.style.display = "block";
    oldGroup.style.display = "none";
    oldInput.required = false;
  } else {
    firstNotice.style.display = "none";
    oldGroup.style.display = "block";
    oldInput.required = true;
  }

  modal.style.display = "flex";
}

function applyRolePreset(role) {
  const rBook = document.getElementById("permReadBookings");
  const wBook = document.getElementById("permWriteBookings");
  const rPrice = document.getElementById("permReadPricing");
  const wPrice = document.getElementById("permWritePricing");
  const rDoc = document.getElementById("permReadDocuments");
  const wDoc = document.getElementById("permUploadDocuments");
  const mUser = document.getElementById("permManageUsers");
  const vAudit = document.getElementById("permViewAudit");

  if (role === "admin") {
    rBook.checked = true; wBook.checked = true;
    rPrice.checked = true; wPrice.checked = true;
    rDoc.checked = true; wDoc.checked = true;
    mUser.checked = true; vAudit.checked = true;
  } else if (role === "manager") {
    rBook.checked = true; wBook.checked = true;
    rPrice.checked = true; wPrice.checked = false;
    rDoc.checked = true; wDoc.checked = true;
    mUser.checked = false; vAudit.checked = true;
  } else if (role === "accountant") {
    rBook.checked = true; wBook.checked = false;
    rPrice.checked = true; wPrice.checked = true;
    rDoc.checked = true; wDoc.checked = true;
    mUser.checked = false; vAudit.checked = true;
  } else if (role === "auditor") {
    rBook.checked = true; wBook.checked = false;
    rPrice.checked = true; wPrice.checked = false;
    rDoc.checked = true; wDoc.checked = false;
    mUser.checked = false; vAudit.checked = true;
  } else if (role === "staff") {
    rBook.checked = true; wBook.checked = true;
    rPrice.checked = true; wPrice.checked = false;
    rDoc.checked = true; wDoc.checked = false;
    mUser.checked = false; vAudit.checked = false;
  }
}

async function showDashboard() {
  document.getElementById("loginCard").style.display = "none";
  document.getElementById("dashboardSection").style.display = "block";
  document.getElementById("logoutBtn").style.display = "inline-block";

  // Verify/refresh user profile from server
  try {
    const res = await fetch("/api/auth/me", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      sessionStorage.setItem("cvh_admin_user", JSON.stringify(currentUser));
    }
  } catch (e) {
    // continue with cached currentUser
  }

  // Update header badge
  if (currentUser) {
    const badgeItem = document.getElementById("userBadgeItem");
    const displaySpan = document.getElementById("loggedInUserDisplay");
    badgeItem.style.display = "flex";
    displaySpan.textContent = `👤 ${currentUser.name} (${currentUser.role || 'Admin'})`;

    // Apply RBAC UI gating
    applyRBACUI(currentUser);

    // If first login password change is required, pop modal immediately
    if (currentUser.must_change_password) {
      openChangePasswordModal(true);
    }
  }

  // Load initial tab data
  if (!currentUser || currentUser.can_read_bookings) {
    await loadBookings();
  }
  if (!currentUser || currentUser.can_read_pricing) {
    await loadPricing();
  }
}

function applyRBACUI(user) {
  if (!user) return;

  // Bookings Tab
  const navBookings = document.getElementById("navTabBookings");
  if (navBookings) navBookings.style.display = user.can_read_bookings ? "inline-block" : "none";

  // Pricing Tab
  const navPricing = document.getElementById("navTabPricing");
  if (navPricing) navPricing.style.display = user.can_read_pricing ? "inline-block" : "none";

  const savePricesBtn = document.getElementById("savePricesBtn");
  const toggleAddPriceBtn = document.getElementById("toggleAddPriceBtn");
  if (savePricesBtn) savePricesBtn.style.display = user.can_write_pricing ? "inline-block" : "none";
  if (toggleAddPriceBtn) toggleAddPriceBtn.style.display = user.can_write_pricing ? "inline-block" : "none";

  // Documents Tab
  const navDocuments = document.getElementById("navTabDocuments");
  if (navDocuments) navDocuments.style.display = user.can_read_documents ? "inline-block" : "none";

  const toggleUploadDocBtn = document.getElementById("toggleUploadDocBtn");
  if (toggleUploadDocBtn) toggleUploadDocBtn.style.display = (user.can_upload_documents || user.can_manage_users) ? "inline-block" : "none";

  // Users Tab
  const navUsers = document.getElementById("navTabUsers");
  if (navUsers) navUsers.style.display = user.can_manage_users ? "inline-block" : "none";

  // Audit Tab
  const navAudit = document.getElementById("navTabAudit");
  if (navAudit) navAudit.style.display = user.can_view_audit ? "inline-block" : "none";
}

// ----------------------------------------------------
// Bookings Logic
// ----------------------------------------------------

async function loadBookings() {
  const tbody = document.getElementById("bookingsTableBody");
  const filter = document.getElementById("filterStatus").value;

  tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 2rem;">Loading bookings...</td></tr>`;

  try {
    const url = `/api/bookings${filter ? `?status=${filter}` : ""}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    const data = await res.json();

    if (!res.ok) {
      if (res.status === 401) {
        sessionStorage.removeItem("cvh_admin_token");
        alert("Session expired or unauthorized. Please log in again.");
        location.reload();
        return;
      }
      throw new Error(data.error || "Failed to load bookings");
    }

    const bookings = data.bookings || [];
    loadedBookings = bookings;
    if (bookings.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">No booking requests found. New submissions from the booking form will appear here automatically.</td></tr>`;
      return;
    }

    const canWrite = !currentUser || currentUser.can_write_bookings;

    tbody.innerHTML = bookings.map(b => {
      let addrText = b.address || "";
      if (!addrText && (b.address_line1 || b.address_city || b.address_postcode)) {
        addrText = [b.address_line1, b.address_city, b.address_postcode].filter(Boolean).join(", ");
      }

      const actionsHtml = canWrite ? `
        <div style="display:flex; flex-direction:column; gap:0.35rem;">
          <button class="btn btn-sm btn-outline" style="padding:0.25rem 0.6rem; font-size:0.78rem;" onclick="openEditBookingModal(${b.id})">✏️ Edit</button>
          ${b.status !== 'confirmed' ? `<button class="btn btn-sm btn-primary" style="padding:0.25rem 0.6rem; font-size:0.78rem;" onclick="updateStatus(${b.id}, 'confirmed')">Confirm</button>` : ''}
          ${b.status !== 'pending' ? `<button class="btn btn-sm btn-outline" style="padding:0.25rem 0.6rem; font-size:0.78rem; color:#b45309; border-color:#fde68a;" onclick="updateStatus(${b.id}, 'pending')">Mark Pending</button>` : ''}
          ${b.status !== 'declined' ? `<button class="btn btn-sm btn-outline" style="padding:0.25rem 0.6rem; font-size:0.78rem; color:#b91c1c; border-color:#fecaca;" onclick="updateStatus(${b.id}, 'declined')">Decline</button>` : ''}
        </div>
      ` : `<span style="color:var(--text-muted); font-size:0.8rem;">Read-only</span>`;

      return `
      <tr>
        <td>
          <strong style="color:var(--primary); font-family:monospace; font-size:0.95rem;">${escapeHtml(b.reference_code)}</strong>
          <br><small style="color:var(--text-muted); font-size:0.75rem;">${b.created_at ? new Date(b.created_at).toLocaleDateString("en-GB") : ""}</small>
        </td>
        <td>
          <strong style="white-space:nowrap;">${escapeHtml(b.event_date)}</strong><br>
          <small style="color:var(--text-muted); font-weight:600; white-space:nowrap;">${escapeHtml(b.start_time)} - ${escapeHtml(b.end_time)}</small>
        </td>
        <td>
          <strong>${escapeHtml(b.full_name)}</strong>
          ${b.organization ? `<br><small style="color:#0369a1; font-weight:600;">Org: ${escapeHtml(b.organization)}</small>` : ""}
        </td>
        <td style="max-width: 220px; font-size:0.85rem;">
          <div><a href="mailto:${escapeHtml(b.email)}" style="color:var(--primary);">${escapeHtml(b.email)}</a></div>
          <div><a href="tel:${escapeHtml(b.phone)}" style="color:#334155; font-weight:600;">${escapeHtml(b.phone)}</a></div>
          ${addrText ? `<small style="color:var(--text-muted); display:block; margin-top:2px;">📍 ${escapeHtml(addrText)}</small>` : ""}
        </td>
        <td>
          <span class="badge ${getRoomBadgeClass(b.room)}" style="font-size:0.75rem; margin-bottom:0.25rem;">
            ${formatRoom(b.room)}
          </span>
          <br><strong style="font-size:0.85rem; color:#1e293b;">${formatCategory(b.event_type)}</strong>
        </td>
        <td style="text-align:center; font-weight:600;">
          ${b.guest_count || "-"}
        </td>
        <td style="text-align:center;">
          ${b.requires_stage ? '<span class="badge badge-amber" style="font-size:0.72rem; margin:0;">Yes</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">No</span>'}
        </td>
        <td style="text-align:center;">
          ${b.requires_kitchen ? '<span class="badge badge-green" style="font-size:0.72rem; margin:0;">Yes</span>' : '<span style="color:var(--text-muted); font-size:0.8rem;">No</span>'}
        </td>
        <td style="max-width: 180px; font-size:0.82rem; color:#475569;">
          ${b.special_requirements ? escapeHtml(b.special_requirements) : '<span style="color:#94a3b8;">None</span>'}
        </td>
        <td>
          <strong style="color:#166534; font-size:1.05rem;">£${(parseFloat(b.estimated_cost) || 0.0).toFixed(2)}</strong>
        </td>
        <td>
          <span class="status-tag status-${b.status.toLowerCase()}">${escapeHtml(b.status)}</span>
        </td>
        <td>${actionsHtml}</td>
      </tr>
      `;
    }).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 2rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

async function updateStatus(id, newStatus) {
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
    if (!res.ok) throw new Error(data.error || "Failed to update status");

    const notice = document.getElementById("statusNotice");
    notice.className = "alert alert-success";
    notice.textContent = `Booking #${id} status successfully updated to "${newStatus}".`;
    notice.style.display = "block";
    setTimeout(() => { notice.style.display = "none"; }, 4000);

    loadBookings();
  } catch (err) {
    alert("Error updating status: " + err.message);
  }
}

// ----------------------------------------------------
// Pricing Matrix Logic
// ----------------------------------------------------

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

    sortPricingList(list);
    currentPricingList = list;
    renderPricingTable(list);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 1.5rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function renderPricingTable(list) {
  const tbody = document.getElementById("pricingTableBody");
  const canWrite = !currentUser || currentUser.can_write_pricing;

  tbody.innerHTML = list.map((item) => {
    const isPerEvent = item.unit === "per_event";
    const isFlat = item.unit === "flat";
    const unitLabel = isPerEvent ? "Per Event" : isFlat ? "Flat Deposit" : "Per Hour";

    return `
    <tr data-key="${escapeHtml(item.key)}">
      <td>
        <span class="badge ${getRoomBadgeClass(item.room)}" style="font-size:0.8rem;">${formatRoom(item.room)}</span>
      </td>
      <td>
        <strong style="color:#1e293b; font-size:0.9rem;">${formatCategory(item.category)}</strong>
      </td>
      <td>
        ${canWrite ? `
          <input type="text" class="form-control" style="font-size:0.88rem; padding:0.35rem 0.6rem;" 
            value="${escapeHtml(item.name)}" 
            onchange="updatePricingField('${item.key}', 'name', this.value)">
        ` : `<span>${escapeHtml(item.name)}</span>`}
      </td>
      <td>
        ${canWrite ? `
          <select class="form-control" style="font-size:0.85rem; padding:0.35rem 0.5rem;" 
            onchange="updatePricingField('${item.key}', 'unit', this.value)">
            <option value="per_hour" ${item.unit === 'per_hour' ? 'selected' : ''}>Per Hour</option>
            <option value="per_event" ${item.unit === 'per_event' ? 'selected' : ''}>Per Event</option>
            <option value="flat" ${item.unit === 'flat' ? 'selected' : ''}>Flat Deposit</option>
          </select>
        ` : `<span>${unitLabel}</span>`}
      </td>
      <td>
        ${canWrite ? `
          <div style="display:flex; align-items:center; gap:0.25rem;">
            <span style="font-weight:700;">£</span>
            <input type="number" step="0.50" min="0" class="form-control" 
              style="width: 95px; font-weight:700; font-size:0.95rem; color:#166534;" 
              value="${(parseFloat(item.price) || 0).toFixed(2)}" 
              onchange="updatePricingField('${item.key}', 'price', parseFloat(this.value) || 0)">
          </div>
        ` : `<strong style="color:#166534;">£${(parseFloat(item.price) || 0).toFixed(2)}</strong>`}
      </td>
      <td style="text-align:center;">
        ${canWrite ? `
          <button type="button" class="btn btn-outline btn-sm" style="color:var(--danger); border-color:#fecaca; padding:0.2rem 0.5rem;" 
            onclick="removePricingRule('${item.key}')" title="Delete rule">✕</button>
        ` : `<span style="color:var(--text-muted);">-</span>`}
      </td>
    </tr>
    `;
  }).join("");
}

window.updatePricingField = function(key, field, val) {
  const item = currentPricingList.find(p => p.key === key);
  if (item) item[field] = val;
};

window.removePricingRule = function(key) {
  if (!confirm(`Delete pricing rule for ${key}?`)) return;
  currentPricingList = currentPricingList.filter(p => p.key !== key);
  renderPricingTable(currentPricingList);
};

async function savePricing() {
  const notice = document.getElementById("pricingNotice");
  const saveBtn = document.getElementById("savePricesBtn");
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
    if (!res.ok) throw new Error(data.error || "Failed to save prices");

    notice.className = "alert alert-success";
    notice.textContent = "Pricing configuration successfully saved and published!";
    notice.style.display = "block";
    setTimeout(() => { notice.style.display = "none"; }, 4000);
  } catch (err) {
    notice.className = "alert alert-error";
    notice.textContent = "Save failed: " + err.message;
    notice.style.display = "block";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "💾 Save Price Changes";
  }
}

// ----------------------------------------------------
// Tab: Document Hub (Internal Committee Repository)
// ----------------------------------------------------

async function loadDocuments() {
  const tbody = document.getElementById("documentsTableBody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">Loading documents...</td></tr>`;

  try {
    const res = await fetch("/api/documents", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load documents");

    loadedDocuments = data.documents || [];
    renderDocumentsTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function renderDocumentsTable() {
  const tbody = document.getElementById("documentsTableBody");
  const filterCat = document.getElementById("docCategoryFilter")?.value || "";

  let docs = [...loadedDocuments];
  if (filterCat) {
    docs = docs.filter(d => d.category === filterCat);
  }

  if (docs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">No documents found in this category. Upload committee files using the button above.</td></tr>`;
    return;
  }

  const canUpload = currentUser?.can_upload_documents || currentUser?.can_manage_users;

  tbody.innerHTML = docs.map(d => {
    const sizeKB = (d.file_size / 1024).toFixed(1);
    const dateStr = d.created_at ? new Date(d.created_at).toLocaleDateString("en-GB") : "-";

    return `
    <tr>
      <td>
        <strong style="color:var(--primary); font-size:0.95rem;">${escapeHtml(d.title)}</strong>
        <div style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</div>
      </td>
      <td>
        <span class="badge ${getDocumentCategoryBadgeClass(d.category)}">${escapeHtml(d.category)}</span>
      </td>
      <td style="font-family:monospace; font-size:0.85rem; color:#475569;">
        ${escapeHtml(d.filename)}
      </td>
      <td style="font-size:0.85rem; color:#64748b;">${sizeKB} KB</td>
      <td><span style="font-size:0.85rem; color:#1e293b; font-weight:600;">${escapeHtml(d.uploaded_by)}</span></td>
      <td style="text-align:center;">
        <div style="display:flex; gap:0.4rem; justify-content:center;">
          <a class="btn btn-sm btn-primary" style="padding:0.25rem 0.6rem; font-size:0.75rem; text-decoration:none;" 
             href="/api/documents?id=${d.id}&download=1" target="_blank" download>⬇️ Download</a>
          ${canUpload ? `
            <button class="btn btn-sm btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:#b91c1c; border-color:#fecaca;" 
              onclick="deleteDocument(${d.id}, '${escapeHtml(d.filename)}')">🗑️</button>
          ` : ''}
        </div>
      </td>
    </tr>
    `;
  }).join("");
}

function getDocumentCategoryBadgeClass(category) {
  const map = {
    Minutes: "badge-blue",
    Finance: "badge-green",
    Policies: "badge-amber",
    Agreements: "badge-committee",
    Licensing: "badge-main",
    Maintenance: "badge-small"
  };
  return map[category] || "badge-blue";
}

async function handleUploadDocument() {
  const title = document.getElementById("docTitle").value.trim();
  const category = document.getElementById("docCategory").value;
  const fileInput = document.getElementById("docFileInput");
  const file = fileInput.files[0];
  if (!file) return alert("Please select a file to upload.");

  if (file.size > 10 * 1024 * 1024) {
    return alert("File is too large. Maximum supported size is 10MB.");
  }

  const submitBtn = document.getElementById("submitUploadDocBtn");
  submitBtn.disabled = true;
  submitBtn.textContent = "Uploading...";

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const base64Data = reader.result.split(",")[1];
      const payload = {
        title,
        category,
        filename: file.name,
        mime_type: file.type || "application/octet-stream",
        file_size: file.size,
        file_data: base64Data
      };

      const res = await fetch("/api/documents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      const notice = document.getElementById("docNotice");
      notice.className = "alert alert-success";
      notice.textContent = data.message || `File "${file.name}" uploaded successfully!`;
      notice.style.display = "block";
      setTimeout(() => { notice.style.display = "none"; }, 4000);

      document.getElementById("uploadDocForm").reset();
      document.getElementById("uploadDocCard").style.display = "none";
      document.getElementById("toggleUploadDocBtn").textContent = "📤 Upload Document";

      await loadDocuments();
    } catch (err) {
      alert("Upload error: " + err.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Upload Document";
    }
  };
  reader.readAsDataURL(file);
}

window.deleteDocument = async function(docId, filename) {
  if (!confirm(`Are you sure you want to delete "${filename}"?`)) return;

  try {
    const res = await fetch("/api/documents", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id: docId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");

    await loadDocuments();
  } catch (err) {
    alert("Delete error: " + err.message);
  }
};

// ----------------------------------------------------
// Tab 3: Admin Users & RBAC Management
// ----------------------------------------------------

async function loadAdminUsers() {
  const tbody = document.getElementById("usersTableBody");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem;">Loading admin users...</td></tr>`;

  try {
    const res = await fetch("/api/admin-users", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load users");

    const users = data.users || [];
    loadedAdminUsers = users;

    if (users.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--text-muted);">No users found.</td></tr>`;
      return;
    }

    tbody.innerHTML = users.map(u => {
      const perms = [];
      if (u.can_read_bookings) perms.push('<span class="badge badge-blue">Read Bookings</span>');
      if (u.can_write_bookings) perms.push('<span class="badge badge-green">Edit Bookings</span>');
      if (u.can_read_pricing) perms.push('<span class="badge badge-blue">Read Pricing</span>');
      if (u.can_write_pricing) perms.push('<span class="badge badge-amber">Edit Pricing</span>');
      if (u.can_read_documents) perms.push('<span class="badge badge-blue">Read Docs</span>');
      if (u.can_upload_documents) perms.push('<span class="badge badge-green">Upload Docs</span>');
      if (u.can_manage_users) perms.push('<span class="badge badge-committee">Manage Users</span>');
      if (u.can_view_audit) perms.push('<span class="badge badge-small">View Audit</span>');

      if (u.must_change_password) {
        perms.push('<span class="badge badge-amber" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a;">Pending 1st Login Pwd</span>');
      }

      const isPrimary = u.username === "admin";

      return `
      <tr>
        <td>
          <strong style="color:var(--primary); font-size:0.95rem;">${escapeHtml(u.username)}</strong>
          <div style="font-size:0.85rem; color:#475569;">${escapeHtml(u.name)}</div>
        </td>
        <td>
          <a href="mailto:${escapeHtml(u.email || '')}" style="color:var(--text-dark);">${escapeHtml(u.email || '-')}</a>
        </td>
        <td>
          <span class="badge ${u.role === 'super_admin' || u.role === 'admin' ? 'badge-main' : 'badge-amber'}" style="font-size:0.75rem;">
            ${escapeHtml(u.role)}
          </span>
        </td>
        <td>
          <div style="display:flex; flex-wrap:wrap; gap:0.3rem;">
            ${perms.join("")}
          </div>
        </td>
        <td style="text-align:center;">
          <div style="display:flex; gap:0.35rem; justify-content:center; flex-wrap:wrap;">
            <button class="btn btn-sm btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem;" onclick="openEditUserForm(${u.id})">✏️ Edit</button>
            <button class="btn btn-sm btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:#0369a1; border-color:#bae6fd;" onclick="generateUserResetLink(${u.id}, '${escapeHtml(u.username)}')" title="Generate one-time reset link">🔗 Reset</button>
            ${!isPrimary ? `
              <button class="btn btn-sm btn-outline" style="padding:0.25rem 0.5rem; font-size:0.75rem; color:#b91c1c; border-color:#fecaca;" onclick="deleteAdminUser(${u.id}, '${escapeHtml(u.username)}')">🗑️</button>
            ` : ''}
          </div>
        </td>
      </tr>
      `;
    }).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 2rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function resetUserForm() {
  document.getElementById("manageUserId").value = "";
  document.getElementById("userFormTitle").textContent = "➕ Add New Admin User";
  document.getElementById("newAdminUsername").value = "";
  document.getElementById("newAdminUsername").disabled = false;
  document.getElementById("newAdminName").value = "";
  document.getElementById("newAdminEmail").value = "";
  document.getElementById("newAdminPassword").value = "";
  document.getElementById("newAdminPassword").required = true;
  document.getElementById("pwdOptionalNotice").textContent = "(Required for new users)";
  document.getElementById("newAdminRole").value = "staff";

  document.getElementById("permReadBookings").checked = true;
  document.getElementById("permWriteBookings").checked = true;
  document.getElementById("permReadPricing").checked = true;
  document.getElementById("permWritePricing").checked = false;
  document.getElementById("permReadDocuments").checked = true;
  document.getElementById("permUploadDocuments").checked = false;
  document.getElementById("permManageUsers").checked = false;
  document.getElementById("permViewAudit").checked = true;
  document.getElementById("permMustChangePassword").checked = true;
}

window.openEditUserForm = function(userId) {
  const user = loadedAdminUsers.find(u => u.id === userId);
  if (!user) return;

  const card = document.getElementById("addUserCard");
  const toggleBtn = document.getElementById("toggleAddUserBtn");
  card.style.display = "block";
  toggleBtn.textContent = "✕ Close Form";

  document.getElementById("manageUserId").value = user.id;
  document.getElementById("userFormTitle").textContent = `✏️ Edit Admin User: ${user.username}`;
  document.getElementById("newAdminUsername").value = user.username;
  document.getElementById("newAdminUsername").disabled = true;
  document.getElementById("newAdminName").value = user.name || "";
  document.getElementById("newAdminEmail").value = user.email || "";
  document.getElementById("newAdminPassword").value = "";
  document.getElementById("newAdminPassword").required = false;
  document.getElementById("pwdOptionalNotice").textContent = "(Leave blank to keep existing password)";
  document.getElementById("newAdminRole").value = user.role || "staff";

  document.getElementById("permReadBookings").checked = !!user.can_read_bookings;
  document.getElementById("permWriteBookings").checked = !!user.can_write_bookings;
  document.getElementById("permReadPricing").checked = !!user.can_read_pricing;
  document.getElementById("permWritePricing").checked = !!user.can_write_pricing;
  document.getElementById("permReadDocuments").checked = !!user.can_read_documents;
  document.getElementById("permUploadDocuments").checked = !!user.can_upload_documents;
  document.getElementById("permManageUsers").checked = !!user.can_manage_users;
  document.getElementById("permViewAudit").checked = !!user.can_view_audit;
  document.getElementById("permMustChangePassword").checked = !!user.must_change_password;

  card.scrollIntoView({ behavior: "smooth" });
};

async function handleSaveAdminUser() {
  const id = document.getElementById("manageUserId").value;
  const username = document.getElementById("newAdminUsername").value.trim();
  const name = document.getElementById("newAdminName").value.trim();
  const email = document.getElementById("newAdminEmail").value.trim();
  const password = document.getElementById("newAdminPassword").value;
  const role = document.getElementById("newAdminRole").value;

  const payload = {
    username,
    name,
    email,
    password,
    role,
    can_read_bookings: document.getElementById("permReadBookings").checked,
    can_write_bookings: document.getElementById("permWriteBookings").checked,
    can_read_pricing: document.getElementById("permReadPricing").checked,
    can_write_pricing: document.getElementById("permWritePricing").checked,
    can_read_documents: document.getElementById("permReadDocuments").checked,
    can_upload_documents: document.getElementById("permUploadDocuments").checked,
    can_manage_users: document.getElementById("permManageUsers").checked,
    can_view_audit: document.getElementById("permViewAudit").checked,
    must_change_password: document.getElementById("permMustChangePassword").checked
  };

  const isEdit = Boolean(id);
  if (isEdit) payload.id = Number(id);

  const saveBtn = document.getElementById("saveUserBtn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving...";

  try {
    const res = await fetch("/api/admin-users", {
      method: isEdit ? "PUT" : "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save user failed");

    const notice = document.getElementById("userNotice");
    notice.className = "alert alert-success";
    notice.textContent = data.message || `User ${username} saved successfully!`;
    notice.style.display = "block";
    setTimeout(() => { notice.style.display = "none"; }, 4000);

    resetUserForm();
    document.getElementById("addUserCard").style.display = "none";
    document.getElementById("toggleAddUserBtn").textContent = "➕ Add New Admin User";
    await loadAdminUsers();
  } catch (err) {
    alert("Error: " + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save Admin User";
  }
}

window.generateUserResetLink = async function(userId, username) {
  try {
    const res = await fetch("/api/admin-users", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id: userId, action: "generate_reset" })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to generate reset link");

    const fullUrl = `${window.location.origin}/admin?reset_token=${data.reset_token}`;
    prompt(`Single-use 24-hour Password Reset Link for ${username}:\n(Copy and send to user)`, fullUrl);
    await loadAdminUsers();
  } catch (err) {
    alert("Error: " + err.message);
  }
};

window.deleteAdminUser = async function(userId, username) {
  if (!confirm(`Are you sure you want to delete admin account "${username}"?`)) return;

  try {
    const res = await fetch("/api/admin-users", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ id: userId })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");

    const notice = document.getElementById("userNotice");
    notice.className = "alert alert-success";
    notice.textContent = `User ${username} deleted successfully.`;
    notice.style.display = "block";
    setTimeout(() => { notice.style.display = "none"; }, 3500);

    await loadAdminUsers();
  } catch (err) {
    alert("Error deleting user: " + err.message);
  }
};

// ----------------------------------------------------
// Tab 4: Audit History Log
// ----------------------------------------------------

async function loadAuditLog() {
  const tbody = document.getElementById("auditTableBody");
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem;">Loading audit trail...</td></tr>`;

  try {
    const res = await fetch("/api/audit-log", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load audit history");

    const logs = data.logs || [];
    if (logs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2.5rem; color: var(--text-muted);">No activity recorded yet. System changes and user logins will be logged here.</td></tr>`;
      return;
    }

    tbody.innerHTML = logs.map(l => {
      const dateFormatted = l.timestamp ? new Date(l.timestamp).toLocaleString("en-GB") : "-";
      return `
      <tr>
        <td style="font-size:0.8rem; color:#475569; white-space:nowrap;">${dateFormatted}</td>
        <td><strong style="color:var(--primary); font-size:0.88rem;">${escapeHtml(l.user_name)}</strong></td>
        <td>
          <span class="badge ${getAuditActionBadgeClass(l.action)}" style="font-size:0.75rem;">
            ${escapeHtml(l.action)}
          </span>
        </td>
        <td style="font-family:monospace; font-size:0.85rem;">${escapeHtml(l.target_id || '-')}</td>
        <td style="font-size:0.85rem; color:#334155;">${escapeHtml(l.details)}</td>
        <td style="font-family:monospace; font-size:0.75rem; color:#64748b;">${escapeHtml(l.ip)}</td>
      </tr>
      `;
    }).join("");

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--danger);">${err.message}</td></tr>`;
  }
}

function getAuditActionBadgeClass(action) {
  if (!action) return "badge-blue";
  if (action.includes("LOGIN")) return "badge-committee";
  if (action.includes("CONFIRM")) return "badge-green";
  if (action.includes("DELETE")) return "badge-red";
  if (action.includes("STATUS")) return "badge-amber";
  if (action.includes("PRICING")) return "badge-amber";
  if (action.includes("USER")) return "badge-main";
  if (action.includes("PASSWORD")) return "badge-amber";
  if (action.includes("DOCUMENT")) return "badge-green";
  return "badge-blue";
}

// ----------------------------------------------------
// Formatting & Helpers
// ----------------------------------------------------

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

// ----------------------------------------------------
// Modal handling for Editing Bookings
// ----------------------------------------------------

function openEditBookingModal(bookingId) {
  const booking = loadedBookings.find(b => b.id === bookingId);
  if (!booking) return;

  document.getElementById("editBookingId").value = booking.id;
  document.getElementById("editModalTitle").textContent = `✏️ Edit Booking: ${booking.reference_code}`;
  document.getElementById("editFullName").value = booking.full_name || "";
  document.getElementById("editOrganization").value = booking.organization || "";
  document.getElementById("editEmail").value = booking.email || "";
  document.getElementById("editPhone").value = booking.phone || "";
  document.getElementById("editAddressLine1").value = booking.address_line1 || "";
  document.getElementById("editAddressCity").value = booking.address_city || "";
  document.getElementById("editAddressPostcode").value = booking.address_postcode || "";
  document.getElementById("editRoom").value = booking.room || "main_hall";
  document.getElementById("editEventType").value = booking.event_type || "other";
  document.getElementById("editEventDate").value = booking.event_date || "";
  document.getElementById("editGuestCount").value = booking.guest_count || "";
  document.getElementById("editStartTime").value = booking.start_time || "";
  document.getElementById("editEndTime").value = booking.end_time || "";
  document.getElementById("editEstimatedCost").value = parseFloat(booking.estimated_cost) || 0;
  document.getElementById("editStatus").value = booking.status || "pending";
  document.getElementById("editRequiresStage").checked = !!booking.requires_stage;
  document.getElementById("editRequiresKitchen").checked = !!booking.requires_kitchen;
  document.getElementById("editSpecialRequirements").value = booking.special_requirements || "";

  document.getElementById("editBookingModal").style.display = "flex";
}

function closeEditBookingModal() {
  const modal = document.getElementById("editBookingModal");
  if (modal) modal.style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  const closeBtn = document.getElementById("closeEditModalBtn");
  const cancelBtn = document.getElementById("cancelEditBtn");
  const editForm = document.getElementById("editBookingForm");
  const deleteBtn = document.getElementById("deleteBookingBtn");

  if (closeBtn) closeBtn.addEventListener("click", closeEditBookingModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeEditBookingModal);

  const modal = document.getElementById("editBookingModal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeEditBookingModal();
    });
  }

  // Handle Edit Save
  if (editForm) {
    editForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = Number(document.getElementById("editBookingId").value);
      if (!id) return;

      const l1 = document.getElementById("editAddressLine1").value.trim();
      const city = document.getElementById("editAddressCity").value.trim();
      const pc = document.getElementById("editAddressPostcode").value.trim();
      const fullAddr = [l1, city, pc].filter(Boolean).join(", ");

      const payload = {
        id,
        full_name: document.getElementById("editFullName").value.trim(),
        organization: document.getElementById("editOrganization").value.trim(),
        email: document.getElementById("editEmail").value.trim(),
        phone: document.getElementById("editPhone").value.trim(),
        address: fullAddr,
        address_line1: l1,
        address_city: city,
        address_postcode: pc,
        room: document.getElementById("editRoom").value,
        event_type: document.getElementById("editEventType").value,
        event_date: document.getElementById("editEventDate").value,
        guest_count: parseInt(document.getElementById("editGuestCount").value, 10) || 0,
        start_time: document.getElementById("editStartTime").value,
        end_time: document.getElementById("editEndTime").value,
        estimated_cost: parseFloat(document.getElementById("editEstimatedCost").value) || 0,
        status: document.getElementById("editStatus").value,
        requires_stage: document.getElementById("editRequiresStage").checked,
        requires_kitchen: document.getElementById("editRequiresKitchen").checked,
        special_requirements: document.getElementById("editSpecialRequirements").value.trim()
      };

      const saveBtn = document.getElementById("saveBookingChangesBtn");
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      try {
        const res = await fetch("/api/bookings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok && data.success) {
          closeEditBookingModal();
          await loadBookings();
        } else {
          alert("Error updating booking: " + (data.error || "Unknown error"));
        }
      } catch (err) {
        alert("Network error: " + err.message);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save Changes";
      }
    });
  }

  // Handle Delete
  if (deleteBtn) {
    deleteBtn.addEventListener("click", async () => {
      const id = Number(document.getElementById("editBookingId").value);
      if (!id) return;
      if (!confirm(`Are you sure you want to permanently delete booking #${id}? This cannot be undone.`)) return;

      deleteBtn.disabled = true;
      deleteBtn.textContent = "Deleting...";

      try {
        const res = await fetch("/api/bookings", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          closeEditBookingModal();
          await loadBookings();
        } else {
          alert("Error deleting booking: " + (data.error || "Unknown error"));
        }
      } catch (err) {
        alert("Network error: " + err.message);
      } finally {
        deleteBtn.disabled = false;
        deleteBtn.textContent = "Delete Booking";
      }
    });
  }
});
