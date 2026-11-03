import urllib.request
import re

req = urllib.request.Request('https://www.claygatevillagehall.co.uk/bookings', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Search for masterPage / page data json files
json_urls = re.findall(r'https://siteassets\.parastorage\.com/pages/pages/thunderbolt[^\s"\'<>]+', html)
print("Found thunderbolt pages:", len(json_urls))
for u in json_urls[:3]:
    print("Fetching page data:", u[:100])
    try:
        r2 = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(r2, timeout=10) as resp2:
            page_json = resp2.read().decode('utf-8', errors='ignore')
            # Look for external calendar URL or iframe in the thunderbolt state
            matches = re.findall(r'https?://[^\s"\'<>]+', page_json)
            scheds = [m for m in matches if any(k in m.lower() for k in ['hallmaster', 'calendar', 'booking', 'schedule', 'filesusr'])]
            print("Matches in page JSON:", set(scheds))
            for line in page_json.split(','):
                if any(k in line.lower() for k in ['hallmaster', 'iframe', 'calendar']):
                    if len(line) < 200:
                        print("  Line:", line)
    except Exception as e:
        print("Error fetching:", e)
