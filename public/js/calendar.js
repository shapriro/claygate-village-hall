// Monthly Calendar Viewer with Room Filters, Scale Magnifier Slider & Interactive Popups
let calCurrentDate = new Date();
let calCurrentRoom = "0"; // 0 = All Rooms
let cachedMonthEvents = [];

document.addEventListener("DOMContentLoaded", () => {
  const prevBtn = document.getElementById("calPrevMonth");
  const nextBtn = document.getElementById("calNextMonth");
  const todayBtn = document.getElementById("calToday");
  const roomTabs = document.querySelectorAll(".filter-tab");

  // Scale Magnifier & View Density Controls
  const fontSlider = document.getElementById("fontSlider");
  const scaleBadge = document.getElementById("scaleValBadge");
  const cellCompactBtn = document.getElementById("cellCompactBtn");
  const cellStandardBtn = document.getElementById("cellStandardBtn");
  const cellExpandedBtn = document.getElementById("cellExpandedBtn");

  // Modal elements
  const modalBackdrop = document.getElementById("eventModalBackdrop");
  const modalCloseBtn = document.getElementById("modalCloseBtn");
  const modalOkBtn = document.getElementById("modalOkBtn");

  if (fontSlider) {
    fontSlider.addEventListener("input", (e) => {
      const val = e.target.value;
      document.documentElement.style.setProperty("--cal-font-size", `${val}px`);
      scaleBadge.textContent = `${val}px`;
    });
  }

  if (cellCompactBtn && cellStandardBtn && cellExpandedBtn) {
    cellCompactBtn.addEventListener("click", () => {
      setCellHeight("100px");
      toggleDensityButtons(cellCompactBtn);
    });
    cellStandardBtn.addEventListener("click", () => {
      setCellHeight("145px");
      toggleDensityButtons(cellStandardBtn);
    });
    cellExpandedBtn.addEventListener("click", () => {
      setCellHeight("200px");
      toggleDensityButtons(cellExpandedBtn);
    });
  }

  function setCellHeight(h) {
    document.documentElement.style.setProperty("--cal-cell-height", h);
  }

  function toggleDensityButtons(activeBtn) {
    [cellCompactBtn, cellStandardBtn, cellExpandedBtn].forEach(b => {
      b.className = "btn btn-outline btn-sm";
      b.style.padding = "0.2rem 0.55rem";
      b.style.fontSize = "0.75rem";
    });
    activeBtn.className = "btn btn-primary btn-sm";
    activeBtn.style.padding = "0.2rem 0.55rem";
    activeBtn.style.fontSize = "0.75rem";
  }

  // Close modal listeners
  if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeModal);
  if (modalOkBtn) modalOkBtn.addEventListener("click", closeModal);
  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) closeModal();
    });
  }

  if (prevBtn && nextBtn) {
    prevBtn.addEventListener("click", () => {
      calCurrentDate.setMonth(calCurrentDate.getMonth() - 1);
      renderMonthlyCalendar();
    });

    nextBtn.addEventListener("click", () => {
      calCurrentDate.setMonth(calCurrentDate.getMonth() + 1);
      renderMonthlyCalendar();
    });

    todayBtn.addEventListener("click", () => {
      calCurrentDate = new Date();
      renderMonthlyCalendar();
    });

    roomTabs.forEach(tab => {
      tab.addEventListener("click", () => {
        roomTabs.forEach(t => t.className = "filter-tab");
        const r = tab.getAttribute("data-room");
        calCurrentRoom = r;

        if (r === "0") tab.classList.add("active-all");
        else if (r === "15520") tab.classList.add("active-main");
        else if (r === "15521") tab.classList.add("active-small");
        else if (r === "15522") tab.classList.add("active-committee");

        renderMonthlyCalendar();
      });
    });

    renderMonthlyCalendar();
  }
});

function openModal(ev) {
  const modalBackdrop = document.getElementById("eventModalBackdrop");
  const modalHeader = document.getElementById("modalHeader");
  const modalTitle = document.getElementById("modalTitle");
  const modalRoom = document.getElementById("modalRoom");
  const modalDate = document.getElementById("modalDate");
  const modalHours = document.getElementById("modalHours");
  const modalBookSameDayBtn = document.getElementById("modalBookSameDayBtn");

  const roomName = getRoomName(ev.room_id);
  const color = ev.color || (ev.room_id === "15520" ? "#b30c35" : (ev.room_id === "15521" ? "#0284c7" : "#15803d"));

  modalHeader.style.background = color;
  modalTitle.textContent = ev.title || "Private Reservation";
  modalRoom.textContent = roomName;
  modalDate.textContent = ev.start_date || "Confirmed Date";
  modalHours.textContent = `${ev.start_time || '09:00'} - ${ev.end_time || '17:00'}`;
  modalBookSameDayBtn.href = `/booking.html?date=${ev.start_date}&room=${getRoomSlug(ev.room_id)}`;

  modalBackdrop.classList.add("active");
}

function closeModal() {
  const modalBackdrop = document.getElementById("eventModalBackdrop");
  if (modalBackdrop) modalBackdrop.classList.remove("active");
}

