import json
import urllib.request
import websocket
import sys

def get_page_ws_url():
    req = urllib.request.Request("http://localhost:9222/json")
    try:
        res = urllib.request.urlopen(req)
        targets = json.loads(res.read())
    except Exception as e:
        print(f"Failed to connect: {e}")
        return None
        
    for t in targets:
        if 'linkedin.com/jobs/search' in t['url']:
            print(f"Candidate: {t['url']} (Type: {t['type']})")
            if t['type'] == 'page':
                return t['webSocketDebuggerUrl']
    return None

def evaluate_js_in_page(ws_url, code):
    ws = websocket.WebSocket()
    ws.connect(ws_url, suppress_origin=True)
    
    msg = {
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": code,
            "returnByValue": True
        }
    }
    ws.send(json.dumps(msg))
    result = json.loads(ws.recv())
    ws.close()
    return result

if __name__ == "__main__":
    ws_url = get_page_ws_url()
    if not ws_url:
        print("LinkedIn page not found.")
        sys.exit(1)
        
    # We want to find the modal element that contains 'Contact info' or 'Apply to'
    js_code = "document.documentElement.outerHTML"
    res = evaluate_js_in_page(ws_url, js_code)
    
    html_content = res.get('result', {}).get('result', {}).get('value', 'No HTML found')
    with open('dom_dump.html', 'w', encoding='utf-8') as f:
        f.write(html_content)
    print("Dumped DOM to dom_dump.html")
