// Cloudflare Pages Function: /api/bookings
// Handles GET (availability check with regular timetable + admin list) and POST (submit new booking with collision check)

const REGULAR_TIMETABLE = [
  // Sunday=0, Monday=1, Tuesday=2, Wednesday=3, Thursday=4, Friday=5, Saturday=6
  // Weekdays: Claygate Montessori Nursery in Small Hall
  { day: 1, room: "small_hall", start: "08:30", end: "13:00", title: "Claygate Montessori Nursery" },
  { day: 2, room: "small_hall", start: "08:30", end: "13:00", title: "Claygate Montessori Nursery" },
  { day: 3, room: "small_hall", start: "08:30", end: "13:00", title: "Claygate Montessori Nursery" },
  { day: 4, room: "small_hall", start: "08:30", end: "13:00", title: "Claygate Montessori Nursery" },
  { day: 5, room: "small_hall", start: "08:30", end: "13:00", title: "Claygate Montessori Nursery" },

  // Monday
  { day: 1, room: "main_hall", start: "09:00", end: "12:00", title: "Little Kickers" },
  { day: 1, room: "main_hall", start: "19:30", end: "22:30", title: "Claygate Dramatic Society Rehearsal" },

  // Tuesday
  { day: 2, room: "main_hall", start: "15:30", end: "18:30", title: "Impact Dance Studios" },
  { day: 2, room: "main_hall", start: "19:00", end: "21:00", title: "Claygate Community Pilates" },

  // Wednesday
  { day: 3, room: "small_hall", start: "09:30", end: "12:30", title: "Monkey Music" },
  { day: 3, room: "main_hall", start: "16:00", end: "18:30", title: "Impact Dance Studios" },

  // Thursday
  { day: 4, room: "small_hall", start: "09:30", end: "12:00", title: "Fairy Footsteps Ballet" },
  { day: 4, room: "main_hall", start: "16:00", end: "18:30", title: "Impact Dance Studios" },
  { day: 4, room: "main_hall", start: "19:30", end: "22:30", title: "Claygate Dramatic Society Rehearsal" },

  // Friday
  { day: 5, room: "main_hall", start: "16:00", end: "19:00", title: "Surrey Singing School" },

  // Saturday
  { day: 6, room: "main_hall", start: "09:00", end: "13:00", title: "Impact Dance Studios Saturday Class" }
];

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. PUBLIC AVAILABILITY ENDPOINT
  if (url.searchParams.get("availability") === "1") {
    const dateStr = url.searchParams.get("date");
    const room = url.searchParams.get("room");

    if (!dateStr) {
      return jsonResponse({ error: "Missing required parameter: date" }, 400);
    }

    const busySlots = [];

    // Add recurring weekly classes for this day of week
    try {
      const dt = new Date(dateStr + "T00:00:00");
      const dow = dt.getDay(); // 0=Sun .. 6=Sat

      REGULAR_TIMETABLE.forEach(item => {
        if (item.day === dow) {
          if (!room || room === "entire_venue" || item.room === room || item.room === "entire_venue") {
            busySlots.push({
              room: item.room,
              start_time: item.start,
              end_time: item.end,
              status: "confirmed",
              reason: item.title
            });
          }
        }
      });
    } catch {
      // ignore date parse issues
    }

    // Add ad-hoc bookings from D1 if configured
    if (env.DB) {
      try {
        let query;
        let stmt;
        if (room && room !== "entire_venue") {
          query = `
            SELECT room, start_time, end_time, status, 'Reserved' as reason
            FROM bookings 
            WHERE event_date = ? 
              AND status IN ('confirmed', 'pending')
              AND (room = ? OR room = 'entire_venue')
            ORDER BY start_time ASC
          `;
          stmt = env.DB.prepare(query).bind(dateStr, room);
        } else {
          query = `
            SELECT room, start_time, end_time, status, 'Reserved' as reason
            FROM bookings 
            WHERE event_date = ? 
              AND status IN ('confirmed', 'pending')
            ORDER BY start_time ASC
          `;
          stmt = env.DB.prepare(query).bind(dateStr);
        }

        const { results } = await stmt.all();
        if (results) {
          busySlots.push(...results);
        }
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
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

    // Check collision against recurring timetable
    const dt = new Date(data.event_date + "T00:00:00");
    const dow = dt.getDay();

    const recurringConflict = REGULAR_TIMETABLE.find(item => {
      if (item.day !== dow) return false;
      const roomClash = (data.room === "entire_venue" || item.room === "entire_venue" || item.room === data.room);
      const timeClash = (data.start_time < item.end && data.end_time > item.start);
      return roomClash && timeClash;
    });

    if (recurringConflict) {
      return jsonResponse({
        error: `Clash with weekly schedule: ${recurringConflict.title} (${recurringConflict.start} - ${recurringConflict.end}). Please select another time.`,
        conflict: true
      }, 409);
    }

    const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();

    if (!env.DB) {
      return jsonResponse({
        success: true,
        reference_code: refCode,
        message: "Booking recorded (Local/Demo)"
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
      message: "Booking inquiry successfully received!"
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
