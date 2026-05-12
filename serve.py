import os
from http.server import HTTPServer, SimpleHTTPRequestHandler
import functools

ROOT = os.path.dirname(os.path.abspath(__file__))
Handler = functools.partial(SimpleHTTPRequestHandler, directory=ROOT)

if __name__ == '__main__':
    server = HTTPServer(("127.0.0.1", 8765), Handler)
    print(f"Serving {ROOT} at http://127.0.0.1:8765")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        server.server_close()
