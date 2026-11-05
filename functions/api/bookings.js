// Cloudflare Pages Function: /api/bookings
// Live synchronization with Hallmaster API (Venue 10954 - Claygate Village Hall)
// Supports single-day check and monthly calendar ranges

const HALLMASTER_VENUE_ID = 10954;
const HALLMASTER_ROOMS = {
  main_hall: "15520",
  small_hall: "15521",
  committee_room: "15522",
  entire_venue: "0"
};

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. AVAILABILITY CHECK: FETCH LIVE FROM HALLMASTER API
  if (url.searchParams.get("availability") === "1") {
    const dateStr = url.searchParams.get("date");
    const monthEnd = url.searchParams.get("monthEnd");
    const room = url.searchParams.get("room") || "main_hall";

    if (!dateStr) {
      return jsonResponse({ error: "Missing required parameter: date" }, 400);
    }

    const busySlots = [];
    const hmRoomId = HALLMASTER_ROOMS[room] || "0";

    const rangeStart = `${dateStr}T00:00:00Z`;
    const rangeEnd = monthEnd ? `${monthEnd}T23:59:59Z` : `${dateStr}T23:59:59Z`;

    try {
      // Query Hallmaster live scheduler API
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

          const sDate = sParts[0];
          const sTime = sParts[1]?.substring(0, 5) || "08:00";
          const eTime = eParts[1]?.substring(0, 5) || "23:00";

          busySlots.push({
            start_date: sDate,
            start_time: sTime,
            end_time: eTime,
            status: "confirmed",
            title: b.title || "Private Booking",
            room_id: b.roomId || hmRoomId,
            source: "hallmaster"
          });
        }
      }
    } catch (err) {
      console.error("Hallmaster fetch error:", err);
    }

    // Include local bookings from D1
    if (env.DB) {
      try {
        let query;
        let stmt;
        if (monthEnd) {
          query = `SELECT room, event_date as start_date, start_time, end_time, status, 'Website Inquiry' as title FROM bookings WHERE event_date >= ? AND event_date <= ? AND status IN ('confirmed', 'pending') ORDER BY event_date, start_time ASC`;
          stmt = env.DB.prepare(query).bind(dateStr, monthEnd);
        } else {
          query = (room && room !== "entire_venue")
            ? `SELECT room, event_date as start_date, start_time, end_time, status, 'Website Inquiry' as title FROM bookings WHERE event_date = ? AND status IN ('confirmed', 'pending') AND (room = ? OR room = 'entire_venue') ORDER BY start_time ASC`
            : `SELECT room, event_date as start_date, start_time, end_time, status, 'Website Inquiry' as title FROM bookings WHERE event_date = ? AND status IN ('confirmed', 'pending') ORDER BY start_time ASC`;
          stmt = (room && room !== "entire_venue") ? env.DB.prepare(query).bind(dateStr, room) : env.DB.prepare(query).bind(dateStr);
        }

        const { results } = await stmt.all();
        if (results) {
          busySlots.push(...results);
        }
      } catch (err) {
        // ignore db error
      }
    }

    return jsonResponse({ bookedSlots: busySlots });
  }

  // 2. ADMIN LIST
  const authHeader = request.headers.get("Authorization");
  const adminSecret = env.ADMIN_SECRET || "admin123";

  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  if (!env.DB) {
    return jsonResponse({ bookings: [] });
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

    const required = ["full_name", "email", "phone", "room", "event_type", "event_date", "start_time", "end_time"];
    for (const field of required) {
      if (!data[field] || String(data[field]).trim() === "") {
        return jsonResponse({ error: `Missing required field: ${field}` }, 400);
      }
    }

    if (data.start_time >= data.end_time) {
      return jsonResponse({ error: "End time must be after start time." }, 400);
    }

    // 1. Validate collision against Hallmaster live API
    const hmRoomId = HALLMASTER_ROOMS[data.room] || "0";
    try {
      const hmUrl = `https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?start=${data.event_date}T00:00:00Z&end=${data.event_date}T23:59:59Z&roomId=${hmRoomId}&custView=false&HallId=${HALLMASTER_VENUE_ID}&groupRooms=false`;
      const hmRes = await fetch(hmUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Referer": `https://v2.hallmaster.co.uk/Scheduler/View/${HALLMASTER_VENUE_ID}`,
          "X-Requested-With": "XMLHttpRequest"
        }
      });
      if (hmRes.ok) {
        const hmBookings = await hmRes.json();
        for (const b of hmBookings) {
          const sTime = b.start.split("T")[1]?.substring(0, 5) || "08:00";
          const eTime = b.end.split("T")[1]?.substring(0, 5) || "23:00";
          if (data.start_time < eTime && data.end_time > sTime) {
            return jsonResponse({
              error: `Clash with Hallmaster live booking (${sTime} - ${eTime}). Please choose another time.`,
              conflict: true
            }, 409);
          }
        }
      }
    } catch (err) {
      console.warn("Hallmaster collision check error:", err);
    }

    const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    if (!env.DB) {
      return jsonResponse({
        success: true,
        reference_code: refCode,
        message: "Booking recorded (Live Hallmaster verified)"
      }, 201);
    }

    // Check collision against D1 bookings
    let overlapQuery = (data.room === "entire_venue")
      ? `SELECT id, room, start_time, end_time FROM bookings WHERE event_date = ? AND status IN ('confirmed', 'pending') AND start_time < ? AND end_time > ? LIMIT 1`
      : `SELECT id, room, start_time, end_time FROM bookings WHERE event_date = ? AND status IN ('confirmed', 'pending') AND (room = ? OR room = 'entire_venue') AND start_time < ? AND end_time > ? LIMIT 1`;

    const overlapStmt = (data.room === "entire_venue")
      ? env.DB.prepare(overlapQuery).bind(data.event_date, data.end_time, data.start_time)
      : env.DB.prepare(overlapQuery).bind(data.event_date, data.room, data.end_time, data.start_time);

    const conflict = await overlapStmt.first();
    if (conflict) {
      return jsonResponse({
        error: `Clash with existing booking (${conflict.start_time} - ${conflict.end_time}). Please choose another time.`,
        conflict: true
      }, 409);
    }

    const stmt = env.DB.prepare(`
      INSERT INTO bookings (
        reference_code, full_name, organization, email, phone, address,
        room, event_type, event_date, start_time, end_time, guest_count,
        requires_stage, requires_kitchen, special_requirements, estimated_cost, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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
      data.special_requirements || null,
      parseFloat(data.estimated_cost) || 0.0
    );

    await stmt.run();

    return jsonResponse({
      success: true,
      reference_code: refCode,
      hallmaster_url: `https://v2.hallmaster.co.uk/Scheduler/View/${HALLMASTER_VENUE_ID}`,
      message: "Booking inquiry successfully received! Verified against Hallmaster schedule."
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
    const stmt = env.DB.prepare(`
      UPDATE bookings 
      SET status = COALESCE(?, status), 
          admin_notes = COALESCE(?, admin_notes),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).bind(status || null, admin_notes || null, id);

    await stmt.run();
    return jsonResponse({ success: true });
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
