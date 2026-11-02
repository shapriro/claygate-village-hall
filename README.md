# Claygate Village Hall Website & Booking System

A fast, responsive community website and booking portal designed for **Claygate Village Hall** (Church Road, Claygate, Esher, Surrey, KT10 0PQ), engineered specifically for **Cloudflare Pages** and **Cloudflare D1**.

---

## 🏛️ Features

- **Public Venue Showcase (`/index.html`):**
  - Highlighting Main Hall (210 capacity theatre / 120 dinner-dance), Proscenium Stage with PA/lighting, Small Hall, Committee Room, and Commercial-Standard Kitchen.
  - Facilities breakdown (28 parking spaces, accessible facilities, Wi-Fi, licensing).
- **Public Booking Inquiries (`/booking.html`):**
  - Interactive multi-field hiring form with date/time pickers, attendee count, room selection, and add-on amenities (Stage/PA, Kitchen).
  - Automatically generates and returns a unique reference number (e.g. `CVH-XXXXXX`) to the applicant.
- **Serverless API Backend (`functions/api/bookings.js`):**
  - Cloudflare Pages Functions running on Cloudflare's edge network.
  - Supports `POST` for customer inquiry submissions, `GET` for admin booking queries, and `PATCH` for reservation confirmations/status changes.
- **Administrator Dashboard (`/admin.html`):**
  - Password/token protected admin portal (`ADMIN_SECRET`).
  - View all incoming booking requests with live status badges (`pending`, `confirmed`, `declined`).
  - Direct 1-click status actions to approve or decline reservations.
- **Database (`schema/schema.sql`):**
  - Production-ready schema for **Cloudflare D1** (serverless SQL database).

---

## 📁 Repository Structure

```text
├── public/                       # Static frontend assets served by Cloudflare Pages
│   ├── index.html                # Main landing page
│   ├── booking.html              # Customer booking inquiry form
│   ├── admin.html                # Administrator management portal
│   ├── css/
│   │   └── styles.css            # Responsive layout & styling
│   └── js/
│       ├── booking.js            # Booking form submission handler
│       └── admin.js              # Admin dashboard interaction logic
├── functions/                    # Cloudflare Pages Functions (Edge API)
│   └── api/
│       └── bookings.js           # Serverless API endpoints
├── schema/
│   └── schema.sql                # Cloudflare D1 SQL schema
├── package.json
├── .gitignore
└── README.md
```

---

## 🚀 Deploying to Cloudflare Pages

### Step 1: Connect to Cloudflare Pages
1. Push this repository to your GitHub account (or upload via Cloudflare dashboard).
2. Go to the [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
3. Select this repository:
   - **Framework preset:** `None`
   - **Build command:** (leave empty)
   - **Build output directory:** `public`

### Step 2: Create Cloudflare D1 Database
In your Cloudflare Dashboard (or via terminal):
1. Navigate to **Workers & Pages** > **D1 SQL Database**.
2. Click **Create Database**, naming it `claygate-bookings-db`.
3. In the database console, execute the SQL found in [`schema/schema.sql`](schema/schema.sql).

### Step 3: Bind D1 & Set Secret in Cloudflare Pages
1. In your Pages project, go to **Settings** > **Functions** > **D1 Database Bindings**.
2. Add a binding:
   - **Variable name:** `DB`
   - **D1 Database:** Select `claygate-bookings-db`
3. Under **Environment variables**, set:
   - `ADMIN_SECRET`: Your secure administrator password for `/admin.html` (e.g. `MySecureAdminKey2026`).

---

## 💻 Local Testing & Development

Run Python's built-in web server from the project root:

```bash
python -m http.server 8080 --directory public
```

Open your browser to:
- Website: `http://localhost:8080/index.html`
- Booking Form: `http://localhost:8080/booking.html`
- Admin Dashboard: `http://localhost:8080/admin.html` (Demo login key: `admin123`)
