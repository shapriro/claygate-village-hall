import urllib.request
import re

url = 'https://v2.hallmaster.co.uk/js/scheduler?v=36R53Bh0_uAiBj18xlxx-70WsaM'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    js = resp.read().decode('utf-8', errors='ignore')

# Search for url strings inside the file
urls = re.findall(r'url\s*:\s*["\']([^"\']+)["\']', js)
print("URLs in scheduler.js:", urls)

# Search for any ajax requests
for line in js.split(';'):
    if 'ajax' in line.lower() or 'getjson' in line.lower() or '/scheduler/' in line.lower():
        if len(line) < 300:
            print("Ajax snippet:", line.strip())
