import urllib.request
import re

url = "https://v2.hallmaster.co.uk/js/scheduler?v=36R53Bh0_uAiBj18xlxx-70WsaM"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=10) as resp:
    js = resp.read().decode('utf-8', errors='ignore')

idx = js.find("url: '/api/Scheduler/GetBookings'")
if idx != -1:
    print(js[idx:idx+600])
