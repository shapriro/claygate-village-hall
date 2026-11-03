import urllib.request
import re

url = 'https://v2.hallmaster.co.uk/Scheduler/View/10954'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

# Print external scripts
ext_js = re.findall(r'<script[^>]+src=["\']([^"\']+)["\']', html)
print("External scripts on Hallmaster:", ext_js)
