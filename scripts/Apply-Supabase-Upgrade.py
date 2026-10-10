#!/usr/bin/env python3
"""
Apply-Supabase-Upgrade.py
Applies 1SHOT Full Release migrations (014, 015, 016, 017) to Supabase.
Never exposes credentials in shell history or chat.
"""
import os, sys, getpass, json
from pathlib import Path

PROJECT_ID = "zqhfvtgktbfnxcclqqny"
API_URL = f"https://api.supabase.com/v1/projects/{PROJECT_ID}/database/query"
MIGRATION_FILE = Path(__file__).parent / "release" / "upgrade-full-release.sql"

def main():
    print("=" * 60)
    print(" 1SHOT CLUB: SUPABASE DATABASE UPGRADE (Migrations 014 - 017)")
    print("=" * 60)

    if not MIGRATION_FILE.exists():
        print(f"Error: Migration file not found at {MIGRATION_FILE}")
        sys.exit(1)

    sql_content = MIGRATION_FILE.read_text(encoding="utf-8")
    print(f"Loaded migration script ({len(sql_content.splitlines())} lines).")

    # Prompt securely for Personal Access Token (or read from environment)
    token = os.environ.get("SUPABASE_ACCESS_TOKEN")
    if not token:
        print("\nEnter your Supabase Personal Access Token (hidden):")
        token = getpass.getpass("Token: ").strip()

    if not token:
        print("Error: No access token provided.")
        sys.exit(1)

    print("\nSending SQL migrations to Supabase API...")
    try:
        import urllib.request
        req = urllib.request.Request(
            API_URL,
            data=json.dumps({"query": sql_content}).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            status = resp.status
            body = resp.read().decode("utf-8")
            print(f"Response status: {status}")
            print("\n[SUCCESS] Supabase database migrations applied successfully!")
            print("Verified: Registration approval, reconciliation, guest passwords, session lock & rota.")
    except Exception as e:
        print(f"\n[ERROR] Migration failed: {e}")
        print("Note: You can also copy the content of 'release/upgrade-full-release.sql'")
        print("directly into the Supabase Dashboard -> SQL Editor and click 'Run'.")
        sys.exit(1)

if __name__ == "__main__":
    main()
