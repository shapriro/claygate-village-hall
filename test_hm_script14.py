import urllib.request
import re

url = "https://v2.hallmaster.co.uk/Scheduler/View/10954"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')

scripts = re.findall(r'<script[^>]*>(.*?)</script>', html, re.DOTALL)
if len(scripts) >= 15:
    print(scripts[14])
