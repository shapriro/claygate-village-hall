import urllib.request
import re

req = urllib.request.Request('https://www.claygatevillagehall.co.uk/bookings', headers={'User-Agent': 'Mozilla/5.0'})
try:
    with urllib.request.urlopen(req, timeout=10) as resp:
        html = resp.read().decode('utf-8', errors='ignore')
        print("Length of /bookings:", len(html))
        # Look for iframe src or script src
        iframes = re.findall(r'<iframe[^>]+src=["\']([^"\']+)["\']', html)
        print("iFrames on /bookings:", iframes)
        
        # Look for hallmaster or hallbookingonline or external links
        matches = re.findall(r'https?://[a-zA-Z0-9\-\.]*(?:hallmaster|hallbooking|google|scheduler)[a-zA-Z0-9\-\.\/\?\=\&_]*', html, re.I)
        print("Matches on /bookings:", set(matches))
        
        # Look for text snippet around booking
        for line in html.split('\n'):
            if any(k in line.lower() for k in ['calendar', 'booking', 'hallmaster']):
                if len(line.strip()) < 300:
                    print("Line:", line.strip())
except Exception as e:
    print("Error:", e)
