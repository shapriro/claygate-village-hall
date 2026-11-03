import urllib.request
import re

url = "https://v2.hallmaster.co.uk/Scheduler/View/10954"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Print all script tags
scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
for i, s in enumerate(scripts):
    if len(s.strip()) > 0:
        print(f"=== Script {i} ===")
        print(s[:600])
