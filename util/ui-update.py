import json
import urllib.request
import websocket
import sys

def open_extensions_tab():
    try:
        req = urllib.request.Request("http://localhost:9222/json/new?chrome://extensions/", method="PUT")
        res = urllib.request.urlopen(req)
        return json.loads(res.read())
    except Exception as e:
        print(f"Error opening tab: {e}")
        return None

def click_update_via_cdp(ws_url):
    ws = websocket.WebSocket()
    # Suppress origin error by passing an empty or localhost origin explicitly
    ws.connect(ws_url, suppress_origin=True)
    
    # We execute JS inside the tab to navigate the Shadow DOM and click the update button
    js_code = """
    (() => {
        const manager = document.querySelector('extensions-manager');
        if (!manager) return "Extensions manager not found";
        
        const toolbar = manager.shadowRoot.querySelector('extensions-toolbar');
        if (!toolbar) return "Extensions toolbar not found";
        
        const updateBtn = toolbar.shadowRoot.querySelector('#updateNow');
        if (!updateBtn) return "Update button not found";
        
        updateBtn.click();
        return "Clicked update successfully!";
    })();
    """
    
    msg = {
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {
            "expression": js_code,
            "returnByValue": True
        }
    }
    
    ws.send(json.dumps(msg))
    result = ws.recv()
    ws.close()
    
    parsed = json.loads(result)
    print("UI Ops Update Response:", parsed.get('result', {}).get('result', {}).get('value'))

if __name__ == "__main__":
    # check if extensions tab is already open
    req = urllib.request.Request("http://localhost:9222/json")
    try:
        res = urllib.request.urlopen(req)
        targets = json.loads(res.read())
    except Exception as e:
        print(f"Could not connect to Chrome debugging port: {e}")
        sys.exit(1)
        
    ext_page = next((t for t in targets if t['url'].startswith('chrome://extensions')), None)
    
    if not ext_page:
        print("Extensions page not open, opening it...")
        ext_page = open_extensions_tab()
        import time
        time.sleep(1) # wait for shadow DOM to initialize
        
    if ext_page and 'webSocketDebuggerUrl' in ext_page:
        ws_url = ext_page['webSocketDebuggerUrl']
        print(f"Connecting to CDP: {ws_url}")
        click_update_via_cdp(ws_url)
    else:
        print("Failed to find or open Extensions page.")
