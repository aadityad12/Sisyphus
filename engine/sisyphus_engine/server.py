"""Local HTTP API the desktop UI talks to."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import versioning

app = FastAPI(title="SIsyphus engine")

app.add_middleware(
    CORSMiddleware,
    # Vite dev server and the Tauri webview origins.
    allow_origins=["http://localhost:1420", "tauri://localhost", "http://tauri.localhost"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "versions": versioning.current_versions()}
