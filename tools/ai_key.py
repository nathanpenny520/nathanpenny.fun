#!/usr/bin/env python3
"""Generate an API key for the private AI proxy (/api/ai).

Usage:
    python3 tools/ai_key.py <name> [monthly_limit]

Prints the plaintext key (put it in your password manager — only its SHA-256
hash is stored in D1) and a ready-to-paste SQL INSERT. Apply the SQL with:

    npx wrangler d1 execute nathanpenny --remote --command "<SQL>"

monthly_limit is a request count per calendar month (UTC); omit it for
unlimited (not recommended — a leaked key would burn upstream credit).
"""

import hashlib
import secrets
import sys


def main() -> None:
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        sys.exit(__doc__)
    name = sys.argv[1].replace("'", "''")
    limit = sys.argv[2] if len(sys.argv) == 3 else "NULL"
    if limit != "NULL" and not limit.isdigit():
        sys.exit("monthly_limit must be a non-negative integer or omitted")

    key = "npai_" + secrets.token_urlsafe(24)
    key_hash = hashlib.sha256(key.encode()).hexdigest()

    sql = (
        "INSERT INTO api_keys (name, key_hash, monthly_limit) "
        f"VALUES ('{name}', '{key_hash}', {limit});"
    )
    print(f"key : {key}")
    print(f"sql : {sql}")
    print('apply: npx wrangler d1 execute nathanpenny --remote --command "<sql>"')


if __name__ == "__main__":
    main()
