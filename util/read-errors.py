import json
import urllib.request
import websocket
import time
import sys

def read_extension_logs():
    req = urllib.request.Request("http://localhost:9222/json")
    try:
        res = urllib.request.urlopen(req)
        targets = json.loads(res.read())
    except Exception as e:
        print(f"Failed to connect to debug port: {e}")
        return

    # Find extension service worker
    ext_targets = [t for t in targets if t['type'] == 'service_worker' and 'chrome-extension://' in t['url']]
    
    if not ext_targets:
        print("No extension service workers found running.")
        return
        
    for target in ext_targets:
        print(f"Connecting to extension background worker: {target['url']}")
        ws_url = target['webSocketDebuggerUrl']

        ws = websocket.WebSocket()
        found_logs = False
        try:
            ws.connect(ws_url, suppress_origin=True)
            ws.send(json.dumps({"id": 1, "method": "Log.enable"}))
            ws.send(json.dumps({"id": 2, "method": "Runtime.enable"}))
            ws.settimeout(2.0)
            found_logs = False
            print("Listening for recent logs and errors...")
            while True:
                msg = ws.recv()
                data = json.loads(msg)

                if 'method' in data:
                    if data['method'] == 'Runtime.consoleAPICalled':
                        found_logs = True
                        args = data['params'].get('args', [])
                        text = " ".join([arg.get('value', str(arg)) for arg in args])
                        print(f"[CONSOLE] {data['params'].get('type').upper()}: {text}")
                    elif data['method'] == 'Runtime.exceptionThrown':
                        found_logs = True
                        exception = data['params'].get('exceptionDetails', {}).get('exception', {}).get('description', 'Unknown Exception')
                        print(f"[EXCEPTION]: {exception}")
                    elif data['method'] == 'Log.entryAdded':
                        found_logs = True
                        entry = data['params'].get('entry', {})
                        print(f"[LOG] {entry.get('level').upper()}: {entry.get('text')} - {entry.get('url', '')}")
        except websocket.WebSocketTimeoutException:
            pass
        except Exception as e:
            print(f"Connection error: {e}")
        finally:
            try:
                ws.close()
            except Exception:
                pass
        if not found_logs:
            print("No immediate runtime logs/errors detected in buffer.")

if __name__ == "__main__":
    read_extension_logs()
