// Monthly Calendar Viewer with Room Filters & 1-Click Booking
let calCurrentDate = new Date();
let calCurrentRoom = "0"; // 0 = All Rooms
let cachedMonthEvents = [];

document.addEventListener("DOMContentLoaded", () => {
  const prevBtn = document.getElementById("calPrevMonth");
  const nextBtn = document.getElementById("calNextMonth");
  const todayBtn = document.getElementById("calToday");
  const roomTabs = document.querySelectorAll(".filter-tab");

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

  // Initialize Room Card Carousel image rotators
  initRoomGalleries();
});

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

  // Calculate start of month grid (Monday start)
  const firstDayOfMonth = new Date(year, month, 1);
  const lastDayOfMonth = new Date(year, month + 1, 0);

  // Fetch events for this month range directly from Hallmaster or backend
  const startDateStr = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const endDateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDayOfMonth.getDate()).padStart(2, "0")}`;

  const hmRoomId = calCurrentRoom; // "0", "15520", "15521", "15522"
  const hmUrl = `https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?start=${startDateStr}T00:00:00Z&end=${endDateStr}T23:59:59Z&roomId=${hmRoomId}&custView=false&HallId=10954&groupRooms=false`;

  try {
    // 1. Try direct Hallmaster query first
    const hmRes = await fetch(hmUrl, {
      headers: {
        "X-Requested-With": "XMLHttpRequest"
      }
    });

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
  } catch (err) {
    // 2. Fallback to /api/bookings proxy
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

  // Build grid
  tbody.innerHTML = "";
  let dateCursor = new Date(firstDayOfMonth);
  // Shift to previous Monday if month doesn't start on Monday
  let dayOfWeek = dateCursor.getDay(); // 0 is Sunday
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

      // Room name parameter for booking link
      const roomSlug = getRoomSlug(calCurrentRoom);

      // Header row inside day cell
      const headerDiv = document.createElement("div");
      headerDiv.className = "day-header";
      headerDiv.innerHTML = `
        <span class="day-number">${dDate}</span>
        <a href="/booking.html?date=${dStr}${roomSlug ? `&room=${roomSlug}` : ''}" class="day-book-btn" title="Make a booking on this date">+ Book</a>
      `;
      td.appendChild(headerDiv);

      // Events container
      const eventsContainer = document.createElement("div");
      eventsContainer.className = "events-container";

      // Filter events matching this day
      const dayEvents = cachedMonthEvents.filter(ev => {
        // Can be date exact or recurring
        return ev.start_date === dStr || ev.event_date === dStr || (ev.start_time && !ev.start_date);
      });

      dayEvents.forEach(ev => {
        const pill = document.createElement("div");
        const rClass = getEventRoomClass(ev.room_id || calCurrentRoom);
        pill.className = `event-pill ${rClass}`;
        const title = ev.title || "Booked";
        const times = `${ev.start_time || ''} - ${ev.end_time || ''}`;
        pill.textContent = `${times} ${title}`;
        pill.title = `${title} (${times})`;
        eventsContainer.appendChild(pill);
      });

      td.appendChild(eventsContainer);
      tr.appendChild(td);

      dateCursor.setDate(dateCursor.getDate() + 1);
    }

    tbody.appendChild(tr);

    // Stop early if we passed the month
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

function getEventRoomClass(roomId) {
  if (roomId === "15520" || roomId === "main_hall") return "event-main";
  if (roomId === "15521" || roomId === "small_hall") return "event-small";
  if (roomId === "15522" || roomId === "committee_room") return "event-committee";
  return "event-main";
}

// Multi-image gallery carousel for room cards
function initRoomGalleries() {
  const galleries = document.querySelectorAll(".room-gallery");

  galleries.forEach(gallery => {
    const images = gallery.querySelectorAll("img");
    const counter = gallery.querySelector(".photo-counter");
    const dotsContainer = gallery.querySelector(".gallery-dots");
    const prevBtn = gallery.querySelector(".gallery-prev");
    const nextBtn = gallery.querySelector(".gallery-next");

    if (images.length <= 1) return;

    let currentIndex = 0;

    // Create dots
    dotsContainer.innerHTML = "";
    images.forEach((_, idx) => {
      const dot = document.createElement("div");
      dot.className = `gallery-dot ${idx === 0 ? "active" : ""}`;
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        goToSlide(idx);
      });
      dotsContainer.appendChild(dot);
    });

    function update() {
      images.forEach((img, idx) => {
        img.classList.toggle("active", idx === currentIndex);
      });
      dotsContainer.querySelectorAll(".gallery-dot").forEach((d, idx) => {
        d.classList.toggle("active", idx === currentIndex);
      });
      if (counter) counter.textContent = `${currentIndex + 1} / ${images.length}`;
    }

    function goToSlide(idx) {
      currentIndex = idx;
      update();
    }

    if (prevBtn) {
      prevBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex - 1 + images.length) % images.length;
        update();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        currentIndex = (currentIndex + 1) % images.length;
        update();
      });
    }

    // Initialize first
    update();
  });
}
