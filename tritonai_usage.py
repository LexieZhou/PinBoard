from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


API_URL = "https://tritonai-api.ucsd.edu/key/info"
API_KEY_ENV_VAR = "TRITONAI_API_KEY"


def fetch_key_info(api_key: str, timeout: float = 10.0) -> dict:
    request = urllib.request.Request(
        API_URL,
        headers={
            "accept": "application/json",
            "authorization": f"Bearer {api_key}",
        },
        method="GET",
    )

    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def main() -> int:
    api_key = os.environ.get(API_KEY_ENV_VAR)
    if not api_key:
        print(f"error: set {API_KEY_ENV_VAR}", file=sys.stderr)
        return 2

    try:
        payload = fetch_key_info(api_key)
        info = payload["info"]
        spend = float(info["spend"])
        max_budget = float(info["max_budget"])
    except urllib.error.URLError as exc:
        print(f"error: request failed: {exc}", file=sys.stderr)
        return 1
    except (KeyError, TypeError, ValueError) as exc:
        print(f"error: unexpected response format: {exc}", file=sys.stderr)
        return 1

    print("Usage\tBudget")
    print(f"{spend:.2f}\t{max_budget:.2f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())