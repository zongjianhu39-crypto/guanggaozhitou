import os, functools
from http.server import HTTPServer, SimpleHTTPRequestHandler

os.chdir(os.path.dirname(os.path.abspath(__file__)))
handler = functools.partial(SimpleHTTPRequestHandler, directory=os.getcwd())
server = HTTPServer(("", 8765), handler)
print(f"Serving on http://localhost:8765 from {os.getcwd()}")
server.serve_forever()
