export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Initial setup endpoint to run schema creation on D1 and report any errors
    if (url.pathname === "/api/setup-db") {
      const db = env.DB || env.cvh_db;
      if (!db) {
        return jsonResponse({ error: "No DB binding found in env" }, 500);
      }
      try {
        const r1 = await db.prepare(`
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
          )
        `).run();

        const r2 = await db.prepare(`
          CREATE TABLE IF NOT EXISTS pricing (
            key TEXT PRIMARY KEY,
            room TEXT,
            category TEXT,
            name TEXT,
            price REAL,
            unit TEXT
          )
        `).run();

        await db.prepare(`
          CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            email TEXT UNIQUE,
            name TEXT,
            password_hash TEXT,
            role TEXT DEFAULT 'admin',
            can_read_bookings INTEGER DEFAULT 1,
            can_write_bookings INTEGER DEFAULT 1,
            can_read_pricing INTEGER DEFAULT 1,
            can_write_pricing INTEGER DEFAULT 1,
            can_manage_users INTEGER DEFAULT 0,
            can_view_audit INTEGER DEFAULT 1,
            can_read_documents INTEGER DEFAULT 1,
            can_upload_documents INTEGER DEFAULT 0,
            must_change_password INTEGER DEFAULT 0,
            reset_token TEXT,
            reset_token_expiry TEXT,
            created_at TEXT
          )
        `).run();

        await db.prepare(`
          CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            user_name TEXT,
            action TEXT,
            target_type TEXT,
            target_id TEXT,
            details TEXT,
            ip TEXT
          )
        `).run();

        await db.prepare(`
          CREATE TABLE IF NOT EXISTS documents (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT,
            filename TEXT,
            category TEXT,
            file_size INTEGER,
            mime_type TEXT,
            file_data TEXT,
            uploaded_by TEXT,
            created_at TEXT
          )
        `).run();

        // Seed default super admin if none exists
        const superAdmin = await db.prepare("SELECT id FROM admin_users WHERE username = ?").bind("admin").first();
        if (!superAdmin) {
          const hash = await hashPassword("admin123");
          await db.prepare(`
            INSERT INTO admin_users (
              username, email, name, password_hash, role,
              can_read_bookings, can_write_bookings, can_read_pricing, can_write_pricing,
              can_manage_users, can_view_audit, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            "admin", "admin@claygatevillagehall.co.uk", "Primary Administrator", hash, "super_admin",
            1, 1, 1, 1, 1, 1, new Date().toISOString()
          ).run();
        }

        return jsonResponse({ success: true, message: "Tables and super admin verified in D1 successfully" });
      } catch (err) {
        return jsonResponse({ error: err.message, stack: err.stack }, 500);
      }
    }

    // Diagnostics endpoint to inspect bindings
    if (url.pathname === "/api/debug-env") {
      const keys = Object.keys(env || {});
      const hasDB = !!(env.DB || env.cvh_db);
      return jsonResponse({
        bindingKeys: keys,
        hasDB,
        dbType: typeof (env.DB || env.cvh_db)
      });
    }

    // 1. API: Admin Authentication & Profile
    if (url.pathname.startsWith("/api/auth/")) {
      return handleAuthApi(request, url, env);
    }

    // 2. API: Admin Users Management (RBAC)
    if (url.pathname.startsWith("/api/admin-users")) {
      return handleAdminUsersApi(request, url, env);
    }

    // 3. API: Audit Log
    if (url.pathname.startsWith("/api/audit-log")) {
      return handleAuditLogApi(request, url, env);
    }

    // 4. API: Documents Hub
    if (url.pathname.startsWith("/api/documents")) {
      return handleDocumentsApi(request, url, env);
    }

    // 5. API: Bookings & Live Hallmaster Proxy
    if (url.pathname.startsWith("/api/bookings")) {
      return handleBookingsApi(request, url, env);
    }

    // 6. API: Pricing
    if (url.pathname.startsWith("/api/pricing")) {
      return handlePricingApi(request, env);
    }

    // 7. API: Postcode Lookup Proxy (Bypasses any browser CORS or ISP filters)
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
async function ensureD1Tables(db) {
  if (!db) return;
  try {
    await db.prepare(`
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
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS pricing (
        key TEXT PRIMARY KEY,
        room TEXT,
        category TEXT,
        name TEXT,
        price REAL,
        unit TEXT
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        name TEXT,
        password_hash TEXT,
        role TEXT DEFAULT 'admin',
        can_read_bookings INTEGER DEFAULT 1,
        can_write_bookings INTEGER DEFAULT 1,
        can_read_pricing INTEGER DEFAULT 1,
        can_write_pricing INTEGER DEFAULT 1,
        can_manage_users INTEGER DEFAULT 0,
        can_view_audit INTEGER DEFAULT 1,
        can_read_documents INTEGER DEFAULT 1,
        can_upload_documents INTEGER DEFAULT 0,
        must_change_password INTEGER DEFAULT 0,
        reset_token TEXT,
        reset_token_expiry TEXT,
        created_at TEXT
      )
    `).run();

    // Safely add any new columns to existing admin_users table in SQLite
    try { await db.prepare("ALTER TABLE admin_users ADD COLUMN can_read_documents INTEGER DEFAULT 1").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE admin_users ADD COLUMN can_upload_documents INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE admin_users ADD COLUMN must_change_password INTEGER DEFAULT 0").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE admin_users ADD COLUMN reset_token TEXT").run(); } catch(e){}
    try { await db.prepare("ALTER TABLE admin_users ADD COLUMN reset_token_expiry TEXT").run(); } catch(e){}

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        user_name TEXT,
        action TEXT,
        target_type TEXT,
        target_id TEXT,
        details TEXT,
        ip TEXT
      )
    `).run();

    await db.prepare(`
      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        filename TEXT,
        category TEXT,
        file_size INTEGER,
        mime_type TEXT,
        file_data TEXT,
        uploaded_by TEXT,
        created_at TEXT
      )
    `).run();

    // Seed default super admin if none exists
    const superAdmin = await db.prepare("SELECT id FROM admin_users WHERE username = ?").bind("admin").first();
    if (!superAdmin) {
      const hash = await hashPassword("admin123");
      await db.prepare(`
        INSERT INTO admin_users (
          username, email, name, password_hash, role,
          can_read_bookings, can_write_bookings, can_read_pricing, can_write_pricing,
          can_manage_users, can_view_audit, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        "admin", "admin@claygatevillagehall.co.uk", "Primary Administrator", hash, "super_admin",
        1, 1, 1, 1, 1, 1, new Date().toISOString()
      ).run();
    }
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

    if (url.searchParams.get("debug") === "1") {
      const keys = Object.keys(env || {});
      const hasDB = !!(env.DB || env.cvh_db);
      return jsonResponse({
        bindingKeys: keys,
        hasDB,
        dbType: typeof (env.DB || env.cvh_db),
        d1Initialized
      });
    }

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

  // PUT: Full update of booking details from Admin Portal edit modal
  if (request.method === "PUT") {
    const user = await getAuthenticatedUser(request, env);
    if (user && !user.can_write_bookings) {
      return jsonResponse({ error: "Forbidden: You do not have permission to edit bookings" }, 403);
    }

    try {
      const data = await request.json();
      const id = Number(data.id);
      if (!id) {
        return jsonResponse({ error: "Missing booking ID" }, 400);
      }

      if (db) {
        const stmt = db.prepare(`
          UPDATE bookings SET
            full_name = ?,
            organization = ?,
            email = ?,
            phone = ?,
            address = ?,
            address_line1 = ?,
            address_city = ?,
            address_postcode = ?,
            room = ?,
            event_type = ?,
            event_date = ?,
            start_time = ?,
            end_time = ?,
            guest_count = ?,
            requires_stage = ?,
            requires_kitchen = ?,
            special_requirements = ?,
            estimated_cost = ?,
            status = ?
          WHERE id = ?
        `);

        await stmt.bind(
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
          data.status || "pending",
          id
        ).run();

        await logAuditAction(
          db,
          user ? user.username : "Admin",
          "BOOKING_EDITED",
          "booking",
          id,
          `Updated booking #${id} (${data.event_date} ${data.room}, status: ${data.status})`,
          request
        );

        return jsonResponse({ success: true, message: "Booking updated successfully" });
      }

      const booking = bookingsStore.find(b => b.id === id);
      if (!booking) {
        return jsonResponse({ error: "Booking not found" }, 404);
      }
      Object.assign(booking, data);
      return jsonResponse({ success: true, booking });
    } catch (err) {
      return jsonResponse({ error: "Failed to update booking: " + err.message }, 400);
    }
  }

  // DELETE: Delete booking from Admin Portal
  if (request.method === "DELETE") {
    const user = await getAuthenticatedUser(request, env);
    if (user && !user.can_write_bookings) {
      return jsonResponse({ error: "Forbidden: You do not have permission to delete bookings" }, 403);
    }

    try {
      const { id } = await request.json();
      if (!id) {
        return jsonResponse({ error: "Missing booking ID" }, 400);
      }
      if (db) {
        await db.prepare("DELETE FROM bookings WHERE id = ?").bind(Number(id)).run();
        await logAuditAction(
          db,
          user ? user.username : "Admin",
          "BOOKING_DELETED",
          "booking",
          id,
          `Permanently deleted booking #${id}`,
          request
        );
        return jsonResponse({ success: true, message: "Booking deleted successfully" });
      }
      bookingsStore = bookingsStore.filter(b => b.id !== Number(id));
      return jsonResponse({ success: true });
    } catch (err) {
      return jsonResponse({ error: "Failed to delete booking: " + err.message }, 400);
    }
  }

  // PATCH: Update booking status (confirm/decline) from Admin Portal
  if (request.method === "PATCH") {
    const user = await getAuthenticatedUser(request, env);
    if (user && !user.can_write_bookings) {
      return jsonResponse({ error: "Forbidden: You do not have permission to change booking status" }, 403);
    }

    try {
      const { id, status } = await request.json();
      if (db) {
        await db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).bind(status, Number(id)).run();
        await logAuditAction(
          db,
          user ? user.username : "Admin",
          `BOOKING_STATUS_${(status || "").toUpperCase()}`,
          "booking",
          id,
          `Changed status of booking #${id} to ${status}`,
          request
        );
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
    const user = await getAuthenticatedUser(request, env);
    if (user && !user.can_write_pricing) {
      return jsonResponse({ error: "Forbidden: You do not have permission to update pricing" }, 403);
    }

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
          await logAuditAction(
            db,
            user ? user.username : "Admin",
            "PRICING_UPDATED",
            "pricing",
            "matrix",
            `Updated ${body.pricing.length} pricing matrix rules`,
            request
          );
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
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}

// ----------------------------------------------------
// RBAC Auth, User Management & Audit Logging Helpers
// ----------------------------------------------------

async function hashPassword(password) {
  const enc = new TextEncoder();
  // Simple HMAC-style salt with SHA-256 for worker portability
  const keyMaterial = enc.encode("cvh_salt_key_2026_" + password);
  const hashBuf = await crypto.subtle.digest("SHA-256", keyMaterial);
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function logAuditAction(db, userName, action, targetType, targetId, details, request) {
  if (!db) return;
  try {
    const ip = request ? (request.headers.get("cf-connecting-ip") || "unknown") : "local";
    await db.prepare(`
      INSERT INTO audit_log (timestamp, user_name, action, target_type, target_id, details, ip)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      new Date().toISOString(),
      userName || "Admin",
      action,
      targetType || "general",
      String(targetId || ""),
      typeof details === "object" ? JSON.stringify(details) : String(details || ""),
      ip
    ).run();
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

// Helper to authenticate request and get the admin user
async function getAuthenticatedUser(request, env) {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;

  const db = env.DB || env.cvh_db;
  if (!db) {
    if (token === "admin123") {
      return {
        id: 1,
        username: "admin",
        name: "Primary Administrator",
        role: "super_admin",
        can_read_bookings: 1,
        can_write_bookings: 1,
        can_read_pricing: 1,
        can_write_pricing: 1,
        can_manage_users: 1,
        can_view_audit: 1
      };
    }
    return null;
  }

  // Token is either:
  // 1) "usr_<username>" or "Bearer <username>" from successful login
  // 2) or direct fallback "admin123"
  if (token === "admin123") {
    const admin = await db.prepare("SELECT * FROM admin_users WHERE username = 'admin'").first();
    if (admin) return admin;
  }

  // If token is prefixed with usr_
  if (token.startsWith("usr_")) {
    const username = token.replace("usr_", "");
    const user = await db.prepare("SELECT * FROM admin_users WHERE username = ?").bind(username).first();
    if (user) return user;
  }

  // Direct username check
  const user = await db.prepare("SELECT * FROM admin_users WHERE username = ?").bind(token).first();
  return user || null;
}

// ----------------------------------------------------
// Handlers for Auth, RBAC & Audit Log
// ----------------------------------------------------

async function handleAuthApi(request, url, env) {
  const db = env.DB || env.cvh_db;
  if (db) await ensureD1Tables(db);

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    try {
      const { username, password } = await request.json();
      if (!username || !password) {
        return jsonResponse({ error: "Username/email and password required" }, 400);
      }

      if (db) {
        const user = await db.prepare(`
          SELECT * FROM admin_users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)
        `).bind(username.trim(), username.trim()).first();

        if (!user) {
          return jsonResponse({ error: "Invalid username or password" }, 401);
        }

        const inputHash = await hashPassword(password);
        // Allow check against hash or bootstrap password
        if (user.password_hash !== inputHash && password !== "admin123") {
          return jsonResponse({ error: "Invalid username or password" }, 401);
        }

        const token = "usr_" + user.username;
        const profile = {
          id: user.id,
          username: user.username,
          name: user.name,
          email: user.email,
          role: user.role,
          can_read_bookings: !!user.can_read_bookings,
          can_write_bookings: !!user.can_write_bookings,
          can_read_pricing: !!user.can_read_pricing,
          can_write_pricing: !!user.can_write_pricing,
          can_manage_users: !!user.can_manage_users,
          can_view_audit: !!user.can_view_audit,
          can_read_documents: !!user.can_read_documents,
          can_upload_documents: !!user.can_upload_documents,
          must_change_password: !!user.must_change_password
        };

        await logAuditAction(db, user.username, "USER_LOGIN", "auth", user.id, "Admin user logged in", request);

        return jsonResponse({
          success: true,
          token,
          user: profile
        });
      }

      // Fallback without DB
      if ((username === "admin" || username === "admin@claygatevillagehall.co.uk") && password === "admin123") {
        return jsonResponse({
          success: true,
          token: "admin123",
          user: {
            id: 1,
            username: "admin",
            name: "Primary Administrator",
            email: "admin@claygatevillagehall.co.uk",
            role: "super_admin",
            can_read_bookings: true,
            can_write_bookings: true,
            can_read_pricing: true,
            can_write_pricing: true,
            can_manage_users: true,
            can_view_audit: true,
            can_read_documents: true,
            can_upload_documents: true,
            must_change_password: false
          }
        });
      }

      return jsonResponse({ error: "Invalid username or password" }, 401);
    } catch (err) {
      return jsonResponse({ error: "Login failed: " + err.message }, 400);
    }
  }

  // Self-Service Change Password (for logged in user)
  if (url.pathname === "/api/auth/change-password" && request.method === "POST") {
    const user = await getAuthenticatedUser(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    try {
      const { oldPassword, newPassword } = await request.json();
      if (!newPassword || newPassword.length < 6) {
        return jsonResponse({ error: "New password must be at least 6 characters" }, 400);
      }

      if (db) {
        // If user is forced to change password (must_change_password), allow without old password check if omitted
        if (!user.must_change_password) {
          const oldHash = await hashPassword(oldPassword || "");
          if (user.password_hash !== oldHash && oldPassword !== "admin123") {
            return jsonResponse({ error: "Current password is incorrect" }, 400);
          }
        }

        const newHash = await hashPassword(newPassword);
        await db.prepare(`
          UPDATE admin_users
          SET password_hash = ?, must_change_password = 0, reset_token = NULL, reset_token_expiry = NULL
          WHERE id = ?
        `).bind(newHash, user.id).run();

        await logAuditAction(
          db,
          user.username,
          "PASSWORD_CHANGED",
          "auth",
          user.id,
          `User ${user.username} updated their own password`,
          request
        );

        return jsonResponse({ success: true, message: "Password updated successfully" });
      }

      return jsonResponse({ success: true, message: "Password changed (in-memory)" });
    } catch (err) {
      return jsonResponse({ error: "Failed to update password: " + err.message }, 400);
    }
  }

  // Forgot Password / Reset Password using token
  if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
    try {
      const { token, newPassword } = await request.json();
      if (!token || !newPassword || newPassword.length < 6) {
        return jsonResponse({ error: "Invalid reset request. Password must be at least 6 characters." }, 400);
      }

      if (db) {
        const user = await db.prepare(`
          SELECT * FROM admin_users
          WHERE reset_token = ? AND reset_token_expiry > ?
        `).bind(token, new Date().toISOString()).first();

        if (!user) {
          return jsonResponse({ error: "Password reset link is invalid or has expired" }, 400);
        }

        const newHash = await hashPassword(newPassword);
        await db.prepare(`
          UPDATE admin_users
          SET password_hash = ?, reset_token = NULL, reset_token_expiry = NULL, must_change_password = 0
          WHERE id = ?
        `).bind(newHash, user.id).run();

        await logAuditAction(
          db,
          user.username,
          "PASSWORD_RESET_COMPLETED",
          "auth",
          user.id,
          `User ${user.username} completed password reset via token`,
          request
        );

        return jsonResponse({ success: true, message: "Password reset successfully. You can now sign in." });
      }

      return jsonResponse({ error: "Database not connected" }, 500);
    } catch (err) {
      return jsonResponse({ error: "Reset failed: " + err.message }, 400);
    }
  }

  // Profile verification
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    const user = await getAuthenticatedUser(request, env);
    if (!user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    return jsonResponse({
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        email: user.email,
        role: user.role,
        can_read_bookings: !!user.can_read_bookings,
        can_write_bookings: !!user.can_write_bookings,
        can_read_pricing: !!user.can_read_pricing,
        can_write_pricing: !!user.can_write_pricing,
        can_manage_users: !!user.can_manage_users,
        can_view_audit: !!user.can_view_audit,
        can_read_documents: !!user.can_read_documents,
        can_upload_documents: !!user.can_upload_documents,
        must_change_password: !!user.must_change_password
      }
    });
  }

  return jsonResponse({ error: "Auth endpoint not found" }, 404);
}

async function handleAdminUsersApi(request, url, env) {
  const db = env.DB || env.cvh_db;
  if (!db) {
    return jsonResponse({ error: "D1 database connection required for RBAC user management" }, 503);
  }
  await ensureD1Tables(db);

  const currentUser = await getAuthenticatedUser(request, env);
  if (!currentUser || !currentUser.can_manage_users) {
    return jsonResponse({ error: "Forbidden: You do not have permission to manage admin users" }, 403);
  }

  // GET: List all admin users with access rights
  if (request.method === "GET") {
    try {
      const { results } = await db.prepare(`
        SELECT id, username, email, name, role,
               can_read_bookings, can_write_bookings,
               can_read_pricing, can_write_pricing,
               can_manage_users, can_view_audit,
               can_read_documents, can_upload_documents,
               must_change_password, reset_token, reset_token_expiry,
               created_at
        FROM admin_users
        ORDER BY id ASC
      `).all();

      const users = (results || []).map(u => ({
        ...u,
        can_read_bookings: !!u.can_read_bookings,
        can_write_bookings: !!u.can_write_bookings,
        can_read_pricing: !!u.can_read_pricing,
        can_write_pricing: !!u.can_write_pricing,
        can_manage_users: !!u.can_manage_users,
        can_view_audit: !!u.can_view_audit,
        can_read_documents: !!u.can_read_documents,
        can_upload_documents: !!u.can_upload_documents,
        must_change_password: !!u.must_change_password,
        has_active_reset: !!(u.reset_token && u.reset_token_expiry && new Date(u.reset_token_expiry) > new Date())
      }));

      return jsonResponse({ users });
    } catch (err) {
      return jsonResponse({ error: "Failed to fetch admin users: " + err.message }, 500);
    }
  }

  // POST: Create a new admin user
  if (request.method === "POST") {
    try {
      const data = await request.json();
      if (!data.username || !data.password || !data.name) {
        return jsonResponse({ error: "Username, full name, and password are required" }, 400);
      }

      const existing = await db.prepare("SELECT id FROM admin_users WHERE username = ? OR email = ?")
        .bind(data.username.trim(), (data.email || "").trim()).first();
      if (existing) {
        return jsonResponse({ error: "User with this username or email already exists" }, 409);
      }

      const hash = await hashPassword(data.password);
      await db.prepare(`
        INSERT INTO admin_users (
          username, email, name, password_hash, role,
          can_read_bookings, can_write_bookings,
          can_read_pricing, can_write_pricing,
          can_manage_users, can_view_audit,
          can_read_documents, can_upload_documents,
          must_change_password, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        data.username.trim(),
        (data.email || "").trim(),
        data.name.trim(),
        hash,
        data.role || "staff",
        data.can_read_bookings ? 1 : 0,
        data.can_write_bookings ? 1 : 0,
        data.can_read_pricing ? 1 : 0,
        data.can_write_pricing ? 1 : 0,
        data.can_manage_users ? 1 : 0,
        data.can_view_audit ? 1 : 0,
        data.can_read_documents ? 1 : 0,
        data.can_upload_documents ? 1 : 0,
        data.must_change_password ? 1 : 0,
        new Date().toISOString()
      ).run();

      await logAuditAction(
        db,
        currentUser.username,
        "USER_CREATED",
        "admin_user",
        data.username,
        `Created admin user ${data.username} (${data.role})${data.must_change_password ? ' [must change password on first login]' : ''}`,
        request
      );

      return jsonResponse({ success: true, message: `Admin user ${data.username} created successfully` }, 201);
    } catch (err) {
      return jsonResponse({ error: "Failed to create user: " + err.message }, 400);
    }
  }

  // PUT: Update an existing admin user
  if (request.method === "PUT") {
    try {
      const data = await request.json();
      const id = Number(data.id);
      if (!id) return jsonResponse({ error: "Missing user ID" }, 400);

      const targetUser = await db.prepare("SELECT * FROM admin_users WHERE id = ?").bind(id).first();
      if (!targetUser) return jsonResponse({ error: "User not found" }, 404);

      let pwHash = targetUser.password_hash;
      if (data.password && data.password.trim().length > 0) {
        pwHash = await hashPassword(data.password.trim());
      }

      await db.prepare(`
        UPDATE admin_users SET
          name = ?, email = ?, password_hash = ?, role = ?,
          can_read_bookings = ?, can_write_bookings = ?,
          can_read_pricing = ?, can_write_pricing = ?,
          can_manage_users = ?, can_view_audit = ?,
          can_read_documents = ?, can_upload_documents = ?,
          must_change_password = ?
        WHERE id = ?
      `).bind(
        data.name ? data.name.trim() : targetUser.name,
        data.email ? data.email.trim() : targetUser.email,
        pwHash,
        data.role || targetUser.role,
        data.can_read_bookings ? 1 : 0,
        data.can_write_bookings ? 1 : 0,
        data.can_read_pricing ? 1 : 0,
        data.can_write_pricing ? 1 : 0,
        data.can_manage_users ? 1 : 0,
        data.can_view_audit ? 1 : 0,
        data.can_read_documents ? 1 : 0,
        data.can_upload_documents ? 1 : 0,
        data.must_change_password ? 1 : 0,
        id
      ).run();

      await logAuditAction(
        db,
        currentUser.username,
        "USER_UPDATED",
        "admin_user",
        targetUser.username,
        `Updated permissions/details for ${targetUser.username}`,
        request
      );

      return jsonResponse({ success: true, message: `User ${targetUser.username} updated successfully` });
    } catch (err) {
      return jsonResponse({ error: "Failed to update user: " + err.message }, 400);
    }
  }

  // PATCH: Generate Reset Token for an admin user
  if (request.method === "PATCH") {
    try {
      const { id, action } = await request.json();
      if (action === "generate_reset") {
        const targetUser = await db.prepare("SELECT * FROM admin_users WHERE id = ?").bind(Number(id)).first();
        if (!targetUser) return jsonResponse({ error: "User not found" }, 404);

        const resetToken = "rst_" + Math.random().toString(36).substring(2, 12) + Math.random().toString(36).substring(2, 12);
        // Expiry 24 hours
        const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

        await db.prepare(`
          UPDATE admin_users
          SET reset_token = ?, reset_token_expiry = ?
          WHERE id = ?
        `).bind(resetToken, expiry, targetUser.id).run();

        await logAuditAction(
          db,
          currentUser.username,
          "PASSWORD_RESET_GENERATED",
          "admin_user",
          targetUser.username,
          `Generated a 24hr one-time password reset link for ${targetUser.username}`,
          request
        );

        return jsonResponse({
          success: true,
          reset_token: resetToken,
          expiry,
          message: `Password reset link generated for ${targetUser.username}`
        });
      }
      return jsonResponse({ error: "Unknown action" }, 400);
    } catch (err) {
      return jsonResponse({ error: "Failed to generate reset link: " + err.message }, 400);
    }
  }

  // DELETE: Delete an admin user
  if (request.method === "DELETE") {
    try {
      const { id } = await request.json();
      if (!id) return jsonResponse({ error: "Missing user ID" }, 400);

      const targetUser = await db.prepare("SELECT * FROM admin_users WHERE id = ?").bind(Number(id)).first();
      if (!targetUser) return jsonResponse({ error: "User not found" }, 404);

      if (targetUser.username === "admin" || targetUser.id === currentUser.id) {
        return jsonResponse({ error: "Cannot delete the primary administrator or your own logged-in account" }, 400);
      }

      await db.prepare("DELETE FROM admin_users WHERE id = ?").bind(Number(id)).run();

      await logAuditAction(
        db,
        currentUser.username,
        "USER_DELETED",
        "admin_user",
        targetUser.username,
        `Deleted admin user ${targetUser.username} (#${id})`,
        request
      );

      return jsonResponse({ success: true, message: `User ${targetUser.username} deleted` });
    } catch (err) {
      return jsonResponse({ error: "Failed to delete user: " + err.message }, 400);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

async function handleAuditLogApi(request, url, env) {
  const db = env.DB || env.cvh_db;
  if (!db) {
    return jsonResponse({ logs: [] });
  }
  await ensureD1Tables(db);

  const currentUser = await getAuthenticatedUser(request, env);
  if (!currentUser || !currentUser.can_view_audit) {
    return jsonResponse({ error: "Forbidden: You do not have permission to view the audit log" }, 403);
  }

  try {
    const limit = parseInt(url.searchParams.get("limit") || "100", 10);
    const { results } = await db.prepare(`
      SELECT * FROM audit_log
      ORDER BY id DESC
      LIMIT ?
    `).bind(limit).all();

    return jsonResponse({ logs: results || [] });
  } catch (err) {
    return jsonResponse({ error: "Failed to load audit history: " + err.message }, 500);
  }
}

// ----------------------------------------------------
// Documents Hub API (Internal Committee Repository)
// ----------------------------------------------------

async function handleDocumentsApi(request, url, env) {
  const db = env.DB || env.cvh_db;
  if (!db) {
    return jsonResponse({ error: "D1 database connection required for Document Hub" }, 503);
  }
  await ensureD1Tables(db);

  const currentUser = await getAuthenticatedUser(request, env);
  if (!currentUser || !currentUser.can_read_documents) {
    return jsonResponse({ error: "Forbidden: You do not have permission to view documents" }, 403);
  }

  // GET: List documents or download single document file
  if (request.method === "GET") {
    const docId = url.searchParams.get("id");
    const download = url.searchParams.get("download") === "1";

    if (docId) {
      const doc = await db.prepare("SELECT * FROM documents WHERE id = ?").bind(Number(docId)).first();
      if (!doc) return jsonResponse({ error: "Document not found" }, 404);

      if (download) {
        await logAuditAction(
          db,
          currentUser.username,
          "DOCUMENT_DOWNLOADED",
          "document",
          doc.id,
          `Downloaded "${doc.filename}" (${doc.title})`,
          request
        );

        // Convert stored base64 back to binary
        const byteCharacters = atob(doc.file_data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);

        return new Response(byteArray, {
          status: 200,
          headers: {
            "Content-Type": doc.mime_type || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(doc.filename)}"`,
            "Access-Control-Allow-Origin": "*"
          }
        });
      }

      // Return metadata without heavy base64
      const { file_data, ...meta } = doc;
      return jsonResponse({ document: meta });
    }

    // List all documents (metadata only)
    try {
      const { results } = await db.prepare(`
        SELECT id, title, filename, category, file_size, mime_type, uploaded_by, created_at
        FROM documents
        ORDER BY id DESC
      `).all();

      return jsonResponse({ documents: results || [] });
    } catch (err) {
      return jsonResponse({ error: "Failed to list documents: " + err.message }, 500);
    }
  }

  // POST: Upload a document
  if (request.method === "POST") {
    if (!currentUser.can_upload_documents && !currentUser.can_manage_users) {
      return jsonResponse({ error: "Forbidden: You do not have permission to upload documents" }, 403);
    }

    try {
      const data = await request.json();
      if (!data.filename || !data.file_data) {
        return jsonResponse({ error: "Filename and file content required" }, 400);
      }

      const title = (data.title || data.filename).trim();
      const category = data.category || "General";
      const mime = data.mime_type || "application/pdf";
      const size = parseInt(data.file_size, 10) || 0;
      const createdAt = new Date().toISOString();

      const res = await db.prepare(`
        INSERT INTO documents (
          title, filename, category, file_size, mime_type, file_data, uploaded_by, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        title,
        data.filename,
        category,
        size,
        mime,
        data.file_data,
        currentUser.username,
        createdAt
      ).run();

      const docId = res.meta?.last_row_id || 1;

      await logAuditAction(
        db,
        currentUser.username,
        "DOCUMENT_UPLOADED",
        "document",
        docId,
        `Uploaded "${data.filename}" in category "${category}" (${(size / 1024).toFixed(1)} KB)`,
        request
      );

      return jsonResponse({
        success: true,
        id: docId,
        message: `Document "${data.filename}" stored securely in Village Hall repository`
      }, 201);
    } catch (err) {
      return jsonResponse({ error: "Failed to upload document: " + err.message }, 400);
    }
  }

  // DELETE: Delete a document
  if (request.method === "DELETE") {
    if (!currentUser.can_upload_documents && !currentUser.can_manage_users) {
      return jsonResponse({ error: "Forbidden: You do not have permission to delete documents" }, 403);
    }

    try {
      const { id } = await request.json();
      if (!id) return jsonResponse({ error: "Missing document ID" }, 400);

      const doc = await db.prepare("SELECT * FROM documents WHERE id = ?").bind(Number(id)).first();
      if (!doc) return jsonResponse({ error: "Document not found" }, 404);

      await db.prepare("DELETE FROM documents WHERE id = ?").bind(Number(id)).run();

      await logAuditAction(
        db,
        currentUser.username,
        "DOCUMENT_DELETED",
        "document",
        id,
        `Deleted document "${doc.filename}" (${doc.title})`,
        request
      );

      return jsonResponse({ success: true, message: `Document "${doc.filename}" deleted` });
    } catch (err) {
      return jsonResponse({ error: "Failed to delete document: " + err.message }, 400);
    }
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}
