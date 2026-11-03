import urllib.request
import json
import urllib.parse

# Test /api/Scheduler/GetBookings with the exact params FullCalendar sends
params = {
    'start': '2026-11-01T00:00:00Z',
    'end': '2026-12-01T00:00:00Z',
    'roomId': '0',
    'custView': 'false',
    'HallId': '10954',
    'groupRooms': 'false'
}

url = "https://v2.hallmaster.co.uk/api/Scheduler/GetBookings?" + urllib.parse.urlencode(params)
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
        raw = resp.read().decode('utf-8')
        bookings = json.loads(raw)
        print(f"Total bookings returned: {len(bookings)}")
        for b in bookings[:10]:
            print(f"- {b.get('start')} to {b.get('end')} | Title: {b.get('title')} | Room: {b.get('roomName')} (ID: {b.get('roomId')})")
except Exception as e:
    print("Error:", e)
