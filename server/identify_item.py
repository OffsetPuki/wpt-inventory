#!/usr/bin/env python3
"""
AI Item Identifier for WPT Inventory Locator.

Reads a JSON payload from stdin:
  { "photoBase64": "data:image/...;base64,...",
    "categories": ["electric", ...],
    "equipmentTypes": [{"key": "...", "label": "..."}, ...] }

Calls Claude's vision API to identify the part and prints a JSON result:
  { "name", "category", "equipmentType"|null, "partNumber"|null, "customAttrs" }

Set ANTHROPIC_API_KEY in the environment to enable real identification.
Without a key (or on any error) it prints a safe placeholder so the UI keeps working.
"""

import sys
import os
import json
import re
import urllib.request

DEFAULT_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
API_URL = "https://api.anthropic.com/v1/messages"


def fallback(categories):
    cats = categories or ["electric", "welder", "it", "raw_materials", "tools"]
    cat = "tools" if "tools" in cats else cats[0]
    return {
        "name": "Unidentified Item",
        "category": cat,
        "equipmentType": None,
        "customAttrs": {},
        "partNumber": None,
    }


def parse_data_url(data_url):
    """Return (media_type, base64_data) from a data URL or raw base64."""
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.*)$", data_url, re.DOTALL)
    if m:
        return m.group(1), m.group(2)
    return "image/jpeg", data_url


def coerce_result(raw, categories, equipment_keys):
    """Validate/normalize the model's JSON into our shape."""
    out = fallback(categories)
    if isinstance(raw.get("name"), str) and raw["name"].strip():
        out["name"] = raw["name"].strip()
    cat = raw.get("category")
    if isinstance(cat, str) and cat in categories:
        out["category"] = cat
    eq = raw.get("equipmentType")
    out["equipmentType"] = eq if isinstance(eq, str) and eq in equipment_keys else None
    pn = raw.get("partNumber")
    out["partNumber"] = pn.strip() if isinstance(pn, str) and pn.strip() else None
    attrs = raw.get("customAttrs")
    out["customAttrs"] = attrs if isinstance(attrs, dict) else {}
    return out


def identify(payload):
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    categories = payload.get("categories") or ["electric", "welder", "it", "raw_materials", "tools"]
    equipment = payload.get("equipmentTypes") or []
    equipment_keys = [e.get("key") for e in equipment if isinstance(e, dict)]

    if not api_key:
        return fallback(categories)

    media_type, b64 = parse_data_url(payload.get("photoBase64", ""))
    if not b64:
        return fallback(categories)

    eq_desc = ", ".join(f'{e.get("key")} ({e.get("label")})' for e in equipment) or "none"
    prompt = (
        "You are identifying an industrial part for an ASME pressure-equipment "
        "manufacturer (autoclaves, ovens, presses, controls). Look at the photo and "
        "respond with ONLY a JSON object, no prose, no markdown fences, with keys:\n"
        '  "name": short descriptive name,\n'
        f'  "category": one of {json.dumps(categories)},\n'
        f'  "equipmentType": one of these keys or null: {eq_desc},\n'
        '  "partNumber": visible part number or null,\n'
        '  "customAttrs": object of any readable specs (may be empty {}).\n'
        "Return only the JSON object."
    )

    body = json.dumps({
        "model": DEFAULT_MODEL,
        "max_tokens": 512,
        "temperature": 0,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}},
                {"type": "text", "text": prompt},
            ],
        }],
    }).encode("utf-8")

    req = urllib.request.Request(API_URL, data=body, method="POST")
    req.add_header("x-api-key", api_key)
    req.add_header("anthropic-version", "2023-06-01")
    req.add_header("content-type", "application/json")

    with urllib.request.urlopen(req, timeout=45) as resp:
        data = json.loads(resp.read().decode("utf-8"))

    text = "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.DOTALL).strip()
    raw = json.loads(text)
    return coerce_result(raw, categories, equipment_keys)


def main():
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except Exception:
        payload = {}
    try:
        result = identify(payload)
    except Exception:
        # Any failure (network, parse, auth) degrades gracefully to the stub.
        result = fallback(payload.get("categories"))
    print(json.dumps(result))


if __name__ == "__main__":
    main()
