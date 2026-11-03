import urllib.request
import json

# Let's test calling /api/Scheduler/GetBookings for venue 10954
# FullCalendar usually sends start and end timestamps or ISO strings
url = "https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?venueId=10954&roomId=0&start=2026-11-01T00:00:00Z&end=2026-11-30T23:59:59Z"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    'Referer': 'https://v2.hallmaster.co.uk/Scheduler/View/10954',
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest'
}

req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        print("Status:", resp.status)
        data = json.loads(resp.read().decode('utf-8'))
        print(f"Retrieved {len(data)} live bookings from Hallmaster for Nov 2026!")
        if data:
            print("Sample booking:")
            print(json.dumps(data[0], indent=2))
except Exception as e:
    print("Error:", e)
