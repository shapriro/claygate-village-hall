import urllib.request
import json
import re

# Inspect how Scheduler/View/10954 configures FullCalendar
url = "https://v2.hallmaster.co.uk/Scheduler/View/10954"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Extract room mappings
rooms = re.findall(r'<option value="(\d+)">([^<]+)</option>', html)
print("Hallmaster Rooms:", rooms)

# Look for initialization variables
for line in html.split('\n'):
    if any(k in line.lower() for k in ['venueid', 'customerid', 'roomid', 'getbookings', 'events:']):
        print("Config line:", line.strip())
