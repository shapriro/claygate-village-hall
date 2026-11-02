// Cloudflare Pages Function: /api/pricing
// GET: public or admin pricing list
// POST/PUT: admin update prices

const DEFAULT_PRICING = [
  { key: "rate_main_hall", name: "Main Hall", category: "room_rate", price: 16.00, unit: "per_hour" },
  { key: "rate_small_hall", name: "Small Hall", category: "room_rate", price: 11.00, unit: "per_hour" },
  { key: "rate_committee_room", name: "Committee Room", category: "room_rate", price: 8.00, unit: "per_hour" },
  { key: "rate_entire_venue", name: "Entire Complex", category: "room_rate", price: 25.00, unit: "per_hour" },
  { key: "rate_stage_av", name: "Stage Lighting & PA System", category: "addon", price: 25.00, unit: "per_event" },
  { key: "rate_kitchen_commercial", name: "Commercial Kitchen & Cooker/Dishwasher", category: "addon", price: 10.00, unit: "per_event" },
  { key: "rate_deposit", name: "Refundable Security Deposit", category: "deposit", price: 50.00, unit: "flat" }
];

export async function onRequestGet(context) {
  const { env } = context;

  if (!env.DB) {
    return jsonResponse({ pricing: DEFAULT_PRICING });
  }

  try {
    const { results } = await env.DB.prepare("SELECT * FROM pricing_settings ORDER BY category, key").all();
    if (!results || results.length === 0) {
      return jsonResponse({ pricing: DEFAULT_PRICING });
    }
    return jsonResponse({ pricing: results });
  } catch (err) {
    return jsonResponse({ pricing: DEFAULT_PRICING });
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const authHeader = request.headers.get("Authorization");
  const adminSecret = env.ADMIN_SECRET || "admin123";

  if (!authHeader || authHeader !== `Bearer ${adminSecret}`) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  try {
    const { prices } = await request.json(); // array of { key, price }
    if (!prices || !Array.isArray(prices)) {
      return jsonResponse({ error: "Invalid pricing payload" }, 400);
    }

    if (env.DB) {
      const stmt = env.DB.prepare("UPDATE pricing_settings SET price = ? WHERE key = ?");
      for (const p of prices) {
        await stmt.bind(parseFloat(p.price) || 0.0, p.key).run();
      }
    }

    return jsonResponse({ success: true, message: "Prices updated successfully" });
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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
  });
}
