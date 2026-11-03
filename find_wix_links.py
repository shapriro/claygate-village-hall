import urllib.request
import re
import json

req = urllib.request.Request('https://www.claygatevillagehall.co.uk/', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Search for site map or navigation pages in Wix JSON data
urls = re.findall(r'"pageUriSEO":"([^"]+)"', html)
print("Pages on the site:", set(urls))

# Search for any external links
ext_links = re.findall(r'https?://[^\s"\'<>]+', html)
booking_links = [l for l in ext_links if any(k in l.lower() for k in ['hall', 'book', 'master', 'sched', 'calendar'])]
print("\nBooking-related external links:")
for l in set(booking_links):
    print(" -", l)
