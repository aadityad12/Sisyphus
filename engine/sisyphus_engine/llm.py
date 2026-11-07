"""Meta Model API client (OpenAI-compatible, https://api.meta.ai/v1)."""

import base64
import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = os.environ.get("SISYPHUS_LLM_BASE_URL", "https://api.meta.ai/v1")
DEFAULT_MODEL = os.environ.get("SISYPHUS_MODEL", "muse-wonder-1.0")


@lru_cache(maxsize=1)
def client() -> OpenAI:
    key = os.environ.get("MODEL_API_KEY")
    if not key:
        raise RuntimeError("MODEL_API_KEY is not set (put it in engine/.env)")
    return OpenAI(base_url=BASE_URL, api_key=key, timeout=600)


def image_part(path: Path) -> dict:
    data = base64.b64encode(path.read_bytes()).decode()
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{data}"}}


def complete_json(system: str, user: list[dict] | str, schema: dict, name: str, model: str | None = None) -> dict:
    """One chat call with constrained JSON output. Returns the parsed object."""
    content = [{"type": "text", "text": user}] if isinstance(user, str) else user
    resp = client().chat.completions.create(
        model=model or DEFAULT_MODEL,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": content}],
        response_format={"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}},
    )
    return json.loads(resp.choices[0].message.content)
