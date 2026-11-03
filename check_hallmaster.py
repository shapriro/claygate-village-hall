import urllib.request
import re

urls = [
    'https://www.claygatevillagehall.co.uk/',
    'https://www.claygatevillagehall.co.uk/calendar',
    'https://www.claygatevillagehall.co.uk/regular-activities',
    'https://www.claygatevillagehall.co.uk/how-to-book',
    'https://www.claygatevillagehall.co.uk/information-for-hirers'
]

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}

for u in urls:
    try:
        req = urllib.request.Request(u, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            text = resp.read().decode('utf-8', errors='ignore')
            print(f"=== {u} (length: {len(text)}) ===")
            
            # Find any references to booking systems
            for keyword in ['hallmaster', 'hallbooking', 'iframe', 'scheduler', 'google.com/calendar']:
                pos = [m.start() for m in re.finditer(keyword, text, re.IGNORECASE)]
                if pos:
                    print(f"Found keyword '{keyword}' at {len(pos)} locations:")
                    for p in pos[:3]:
                        snippet = text[max(0, p-60):min(len(text), p+140)].replace('\n', ' ')
                        print(f"   ... {snippet} ...")
    except Exception as e:
        print(f"Error {u}: {e}")
