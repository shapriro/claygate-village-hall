"""
Claygate Village Hall - Local Development Server
Emulates Cloudflare Pages & Cloudflare D1 locally.
Directly synchronizes with Hallmaster Live API (Venue 10954).
"""

import http.server
import socketserver
import json
import sqlite3
import os
import random
import string
import urllib.request
import urllib.parse
from datetime import datetime
from urllib.parse import urlparse, parse_qs

PORT = 8080
DB_FILE = "local_dev.sqlite3"
HALLMASTER_VENUE_ID = 10954
HALLMASTER_ROOMS = {
    "main_hall": "15520",
    "small_hall": "15521",
    "committee_room": "15522",
    "entire_venue": "0"
}

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    
    cur.execute("""
    CREATE TABLE IF NOT EXISTS bookings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reference_code TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        organization TEXT,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT,
        room TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        guest_count INTEGER DEFAULT 0,
        requires_stage INTEGER DEFAULT 0,
        requires_kitchen INTEGER DEFAULT 0,
        special_requirements TEXT,
        estimated_cost REAL DEFAULT 0.0,
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS pricing_settings (
        key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL NOT NULL,
        unit TEXT NOT NULL
    );
    """)

    cur.execute("SELECT COUNT(*) FROM pricing_settings")
    if cur.fetchone()[0] == 0:
        default_prices = [
            ('rate_main_hall', 'Main Hall', 'room_rate', 16.00, 'per_hour'),
            ('rate_small_hall', 'Small Hall', 'room_rate', 11.00, 'per_hour'),
            ('rate_committee_room', 'Committee Room', 'room_rate', 8.00, 'per_hour'),
            ('rate_entire_venue', 'Entire Complex', 'room_rate', 25.00, 'per_hour'),
            ('rate_stage_av', 'Stage Lighting & PA System', 'addon', 25.00, 'per_event'),
            ('rate_kitchen_commercial', 'Commercial Kitchen & Cooker/Dishwasher', 'addon', 10.00, 'per_event'),
            ('rate_deposit', 'Refundable Security Deposit', 'deposit', 50.00, 'flat')
        ]
        cur.executemany("INSERT OR REPLACE INTO pricing_settings VALUES (?, ?, ?, ?, ?)", default_prices)

    conn.commit()
    conn.close()

def fetch_hallmaster_bookings(date_str, room):
    """Fetch live bookings from Hallmaster for this date and room."""
    hm_room_id = HALLMASTER_ROOMS.get(room, "0")
    params = {
        "start": f"{date_str}T00:00:00Z",
        "end": f"{date_str}T23:59:59Z",
        "roomId": hm_room_id,
        "custView": "false",
        "HallId": str(HALLMASTER_VENUE_ID),
        "groupRooms": "false"
    }
    url = "https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?" + urllib.parse.urlencode(params)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Referer": f"https://v2.hallmaster.co.uk/Scheduler/View/{HALLMASTER_VENUE_ID}",
        "X-Requested-With": "XMLHttpRequest"
    }

    results = []
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for b in data:
                s = b["start"].split("T")[1][:5]
                e = b["end"].split("T")[1][:5]
                results.append({
                    "start_time": s,
                    "end_time": e,
                    "status": "confirmed",
                    "title": b.get("title") or "Hallmaster Booking",
                    "source": "hallmaster"
                })
    except Exception as e:
        print("Hallmaster sync error:", e)
    return results

class LocalDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="public", **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/pricing":
            self.handle_pricing_get()
        elif parsed.path.startswith("/api/bookings"):
            self.handle_api_get(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/pricing":
            self.handle_pricing_post()
        elif parsed.path == "/api/bookings":
            self.handle_api_post()
        else:
            self.send_error(404, "Endpoint not found")

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bookings":
            self.handle_api_patch()
        else:
            self.send_error(404, "Endpoint not found")

    def handle_pricing_get(self):
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        cur.execute("SELECT * FROM pricing_settings ORDER BY category, key")
        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return self.send_json({"pricing": rows})

    def handle_pricing_post(self):
        auth = self.headers.get("Authorization", "")
        if auth != "Bearer admin123":
            return self.send_json({"error": "Unauthorized"}, 401)

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        data = json.loads(body)

        conn = sqlite3.connect(DB_FILE)
        cur = conn.cursor()
        for p in data.get("prices", []):
            cur.execute("UPDATE pricing_settings SET price = ? WHERE key = ?", (float(p.get("price", 0)), p.get("key")))
        conn.commit()
        conn.close()
        return self.send_json({"success": True})

    def handle_api_get(self, parsed):
        params = parse_qs(parsed.query)

        # 1. LIVE AVAILABILITY CHECK FROM HALLMASTER
        if params.get("availability", ["0"])[0] == "1":
            date_str = params.get("date", [""])[0]
            room = params.get("room", ["main_hall"])[0]

            busy_slots = fetch_hallmaster_bookings(date_str, room)

            # Also add pending local inquiries from DB
            conn = sqlite3.connect(DB_FILE)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            if room and room != "entire_venue":
                cur.execute("""
                    SELECT room, start_time, end_time, status, 'Website Inquiry' as title
                    FROM bookings 
                    WHERE event_date = ? 
                      AND status IN ('confirmed', 'pending')
                      AND (room = ? OR room = 'entire_venue')
                    ORDER BY start_time ASC
                """, (date_str, room))
            else:
                cur.execute("""
                    SELECT room, start_time, end_time, status, 'Website Inquiry' as title
                    FROM bookings 
                    WHERE event_date = ? 
                      AND status IN ('confirmed', 'pending')
                    ORDER BY start_time ASC
                """, (date_str,))

            for row in cur.fetchall():
                busy_slots.append(dict(row))
            conn.close()

            return self.send_json({"bookedSlots": busy_slots})

        # 2. Admin get bookings
        auth = self.headers.get("Authorization", "")
        if auth != "Bearer admin123":
            return self.send_json({"error": "Unauthorized"}, 401)

        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        status_filter = params.get("status", [""])[0]
        if status_filter:
            cur.execute("SELECT * FROM bookings WHERE status = ? ORDER BY created_at DESC", (status_filter,))
        else:
            cur.execute("SELECT * FROM bookings ORDER BY created_at DESC")

        rows = [dict(r) for r in cur.fetchall()]
        conn.close()
        return self.send_json({"bookings": rows})

    def handle_api_post(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        data = json.loads(body)

        required = ["full_name", "email", "phone", "room", "event_type", "event_date", "start_time", "end_time"]
        for f in required:
            if not data.get(f):
                return self.send_json({"error": f"Missing required field: {f}"}, 400)

        if data["start_time"] >= data["end_time"]:
            return self.send_json({"error": "End time must be after start time"}, 400)

        # 1. Hallmaster collision check
        hm_bookings = fetch_hallmaster_bookings(data["event_date"], data["room"])
        for b in hm_bookings:
            if data["start_time"] < b["end_time"] and data["end_time"] > b["start_time"]:
                return self.send_json({
                    "error": f"Clash with Hallmaster live reservation ({b['start_time']} - {b['end_time']}). Please select another time."
                }, 409)

        # 2. DB collision check
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        if data["room"] == "entire_venue":
            cur.execute("""
                SELECT id, room, start_time, end_time 
                FROM bookings 
                WHERE event_date = ? 
                  AND status IN ('confirmed', 'pending')
                  AND start_time < ? 
                  AND end_time > ?
                LIMIT 1
            """, (data["event_date"], data["end_time"], data["start_time"]))
        else:
            cur.execute("""
                SELECT id, room, start_time, end_time 
                FROM bookings 
                WHERE event_date = ? 
                  AND status IN ('confirmed', 'pending')
                  AND (room = ? OR room = 'entire_venue')
                  AND start_time < ? 
                  AND end_time > ?
                LIMIT 1
            """, (data["event_date"], data["room"], data["end_time"], data["start_time"]))

        conflict = cur.fetchone()
        if conflict:
            conn.close()
            return self.send_json({
                "error": f"Clash with existing reservation ({conflict['start_time']} - {conflict['end_time']}). Please choose different hours."
            }, 409)

        ref_code = "CVH-" + "".join(random.choices(string.ascii_uppercase + string.digits, k=6))

        cur.execute("""
            INSERT INTO bookings (
                reference_code, full_name, organization, email, phone, address,
                room, event_type, event_date, start_time, end_time, guest_count,
                requires_stage, requires_kitchen, special_requirements, estimated_cost, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
        """, (
            ref_code,
            data["full_name"],
            data.get("organization"),
            data["email"],
            data["phone"],
            data.get("address"),
            data["room"],
            data["event_type"],
            data["event_date"],
            data["start_time"],
            data["end_time"],
            int(data.get("guest_count", 0)),
            1 if data.get("requires_stage") else 0,
            1 if data.get("requires_kitchen") else 0,
            data.get("special_requirements"),
            float(data.get("estimated_cost", 0.0))
        ))
        conn.commit()
        conn.close()

        return self.send_json({
            "success": True,
            "reference_code": ref_code,
            "hallmaster_venue_id": HALLMASTER_VENUE_ID,
            "message": "Booking received and synchronized"
        }, 201)

    def handle_api_patch(self):
        auth = self.headers.get("Authorization", "")
        if auth != "Bearer admin123":
            return self.send_json({"error": "Unauthorized"}, 401)

        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        data = json.loads(body)

        conn = sqlite3.connect(DB_FILE)
        cur = conn.cursor()
        cur.execute("""
            UPDATE bookings 
            SET status = COALESCE(?, status), 
                admin_notes = COALESCE(?, admin_notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (data.get("status"), data.get("admin_notes"), data.get("id")))
        conn.commit()
        conn.close()

        return self.send_json({"success": True})

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

if __name__ == "__main__":
    init_db()
    print(f"🚀 Claygate Village Hall local server started at http://localhost:{PORT}")
    print(f"   - Connected to Hallmaster Live API (Venue ID: {HALLMASTER_VENUE_ID})")
    print("   - Public Website: http://localhost:8080/index.html")
    print("   - Booking Form:   http://localhost:8080/booking.html")
    print("   - Admin Portal:   http://localhost:8080/admin.html (Password: admin123)")
    with socketserver.TCPServer(("", PORT), LocalDevHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
