"""
Claygate Village Hall - Local Development Server
Emulates Cloudflare Pages & Cloudflare D1 locally using Python SQLite.
"""

import http.server
import socketserver
import json
import sqlite3
import os
import random
import string
from urllib.parse import urlparse, parse_qs

PORT = 8080
DB_FILE = "local_dev.sqlite3"

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
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    """)
    conn.commit()
    conn.close()

class LocalDevHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory="public", **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/bookings"):
            self.handle_api_get(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bookings":
            self.handle_api_post()
        else:
            self.send_error(404, "Endpoint not found")

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/bookings":
            self.handle_api_patch()
        else:
            self.send_error(404, "Endpoint not found")

    def handle_api_get(self, parsed):
        params = parse_qs(parsed.query)
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # 1. Availability check
        if params.get("availability", ["0"])[0] == "1":
            date = params.get("date", [""])[0]
            room = params.get("room", [""])[0]

            if room and room != "entire_venue":
                query = """
                SELECT room, start_time, end_time, status 
                FROM bookings 
                WHERE event_date = ? 
                  AND status IN ('confirmed', 'pending')
                  AND (room = ? OR room = 'entire_venue')
                ORDER BY start_time ASC
                """
                cur.execute(query, (date, room))
            else:
                query = """
                SELECT room, start_time, end_time, status 
                FROM bookings 
                WHERE event_date = ? 
                  AND status IN ('confirmed', 'pending')
                ORDER BY start_time ASC
                """
                cur.execute(query, (date,))

            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            return self.send_json({"bookedSlots": rows})

        # 2. Admin get bookings
        auth = self.headers.get("Authorization", "")
        if auth != "Bearer admin123":
            conn.close()
            return self.send_json({"error": "Unauthorized"}, 401)

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

        # Check required fields
        required = ["full_name", "email", "phone", "room", "event_type", "event_date", "start_time", "end_time"]
        for f in required:
            if not data.get(f):
                return self.send_json({"error": f"Missing required field: {f}"}, 400)

        if data["start_time"] >= data["end_time"]:
            return self.send_json({"error": "End time must be after start time"}, 400)

        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Overlap check
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
                requires_stage, requires_kitchen, special_requirements, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
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
            data.get("special_requirements")
        ))
        conn.commit()
        conn.close()

        return self.send_json({
            "success": True,
            "reference_code": ref_code,
            "message": "Booking received"
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
    print("   - Public Website: http://localhost:8080/index.html")
    print("   - Booking Form:   http://localhost:8080/booking.html")
    print("   - Admin Portal:   http://localhost:8080/admin.html (Password: admin123)")
    with socketserver.TCPServer(("", PORT), LocalDevHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down server.")