async function renderMonthlyCalendar() {
  const monthTitle = document.getElementById("calMonthTitle");
  const tbody = document.getElementById("calendarBody");

  const year = calCurrentDate.getFullYear();
  const month = calCurrentDate.getMonth();

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  monthTitle.textContent = `${monthNames[month]} ${year}`;
  tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 2rem; color:var(--text-muted);">Syncing live availability with Hallmaster...</td></tr>`;

  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  const startDateStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDayOfMonth.getDate()).padStart(2, "0")}`;

  const hmRoomId = calCurrentRoom;
  const hmUrl = `https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?start=${startDateStr}T00:00:00Z&end=${endDateStr}T23:59:59Z&roomId=${hmRoomId}&custView=false&HallId=10954&groupRooms=false`;

  try {
    const hmRes = await fetch(hmUrl, { headers: { "X-Requested-With": "XMLHttpRequest" } });
    if (hmRes.ok) {
      const hmList = await hmRes.json();
      cachedMonthEvents = hmList.map(b => {
        const sParts = b.start.split("T");
        const eParts = b.end.split("T");
        return {
          start_date: sParts[0],
          start_time: sParts[1]?.substring(0, 5) || "08:00",
          end_time: eParts[1]?.substring(0, 5) || "23:00",
          status: "confirmed",
          title: b.title || "Private Booking",
          room_id: b.roomId ? String(b.roomId) : (b.color === "#b30c35" ? "15520" : (b.color === "#0284c7" || b.color === "#428bca" ? "15521" : "15522")),
          color: b.color
        };
      });
    } else {
      throw new Error("Direct query fallback");
    }
  } catch {
    try {
      const res = await fetch(`/api/bookings?availability=1&date=${startDateStr}&monthEnd=${endDateStr}&room=${mapRoomCode(calCurrentRoom)}`);
      if (res.ok) {
        const data = await res.json();
        cachedMonthEvents = data.bookedSlots || [];
      } else {
        cachedMonthEvents = [];
      }
    } catch {
      cachedMonthEvents = [];
    }
  }

  tbody.innerHTML = "";
  let dateCursor = new Date(firstDayOfMonth);
  let dayOfWeek = dateCursor.getDay();
  let diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
  dateCursor.setDate(dateCursor.getDate() + diff);

  const todayStr = new Date().toISOString().split("T")[0];

  for (let row = 0; row < 6; row++) {
    const tr = document.createElement("tr");

    for (let col = 0; col < 7; col++) {
      const td = document.createElement("td");
      const dYear = dateCursor.getFullYear();
      const dMonth = dateCursor.getMonth();
      const dDate = dateCursor.getDate();
      const dStr = `${dYear}-${String(dMonth + 1).padStart(2, "0")}-${String(dDate).padStart(2, "0")}`;

      const isCurrentMonth = (dMonth === month);
      const isToday = (dStr === todayStr);

      if (!isCurrentMonth) td.classList.add("other-month");
      if (isToday) td.classList.add("today");

      const roomSlug = getRoomSlug(calCurrentRoom);

      const headerDiv = document.createElement("div");
      headerDiv.className = "day-header";
      headerDiv.innerHTML = `
        <span class="day-number">${dDate}</span>
        <a href="/booking.html?date=${dStr}${roomSlug ? `&room=${roomSlug}` : ''}" class="day-book-btn" title="Reserve this date">+ Book</a>
      `;
      td.appendChild(headerDiv);

      const eventsContainer = document.createElement("div");
      eventsContainer.className = "events-container";

      const dayEvents = cachedMonthEvents.filter(ev => {
        return ev.start_date === dStr || ev.event_date === dStr;
      });

      dayEvents.forEach(ev => {
        const pill = document.createElement("div");
        const rClass = getEventRoomClass(ev.room_id || calCurrentRoom);
        pill.className = `event-pill ${rClass}`;
        
        // If specific color exists, apply directly
        if (ev.color) {
          pill.style.backgroundColor = ev.color;
        }

        const title = ev.title || "Private Booking";
        const times = `${ev.start_time || ''} - ${ev.end_time || ''}`;
        
        // Formatted with line break for clarity
        pill.innerHTML = `<strong>${times}</strong><br><span style="opacity:0.95;">${title}</span>`;
        pill.title = `${title} (${times}) - Click for details`;

        // Interactive modal click
        pill.addEventListener("click", () => openModal(ev));

        eventsContainer.appendChild(pill);
      });

      td.appendChild(eventsContainer);
      tr.appendChild(td);

      dateCursor.setDate(dateCursor.getDate() + 1);
    }

    tbody.appendChild(tr);

    if (dateCursor.getMonth() !== month && row >= 4) {
      break;
    }
  }
}

function mapRoomCode(code) {
  if (code === "15520") return "main_hall";
  if (code === "15521") return "small_hall";
  if (code === "15522") return "committee_room";
  return "entire_venue";
}

function getRoomSlug(code) {
  if (code === "15520") return "main_hall";
  if (code === "15521") return "small_hall";
  if (code === "15522") return "committee_room";
  return "";
}

function getRoomName(code) {
  if (code === "15520" || code === "main_hall") return "Main Hall";
  if (code === "15521" || code === "small_hall") return "Small Hall";
  if (code === "15522" || code === "committee_room") return "Committee Room / Dressing Room";
  return "All Rooms (Complex)";
}

function getEventRoomClass(roomId) {
  if (roomId === "15520" || roomId === "main_hall") return "event-main";
  if (roomId === "15521" || roomId === "small_hall") return "event-small";
  if (roomId === "15522" || roomId === "committee_room") return "event-committee";
  return "event-main";
}
