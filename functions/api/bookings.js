// Cloudflare Pages Function: /api/bookings
// Handles GET (admin list or public availability check) and POST (submit new booking with overlap check)

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. PUBLIC ENDPOINT: Check availability for a specific room and date
  // e.g. /api/bookings?availability=1&date=2026-11-15&room=main_hall
  if (url.searchParams.get("availability") === "1") {
    const date = url.searchParams.get("date");
    const room = url.searchParams.get("room");

    if (!date) {
      return jsonResponse({ error: "Missing required parameter: date" }, 400);
    }

    if (!env.DB) {
      // In local preview/demo mode without D1, return sample unavailable slots for illustration
      return jsonResponse({
        bookedSlots: [
          { start_time: "10:00", end_time: "12:00", room: room || "main_hall", reason: "Reserved" },
          { start_time: "14:00", end_time: "16:30", room: room || "main_hall", reason: "Reserved" }
        ],
        demoMode: true
      });
    }

    try {
      // Query bookings that conflict:
      // If room is specified, match bookings for that room OR entire_venue bookings (or all if requesting entire_venue)
      let query;
      let stmt;
      if (room && room !== "entire_venue") {
        query = `
          SELECT room, start_time, end_time, status 
          FROM bookings 
          WHERE event_date = ? 
            AND status IN ('confirmed', 'pending')
            AND (room = ? OR room = 'entire_venue')
          ORDER BY start_time ASC
        `;
        stmt = env.DB.prepare(query).bind(date, room);
      } else {
        query = `
          SELECT room, start_time, end_time, status 
          FROM bookings 
          WHERE event_date = ? 
            AND status IN ('confirmed', 'pending')
          ORDER BY start_time ASC
        `;
        stmt = env.DB.prepare(query).bind(date);
      }

      const { results } = await stmt.all();
      return jsonResponse({ bookedSlots: results || [] });
    } catch (err) {
      return jsonResponse({ error: err.message }, 500);
    }
  }

  // 2. PUBLIC ENDPOINT: Check single booking by reference code
  const ref = url.searchParams.get("ref");
  if (ref) {
    if (!env.DB) {
      return jsonResponse({ error: "Database binding DB not configured" }, 500);
    }
    const result = await env.DB.prepare(
      `SELECT reference_code, full_name, room, event_type, event_date, start_time, end_time, status, created_at 
       FROM bookings WHERE reference_code = ?`
    ).bind(ref).first();

    if (!result) {
      return jsonResponse({ error: "Booking reference not found" }, 404);
    }
    return jsonResponse({ booking: result });
  }

  // 3. ADMIN ENDPOINT: List all bookings (Requires Bearer token)
  const authHeader = request.headers.get("Authorization");
  const adminSecret = env.ADMIN_SECRET || "admin123";

  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return jsonResponse({ error: "Unauthorized. Valid admin bearer token required." }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ 
      error: "Cloudflare D1 Database binding 'DB' is not configured yet. Please bind DB in your Pages settings.",
      mockMode: true 
    }, 503);
  }

  try {
    const statusFilter = url.searchParams.get("status");
    let query = `SELECT * FROM bookings ORDER BY created_at DESC LIMIT 100`;
    let stmt;

    if (statusFilter && ["pending", "confirmed", "declined", "cancelled"].includes(statusFilter)) {
      query = `SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC LIMIT 100`;
      stmt = env.DB.prepare(query).bind(statusFilter);
    } else {
      stmt = env.DB.prepare(query);
    }

    const { results } = await stmt.all();
    return jsonResponse({ bookings: results || [] });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const data = await request.json();

    // Required fields validation
    const required = ["full_name", "email", "phone", "room", "event_type", "event_date", "start_time", "end_time"];
    for (const field of required) {
      if (!data[field] || String(data[field]).trim() === "") {
        return jsonResponse({ error: `Missing required field: ${field}` }, 400);
      }
    }

    if (data.start_time >= data.end_time) {
      return jsonResponse({ error: "End time must be after start time." }, 400);
    }

    const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Fallback if D1 is not bound
    if (!env.DB) {
      return jsonResponse({
        success: true,
        reference_code: refCode,
        message: "Booking inquiry recorded (Demo Mode - configure Cloudflare D1 for persistent storage)",
        details: data
      }, 201);
    }

    // --- OVERLAP CONFLICT GUARD ---
    // Check if the requested timeslot overlaps with an existing booking:
    // (RequestedStart < ExistingEnd) AND (RequestedEnd > ExistingStart)
    let overlapQuery;
    let overlapStmt;

    if (data.room === "entire_venue") {
      overlapQuery = `
        SELECT id, room, start_time, end_time 
        FROM bookings 
        WHERE event_date = ? 
          AND status IN ('confirmed', 'pending')
          AND start_time < ? 
          AND end_time > ?
        LIMIT 1
      `;
      overlapStmt = env.DB.prepare(overlapQuery).bind(data.event_date, data.end_time, data.start_time);
    } else {
      overlapQuery = `
        SELECT id, room, start_time, end_time 
        FROM bookings 
        WHERE event_date = ? 
          AND status IN ('confirmed', 'pending')
          AND (room = ? OR room = 'entire_venue')
          AND start_time < ? 
          AND end_time > ?
        LIMIT 1
      `;
      overlapStmt = env.DB.prepare(overlapQuery).bind(data.event_date, data.room, data.end_time, data.start_time);
    }

    const conflict = await overlapStmt.first();
    if (conflict) {
      return jsonResponse({
        error: `The requested time (${data.start_time} - ${data.end_time}) conflicts with an existing booking (${conflict.start_time} - ${conflict.end_time}). Please choose another time.`,
        conflict: true
      }, 409); // 409 Conflict
    }

    const stmt = env.DB.prepare(`
      INSERT INTO bookings (
        reference_code, full_name, organization, email, phone, address,
        room, event_type, event_date, start_time, end_time, guest_count,
        requires_stage, requires_kitchen, special_requirements, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `).bind(
      refCode,
      data.full_name,
      data.organization || null,
      data.email,
      data.phone,
      data.address || null,
      data.room,
      data.event_type,
      data.event_date,
      data.start_time,
      data.end_time,
      parseInt(data.guest_count) || 0,
      data.requires_stage ? 1 : 0,
      data.requires_kitchen ? 1 : 0,
      data.special_requirements || null
    );

    await stmt.run();

    return jsonResponse({
      success: true,
      reference_code: refCode,
      message: "Booking inquiry successfully received! The lettings team will review and confirm your reservation."
    }, 201);

  } catch (err) {
    return jsonResponse({ error: "Invalid request payload: " + err.message }, 400);
  }
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  const authHeader = request.headers.get("Authorization");
  const adminSecret = env.ADMIN_SECRET || "admin123";

  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ error: "Database not configured" }, 503);
  }

  try {
    const { id, status, admin_notes } = await request.json();
    if (!id) {
      return jsonResponse({ error: "Booking ID is required" }, 400);
    }

    const stmt = env.DB.prepare(`
      UPDATE bookings 
      SET status = COALESCE(?, status), 
          admin_notes = COALESCE(?, admin_notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status || null, admin_notes || null, id);

    const info = await stmt.run();
    return jsonResponse({ success: true, updated: info.meta.changes > 0 });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
