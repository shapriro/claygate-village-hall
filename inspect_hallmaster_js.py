import urllib.request
import re

url = 'https://v2.hallmaster.co.uk/Scheduler/View/10954'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Search for FullCalendar options or AJAX calls
scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
for s in scripts:
    if 'calendar' in s.lower() or 'scheduler' in s.lower():
        for line in s.split('\n'):
            if any(k in line.lower() for k in ['events', 'url:', 'ajax', 'json', 'source']):
                print(line.strip())
