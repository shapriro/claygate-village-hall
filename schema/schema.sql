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
    estimated_cost REAL DEFAULT 0.0, -- Calculated booking price in GBP
    status TEXT DEFAULT 'pending',   -- 'pending', 'confirmed', 'declined', 'cancelled'
    admin_notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Regular weekly timetable
CREATE TABLE IF NOT EXISTS regular_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    activity_name TEXT NOT NULL,
    organization TEXT,
    day_of_week INTEGER NOT NULL,    -- 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday
    room TEXT NOT NULL,              -- 'main_hall', 'small_hall', 'committee_room', 'entire_venue'
    start_time TEXT NOT NULL,        -- HH:MM
    end_time TEXT NOT NULL,          -- HH:MM
    term_time_only INTEGER DEFAULT 1
);

-- Pricing settings table (Admin configurable)
CREATE TABLE IF NOT EXISTS pricing_settings (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,          -- 'room_rate', 'addon', 'deposit'
    price REAL NOT NULL,             -- in GBP (£)
    unit TEXT NOT NULL               -- 'per_hour', 'per_event', 'flat'
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_ref ON bookings(reference_code);
CREATE INDEX IF NOT EXISTS idx_regular_day ON regular_schedules(day_of_week);

-- Seed Default Claygate Village Hall Rates
INSERT OR REPLACE INTO pricing_settings (key, name, category, price, unit) VALUES
('rate_main_hall', 'Main Hall', 'room_rate', 16.00, 'per_hour'),
('rate_small_hall', 'Small Hall', 'room_rate', 11.00, 'per_hour'),
('rate_committee_room', 'Committee Room', 'room_rate', 8.00, 'per_hour'),
('rate_entire_venue', 'Entire Complex', 'room_rate', 25.00, 'per_hour'),
('rate_stage_av', 'Stage Lighting & PA System', 'addon', 25.00, 'per_event'),
('rate_kitchen_commercial', 'Commercial Kitchen & Cooker/Dishwasher', 'addon', 10.00, 'per_event'),
('rate_deposit', 'Refundable Security Deposit', 'deposit', 50.00, 'flat');

-- Seed Claygate Village Hall's regular timetable
INSERT INTO regular_schedules (activity_name, organization, day_of_week, room, start_time, end_time) VALUES
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
('Impact Dance Studios Saturday Class', 'Impact Dance Studios', 6, 'main_hall', '09:00', '13:00');
