"""Entry-point shim so `uvicorn main:app` works from the backend/ directory.

The real app lives in app/main.py; this re-exports it.
"""
from app.main import app

__all__ = ["app"]
