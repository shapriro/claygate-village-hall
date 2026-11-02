"""
Claygate Village Hall - Local Development Server
Emulates Cloudflare Pages & Cloudflare D1 locally using Python SQLite.
Includes recurring schedule awareness & Admin Pricing Configuration.
"""

import http.server
import socketserver
import json
import sqlite3
import os
import random
import string
from datetime import datetime
from urllib.parse import urlparse, parse_qs

PORT = 8080
DB_FILE = "local_dev.sqlite3"

def init_db():
    conn = sqlite3.connect(DB_FILE)
    cur = conn.cursor()
    
    # 1. Bookings table
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

    # 2. Regular recurring timetable
    cur.execute("""
    CREATE TABLE IF NOT EXISTS regular_schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        activity_name TEXT NOT NULL,
        organization TEXT,
        day_of_week INTEGER NOT NULL,
        room TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL
    );
    """)

    # 3. Pricing Settings
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

    # Seed regular schedules if empty
    cur.execute("SELECT COUNT(*) FROM regular_schedules")
    if cur.fetchone()[0] == 0:
        schedules = [
            ('Claygate Montessori Nursery', 'Claygate Montessori School', 1, 'small_hall', '08:30', '13:00'),
            ('Claygate Montessori Nursery', 'Claygate Montessori School', 2, 'small_hall', '08:30', '13:00'),
            ('Claygate Montessori Nursery', 'Claygate Montessori School', 3, 'small_hall', '08:30', '13:00'),
            ('Claygate Montessori Nursery', 'Claygate Montessori School', 4, 'small_hall', '08:30', '13:00'),
            ('Claygate Montessori Nursery', 'Claygate Montessori School', 5, 'small_hall', '08:30', '13:00'),
            ('Little Kickers (Ages 1.5 - 5)', 'Little Kickers', 1, 'main_hall', '09:00', '12:00'),
            ('Claygate Dramatic Society Rehearsal', 'Claygate Dramatic Society', 1, 'main_hall', '19:30', '22:30'),
            ('Impact Dance Studios (Youth Dance)', 'Impact Dance Studios', 2, 'main_hall', '15:30', '18:30'),
            ('Claygate Community Pilates', 'Surrey Fitness & Pilates', 2, 'main_hall', '19:00', '21:00'),
            ('Monkey Music (Toddlers & Babies)', 'Monkey Music Elmbridge', 3, 'small_hall', '09:30', '12:30'),
            ('Impact Dance Studios', 'Impact Dance Studios', 3, 'main_hall', '16:00', '18:30'),
            ('Fairy Footsteps Pre-School Ballet', 'Fairy Footsteps', 4, 'small_hall', '09:30', '12:00'),
            ('Impact Dance Studios', 'Impact Dance Studios', 4, 'main_hall', '16:00', '18:30'),
            ('Claygate Dramatic Society Rehearsal', 'Claygate Dramatic Society', 4, 'main_hall', '19:30', '22:30'),
            ('Surrey Singing School', 'Surrey Singing & Drama', 5, 'main_hall', '16:00', '19:00'),
            ('Impact Dance Studios Saturday Class', 'Impact Dance Studios', 6, 'main_hall', '09:00', '13:00')
        ]
        cur.executemany("""
            INSERT INTO regular_schedules (activity_name, organization, day_of_week, room, start_time, end_time)
            VALUES (?, ?, ?, ?, ?, ?)
        """, schedules)

    conn.commit()
    conn.close()

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
        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # 1. Availability check: returns both one-off bookings and recurring timetable blocks
        if params.get("availability", ["0"])[0] == "1":
            date_str = params.get("date", [""])[0]
            room = params.get("room", [""])[0]

            busy_slots = []

            # 1a. One-off bookings
            if room and room != "entire_venue":
                query = """
                SELECT room, start_time, end_time, status, 'One-off Booking' as title
                FROM bookings 
                WHERE event_date = ? 
                  AND status IN ('confirmed', 'pending')
                  AND (room = ? OR room = 'entire_venue')
                ORDER BY start_time ASC
                """
                cur.execute(query, (date_str, room))
            else:
                query = """
                SELECT room, start_time, end_time, status, 'One-off Booking' as title
                FROM bookings 
                WHERE event_date = ? 
                  AND status IN ('confirmed', 'pending')
                ORDER BY start_time ASC
                """
                cur.execute(query, (date_str,))
            
            for row in cur.fetchall():
                busy_slots.append(dict(row))

            # 1b. Recurring regular timetable
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
                day_of_week = dt.isoweekday()
                schema_dow = 0 if day_of_week == 7 else day_of_week

                if room and room != "entire_venue":
                    cur.execute("""
                        SELECT room, start_time, end_time, 'confirmed' as status, activity_name as title
                        FROM regular_schedules
                        WHERE day_of_week = ?
                          AND (room = ? OR room = 'entire_venue')
                    """, (schema_dow, room))
                else:
                    cur.execute("""
                        SELECT room, start_time, end_time, 'confirmed' as status, activity_name as title
                        FROM regular_schedules
                        WHERE day_of_week = ?
                    """, (schema_dow,))

                for row in cur.fetchall():
                    busy_slots.append(dict(row))

            except ValueError:
                pass

            conn.close()
            return self.send_json({"bookedSlots": busy_slots})

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

        required = ["full_name", "email", "phone", "room", "event_type", "event_date", "start_time", "end_time"]
        for f in required:
            if not data.get(f):
                return self.send_json({"error": f"Missing required field: {f}"}, 400)

        if data["start_time"] >= data["end_time"]:
            return self.send_json({"error": "End time must be after start time"}, 400)

        conn = sqlite3.connect(DB_FILE)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()

        # Check overlap
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

        if not conflict:
            try:
                dt = datetime.strptime(data["event_date"], "%Y-%m-%d")
                dow = 0 if dt.isoweekday() == 7 else dt.isoweekday()
                if data["room"] == "entire_venue":
                    cur.execute("""
                        SELECT activity_name, room, start_time, end_time 
                        FROM regular_schedules 
                        WHERE day_of_week = ? 
                          AND start_time < ? 
                          AND end_time > ?
                        LIMIT 1
                    """, (dow, data["end_time"], data["start_time"]))
                else:
                    cur.execute("""
                        SELECT activity_name, room, start_time, end_time 
                        FROM regular_schedules 
                        WHERE day_of_week = ? 
                          AND (room = ? OR room = 'entire_venue')
                          AND start_time < ? 
                          AND end_time > ?
                        LIMIT 1
                    """, (dow, data["room"], data["end_time"], data["start_time"]))
                conflict = cur.fetchone()
            except ValueError:
                pass

        if conflict:
            conn.close()
            reason = conflict['activity_name'] if 'activity_name' in conflict.keys() else 'existing reservation'
            return self.send_json({
                "error": f"Clash with {reason} ({conflict['start_time']} - {conflict['end_time']}). Please choose different hours."
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
