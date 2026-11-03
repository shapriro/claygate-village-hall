import urllib.request
import re

req = urllib.request.Request('https://www.claygatevillagehall.co.uk/bookings', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Wix HTML apps / components often look like https://www-claygatevillagehall-co-uk.filesusr.com/html/...
html_comps = re.findall(r'https://[^\s"\'<>]+\.filesusr\.com/html/[^\s"\'<>]+', html)
print("HTML Components:", set(html_comps))

# Check for any src or href containing 2.hallmaster or hallmaster or similar
all_srcs = re.findall(r'(?:src|href)=["\']([^"\']+)["\']', html)
candidates = [s for s in all_srcs if not s.endswith('.js') and not s.endswith('.css') and not 'wix' in s]
print("Other srcs/hrefs:", candidates[:20])

# Check json data for embedded calendar URL
for m in re.finditer(r'"url":"([^"]+)"', html):
    url = m.group(1)
    if any(k in url.lower() for k in ['hall', 'sched', 'calendar', 'master', 'html']):
        print("Found URL in JSON:", url)
