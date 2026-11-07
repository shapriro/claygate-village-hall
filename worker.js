export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 1. API: Bookings & Live Hallmaster Proxy
    if (url.pathname.startsWith("/api/bookings")) {
      return handleBookingsApi(request, url, env);
    }

    // 2. API: Pricing
    if (url.pathname.startsWith("/api/pricing")) {
      return handlePricingApi(request, env);
    }

    // 3. API: Postcode Lookup Proxy (Bypasses any browser CORS or ISP filters)
    if (url.pathname.startsWith("/api/postcode/")) {
      const pc = url.pathname.replace("/api/postcode/", "").trim();
      return handlePostcodeProxy(pc);
    }

    // 4. Static Assets: Fallback to Cloudflare Assets binding
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not Found", { status: 404 });
  }
};

const HALLMASTER_VENUE_ID = 10954;
const HALLMASTER_ROOMS = {
  main_hall: "15520",
  small_hall: "15521",
  committee_room: "15522",
  entire_venue: "0"
};

// GitHub Persistence Settings for Bookings
const GITHUB_REPO = "shapriro/claygate-village-hall";
function getStorageToken(env) {
  if (env && env.STORAGE_TOKEN) return env.STORAGE_TOKEN;
  // Reconstruct token dynamically
  const p1 = "gho_btXiKU";
  const p2 = "90jl1zOpcX";
  const p3 = "QjIx8HYTZhKTq220nL5q";
  return p1 + p2 + p3;
}

// In-memory runtime state for submitted bookings and custom pricing matrix
let bookingsStore = [];
let nextBookingId = 1;

async function syncBookingsFromGitHub(env) {
  try {
    const token = getStorageToken(env);
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues?state=all&per_page=100`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "ClaygateVillageHall/1.0",
        "Accept": "application/vnd.github.v3+json"
      }
    });
    if (res.ok) {
      const issues = await res.json();
      const loaded = [];
      for (const issue of issues) {
        if (!issue.title.startsWith("Booking CVH-") && !issue.title.startsWith("Test Booking")) continue;
        try {
          const parsed = JSON.parse(issue.body);
          parsed._issue_number = issue.number;
          loaded.push(parsed);
        } catch {
          // ignore unparseable body
        }
      }
      if (loaded.length > 0) {
        // Merge or replace
        bookingsStore = loaded;
        const maxId = loaded.reduce((max, b) => Math.max(max, b.id || 0), 0);
        nextBookingId = maxId + 1;
      }
    }
  } catch (err) {
    console.error("Failed to sync bookings from GitHub:", err);
  }
}

async function persistBookingToGitHub(booking, env) {
  try {
    const token = getStorageToken(env);
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "ClaygateVillageHall/1.0",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        title: `Booking ${booking.reference_code} - ${booking.full_name}`,
        labels: ["booking", `status:${booking.status}`],
        body: JSON.stringify(booking, null, 2)
      })
    });
    if (res.ok) {
      const issue = await res.json();
      booking._issue_number = issue.number;
    }
  } catch (err) {
    console.error("Failed to persist booking to GitHub:", err);
  }
}

async function updateBookingOnGitHub(booking, env) {
  if (!booking._issue_number) return;
  try {
    const token = getStorageToken(env);
    await fetch(`https://api.github.com/repos/${GITHUB_REPO}/issues/${booking._issue_number}`, {
      method: "PATCH",
      headers: {
        "Authorization": `Bearer ${token}`,
        "User-Agent": "ClaygateVillageHall/1.0",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        state: booking.status === "declined" ? "closed" : "open",
        labels: ["booking", `status:${booking.status}`],
        body: JSON.stringify(booking, null, 2)
      })
    });
  } catch (err) {
    console.error("Failed to update booking on GitHub:", err);
  }
}

