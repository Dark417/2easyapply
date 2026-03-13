import re

with open('dom_dump.html', 'r', encoding='utf-8') as f:
    html = f.read()

# find all matches of Contact info
matches = [m.start() for m in re.finditer(re.escape('Contact info'), html)]
print(f"Found 'Contact info' {len(matches)} times")

for idx, p in enumerate(matches[:5]):
    start = max(0, p - 500)
    end = min(len(html), p + 500)
    print(f"\n--- Match {idx+1} ---")
    print(html[start:end])
    
print("-" * 50)
matches2 = [m.start() for m in re.finditer(re.escape('Apply to Infogain'), html)]
print(f"Found 'Apply to Infogain' {len(matches2)} times")

for idx, p in enumerate(matches2[:5]):
    start = max(0, p - 500)
    end = min(len(html), p + 500)
    print(f"\n--- Match {idx+1} ---")
    print(html[start:end])
