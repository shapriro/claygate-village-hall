// Cloudflare Pages Function: /api/bookings
// Handles GET (admin fetch all bookings or single by ID/ref) and POST (submit new booking)

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Security check for Admin access
  const authHeader = request.headers.get("Authorization");
  const adminSecret = env.ADMIN_SECRET || "admin123";

  // Check if requesting single booking by reference code (public check)
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

  // Admin list authentication
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

    // Generate readable reference code: CVH-XXXX
    const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Check DB binding
    if (!env.DB) {
      // Graceful fallback for preview/testing without D1 bound
      return jsonResponse({
        success: true,
        reference_code: refCode,
        message: "Booking inquiry recorded (Demo Mode - configure Cloudflare D1 for persistent storage)",
        details: data
      }, 201);
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

// Support updating status / notes by admin
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