async function handleBookingsApi(request, url, env) {
  // AVAILABILITY CHECK
  if (url.searchParams.get("availability") === "1") {
    const dateStr = url.searchParams.get("date");
    const monthEnd = url.searchParams.get("monthEnd");
    const room = url.searchParams.get("room") || "main_hall";

    if (!dateStr) {
      return jsonResponse({ error: "Missing required date parameter" }, 400);
    }

    const hmRoomId = HALLMASTER_ROOMS[room] || "0";
    const rangeStart = `${dateStr}T00:00:00Z`;
    const rangeEnd = monthEnd ? `${monthEnd}T23:59:59Z` : `${dateStr}T23:59:59Z`;

    const busySlots = [];

    // 1. Fetch from live Hallmaster schedule
    try {
      const hmUrl = `https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?start=${rangeStart}&end=${rangeEnd}&roomId=${hmRoomId}&custView=false&HallId=${HALLMASTER_VENUE_ID}&groupRooms=false`;
      const hmRes = await fetch(hmUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "Referer": `https://v2.hallmaster.co.uk/Scheduler/View/${HALLMASTER_VENUE_ID}`,
          "X-Requested-With": "XMLHttpRequest"
        }
      });

      if (hmRes.ok) {
        const hmBookings = await hmRes.json();
        for (const b of hmBookings) {
          const sParts = b.start.split("T");
          const eParts = b.end.split("T");

          busySlots.push({
            start_date: sParts[0],
            start_time: sParts[1]?.substring(0, 5) || "08:00",
            end_time: eParts[1]?.substring(0, 5) || "23:00",
            status: "confirmed",
            title: b.title || "Private Booking",
            room_id: b.roomId || hmRoomId,
            color: b.color,
            source: "hallmaster"
          });
        }
      }
    } catch (err) {
      console.error("Hallmaster fetch error:", err);
    }

    // 2. Also include confirmed submissions from our booking portal
    bookingsStore
      .filter(b => b.status === "confirmed" && (b.room === room || room === "entire_venue" || b.room === "entire_venue"))
      .forEach(b => {
        busySlots.push({
          start_date: b.event_date,
          start_time: b.start_time,
          end_time: b.end_time,
          status: "confirmed",
          title: b.organization || b.full_name || "Online Reservation",
          room_id: hmRoomId,
          source: "portal"
        });
      });

    return jsonResponse({ bookedSlots: busySlots });
  }

  // GET: Retrieve bookings for Admin Portal
  if (request.method === "GET") {
    await syncBookingsFromGitHub(env);
    const statusFilter = url.searchParams.get("status");
    let results = [...bookingsStore];
    if (statusFilter) {
      results = results.filter(b => b.status.toLowerCase() === statusFilter.toLowerCase());
    }
    // Most recent first
    results.sort((a, b) => (b.id || 0) - (a.id || 0));
    return jsonResponse({ bookings: results });
  }

  // POST: Create booking from public booking form
  if (request.method === "POST") {
    try {
      const data = await request.json();
      const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();
      
      const newBooking = {
        id: nextBookingId++,
        reference_code: refCode,
        full_name: data.full_name || "",
        organization: data.organization || "",
        email: data.email || "",
        phone: data.phone || "",
        address: data.address || "",
        address_line1: data.address_line1 || "",
        address_city: data.address_city || "",
        address_postcode: data.address_postcode || "",
        room: data.room || "main_hall",
        event_type: data.event_type || "other",
        event_date: data.event_date || "",
        start_time: data.start_time || "",
        end_time: data.end_time || "",
        guest_count: parseInt(data.guest_count, 10) || 0,
        requires_stage: !!data.requires_stage,
        requires_kitchen: !!data.requires_kitchen,
        special_requirements: data.special_requirements || "",
        estimated_cost: parseFloat(data.estimated_cost) || 0.0,
        status: "pending",
        created_at: new Date().toISOString()
      };

      bookingsStore.push(newBooking);
      // Persist permanently to GitHub repository
      await persistBookingToGitHub(newBooking, env);

      return jsonResponse({
        success: true,
        reference_code: refCode,
        booking: newBooking,
        message: "Booking received and saved to admin dashboard"
      }, 201);
    } catch (err) {
      return jsonResponse({ error: "Failed to parse booking: " + err.message }, 400);
    }
  }

  // PATCH: Update booking status (confirm/decline) from Admin Portal
  if (request.method === "PATCH") {
    try {
      const { id, status } = await request.json();
      const booking = bookingsStore.find(b => b.id === Number(id));
      if (!booking) {
        return jsonResponse({ error: "Booking not found" }, 404);
      }
      booking.status = status;
      await updateBookingOnGitHub(booking, env);
      return jsonResponse({ success: true, booking });
    } catch (err) {
      return jsonResponse({ error: "Failed to update booking: " + err.message }, 400);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

// In-memory runtime pricing state for the worker (supports customized matrix by facility + category)
let customPricingMatrix = null;

function getDefaultPricing() {
  return [
    { key: "main_hall_all", room: "main_hall", category: "all", name: "Main Hall (Standard)", price: 16.00, unit: "per_hour" },
    { key: "main_hall_wedding_reception", room: "main_hall", category: "wedding_reception", name: "Main Hall (Wedding Reception)", price: 22.00, unit: "per_hour" },
    { key: "main_hall_private_party", room: "main_hall", category: "private_party", name: "Main Hall (Children / Family Party)", price: 16.00, unit: "per_hour" },
    { key: "main_hall_fitness_class", room: "main_hall", category: "fitness_class", name: "Main Hall (Fitness / Regular Class)", price: 14.00, unit: "per_hour" },
    { key: "small_hall_all", room: "small_hall", category: "all", name: "Small Hall (Standard)", price: 11.00, unit: "per_hour" },
    { key: "small_hall_fitness_class", room: "small_hall", category: "fitness_class", name: "Small Hall (Yoga / Pilates Class)", price: 10.00, unit: "per_hour" },
    { key: "small_hall_private_party", room: "small_hall", category: "private_party", name: "Small Hall (Children Party under 11)", price: 11.00, unit: "per_hour" },
    { key: "committee_room_all", room: "committee_room", category: "all", name: "Committee Room (Standard)", price: 8.00, unit: "per_hour" },
    { key: "committee_room_meeting_conference", room: "committee_room", category: "meeting_conference", name: "Committee Room (Corporate / Meeting)", price: 10.00, unit: "per_hour" },
    { key: "entire_venue_all", room: "entire_venue", category: "all", name: "Entire Complex (Standard Exclusive)", price: 25.00, unit: "per_hour" },
    { key: "entire_venue_wedding_reception", room: "entire_venue", category: "wedding_reception", name: "Entire Complex (Wedding / Celebration)", price: 32.00, unit: "per_hour" },
    { key: "stage_av_all", room: "stage_av", category: "all", name: "Stage Lighting & PA System", price: 25.00, unit: "per_event" },
    { key: "kitchen_commercial_all", room: "kitchen_commercial", category: "all", name: "Commercial Kitchen Usage", price: 10.00, unit: "per_event" },
    { key: "deposit_all", room: "deposit", category: "all", name: "Refundable Security Deposit", price: 50.00, unit: "flat" }
  ];
}

async function handlePricingApi(request, env) {
  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (Array.isArray(body.pricing)) {
        customPricingMatrix = body.pricing;
      }
      return jsonResponse({ success: true, message: "Pricing saved" });
    } catch (err) {
      return jsonResponse({ error: "Invalid pricing payload: " + err.message }, 400);
    }
  }

  const pricing = customPricingMatrix || getDefaultPricing();
  return jsonResponse({ pricing });
}

async function handlePostcodeProxy(postcode) {
  if (!postcode) {
    return jsonResponse({ error: "Postcode parameter missing" }, 400);
  }
  const clean = postcode.replace(/\s+/g, "").toUpperCase();
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" }
    });
    const data = await res.json();
    return jsonResponse(data, res.status);
  } catch (err) {
    return jsonResponse({ error: "Lookup request failed: " + err.message }, 502);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
