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

// Database helper: Initialize D1 tables if they don't exist yet
let d1Initialized = false;

async function ensureD1Tables(db) {
  if (d1Initialized || !db) return;
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_code TEXT UNIQUE,
        full_name TEXT,
        organization TEXT,
        email TEXT,
        phone TEXT,
        address TEXT,
        address_line1 TEXT,
        address_city TEXT,
        address_postcode TEXT,
        room TEXT,
        event_type TEXT,
        event_date TEXT,
        start_time TEXT,
        end_time TEXT,
        guest_count INTEGER,
        requires_stage INTEGER,
        requires_kitchen INTEGER,
        special_requirements TEXT,
        estimated_cost REAL,
        status TEXT DEFAULT 'pending',
        created_at TEXT
      );

      CREATE TABLE IF NOT EXISTS pricing (
        key TEXT PRIMARY KEY,
        room TEXT,
        category TEXT,
        name TEXT,
        price REAL,
        unit TEXT
      );
    `);
    d1Initialized = true;
  } catch (err) {
    console.error("D1 schema init error:", err);
  }
}

// In-memory fallback if DB binding is not yet attached
let bookingsStore = [];
let nextBookingId = 1;

async function handleBookingsApi(request, url, env) {
  const db = env.DB || env.cvh_db;
  if (db) {
    await ensureD1Tables(db);
  }

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

    // 2. Also include confirmed submissions from our booking database
    if (db) {
      try {
        const { results } = await db.prepare(
          `SELECT * FROM bookings WHERE status = 'confirmed' AND (room = ? OR ? = 'entire_venue' OR room = 'entire_venue')`
        ).bind(room, room).all();
        (results || []).forEach(b => {
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
      } catch (err) {
        console.error("D1 availability query error:", err);
      }
    } else {
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
    }

    return jsonResponse({ bookedSlots: busySlots });
  }

  // GET: Retrieve bookings for Admin Portal
  if (request.method === "GET") {
    const statusFilter = url.searchParams.get("status");

    if (db) {
      try {
        let query = `SELECT * FROM bookings`;
        const params = [];
        if (statusFilter) {
          query += ` WHERE LOWER(status) = LOWER(?)`;
          params.push(statusFilter);
        }
        query += ` ORDER BY id DESC`;
        const stmt = params.length ? db.prepare(query).bind(...params) : db.prepare(query);
        const { results } = await stmt.all();
        // Format boolean flags for UI
        const formatted = (results || []).map(b => ({
          ...b,
          requires_stage: !!b.requires_stage,
          requires_kitchen: !!b.requires_kitchen
        }));
        return jsonResponse({ bookings: formatted });
      } catch (err) {
        console.error("D1 select error:", err);
      }
    }

    // Fallback
    let results = [...bookingsStore];
    if (statusFilter) {
      results = results.filter(b => b.status.toLowerCase() === statusFilter.toLowerCase());
    }
    results.sort((a, b) => (b.id || 0) - (a.id || 0));
    return jsonResponse({ bookings: results });
  }

  // POST: Create booking from public booking form
  if (request.method === "POST") {
    try {
      const data = await request.json();
      const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();
      const createdAt = new Date().toISOString();

      if (db) {
        const stmt = db.prepare(`
          INSERT INTO bookings (
            reference_code, full_name, organization, email, phone,
            address, address_line1, address_city, address_postcode,
            room, event_type, event_date, start_time, end_time,
            guest_count, requires_stage, requires_kitchen,
            special_requirements, estimated_cost, status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const res = await stmt.bind(
          refCode,
          data.full_name || "",
          data.organization || "",
          data.email || "",
          data.phone || "",
          data.address || "",
          data.address_line1 || "",
          data.address_city || "",
          data.address_postcode || "",
          data.room || "main_hall",
          data.event_type || "other",
          data.event_date || "",
          data.start_time || "",
          data.end_time || "",
          parseInt(data.guest_count, 10) || 0,
          data.requires_stage ? 1 : 0,
          data.requires_kitchen ? 1 : 0,
          data.special_requirements || "",
          parseFloat(data.estimated_cost) || 0.0,
          "pending",
          createdAt
        ).run();

        const createdBooking = {
          id: res.meta?.last_row_id || 1,
          reference_code: refCode,
          ...data,
          status: "pending",
          created_at: createdAt
        };

        return jsonResponse({
          success: true,
          reference_code: refCode,
          booking: createdBooking,
          message: "Booking received and saved securely to Cloudflare D1"
        }, 201);
      }

      // Memory fallback
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
        created_at: createdAt
      };
      bookingsStore.push(newBooking);

      return jsonResponse({
        success: true,
        reference_code: refCode,
        booking: newBooking,
        message: "Booking received and saved"
      }, 201);
    } catch (err) {
      return jsonResponse({ error: "Failed to parse booking: " + err.message }, 400);
    }
  }

  // PATCH: Update booking status (confirm/decline) from Admin Portal
  if (request.method === "PATCH") {
    try {
      const { id, status } = await request.json();
      if (db) {
        await db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(status, Number(id)).run();
        return jsonResponse({ success: true, id, status });
      }

      const booking = bookingsStore.find(b => b.id === Number(id));
      if (!booking) {
        return jsonResponse({ error: "Booking not found" }, 404);
      }
      booking.status = status;
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
  const db = env.DB || env.cvh_db;
  if (db) {
    await ensureD1Tables(db);
  }

  if (request.method === "POST") {
    try {
      const body = await request.json();
      if (Array.isArray(body.pricing)) {
        if (db) {
          const insertStmt = db.prepare(`
            INSERT OR REPLACE INTO pricing (key, room, category, name, price, unit)
            VALUES (?, ?, ?, ?, ?, ?)
          `);
          const batch = body.pricing.map(p =>
            insertStmt.bind(p.key, p.room, p.category, p.name, parseFloat(p.price) || 0, p.unit)
          );
          await db.batch(batch);
        } else {
          customPricingMatrix = body.pricing;
        }
      }
      return jsonResponse({ success: true, message: "Pricing saved securely" });
    } catch (err) {
      return jsonResponse({ error: "Invalid pricing payload: " + err.message }, 400);
    }
  }

  // GET pricing
  if (db) {
    try {
      const { results } = await db.prepare("SELECT * FROM pricing").all();
      if (results && results.length > 0) {
        return jsonResponse({ pricing: results });
      }
    } catch (err) {
      console.error("D1 pricing read error:", err);
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
