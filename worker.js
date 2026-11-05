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

    // 3. Static Assets: Fallback to Cloudflare Assets binding
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

    return jsonResponse({ bookedSlots: busySlots });
  }

  // POST: Create booking
  if (request.method === "POST") {
    const data = await request.json();
    const refCode = "CVH-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    return jsonResponse({
      success: true,
      reference_code: refCode,
      message: "Booking received"
    }, 201);
  }

  return jsonResponse({ error: "Method not allowed" }, 405);
}

function handlePricingApi(request, env) {
  const defaultPricing = [
    { key: "rate_main_hall", name: "Main Hall", category: "room_rate", price: 16.00, unit: "per_hour" },
    { key: "rate_small_hall", name: "Small Hall", category: "room_rate", price: 11.00, unit: "per_hour" },
    { key: "rate_committee_room", name: "Committee Room", category: "room_rate", price: 8.00, unit: "per_hour" },
    { key: "rate_entire_venue", name: "Entire Complex", category: "room_rate", price: 25.00, unit: "per_hour" },
    { key: "rate_stage_av", name: "Stage Lighting & PA System", category: "addon", price: 25.00, unit: "per_event" },
    { key: "rate_kitchen_commercial", name: "Commercial Kitchen & Cooker/Dishwasher", category: "addon", price: 10.00, unit: "per_event" },
    { key: "rate_deposit", name: "Refundable Security Deposit", category: "deposit", price: 50.00, unit: "flat" }
  ];
  return jsonResponse({ pricing: defaultPricing });
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
