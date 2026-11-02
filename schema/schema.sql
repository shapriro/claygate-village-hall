-- Claygate Village Hall Bookings Schema for Cloudflare D1
CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_code TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    organization TEXT,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT,
    room TEXT NOT NULL,              -- 'main_hall', 'small_hall', 'committee_room', 'entire_venue'
    event_type TEXT NOT NULL,        -- 'private_party', 'fitness_class', 'meeting', 'performance', 'wedding_reception', 'other'
    event_date TEXT NOT NULL,        -- YYYY-MM-DD
    start_time TEXT NOT NULL,        -- HH:MM
    end_time TEXT NOT NULL,          -- HH:MM
    guest_count INTEGER DEFAULT 0,
    requires_stage INTEGER DEFAULT 0,-- 1 or 0
    requires_kitchen INTEGER DEFAULT 0,
    special_requirements TEXT,
    status TEXT DEFAULT 'pending',   -- 'pending', 'confirmed', 'declined', 'cancelled'
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(reference_code);
