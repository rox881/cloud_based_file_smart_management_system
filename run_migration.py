"""
Applies the 'created_by' column migration to Supabase using the supabase-py client.
Strategy: insert a test row + use a stored RPC, OR fall back to printing the SQL.

Usage:
    python run_migration.py
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in .env")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- Try method 1: insert a dummy row with created_by to see if the column already exists ---
print("Checking if 'created_by' column already exists on the documents table...")

try:
    # Select only the created_by column - if this works, the column already exists
    resp = supabase.table("documents").select("id, created_by").limit(1).execute()
    print("[OK] Column 'created_by' already exists in the documents table!")
    print("No migration needed. Your table is ready.")
    sys.exit(0)
except Exception as e:
    if "created_by" in str(e).lower() or "column" in str(e).lower():
        print("Column does not exist yet. Will attempt to add it...")
    else:
        print(f"Unexpected error when probing column: {e}")

# --- Method 2: Try calling a SQL-exec RPC if it exists ---
SQL = "ALTER TABLE IF EXISTS public.documents ADD COLUMN IF NOT EXISTS created_by text;"
INDEX_SQL = "CREATE INDEX IF NOT EXISTS idx_documents_created_by ON public.documents (created_by);"

print("\nAttempting migration via supabase RPC...")
try:
    result = supabase.rpc("exec_sql", {"sql": SQL}).execute()
    print(f"[OK] ALTER TABLE succeeded: {result}")
    result2 = supabase.rpc("exec_sql", {"sql": INDEX_SQL}).execute()
    print(f"[OK] CREATE INDEX succeeded: {result2}")
    sys.exit(0)
except Exception as e:
    print(f"RPC method failed (this is normal): {e}")

# --- Method 3: Print the SQL for manual execution ---
print("\n" + "=" * 60)
print("MANUAL MIGRATION REQUIRED")
print("=" * 60)
print("The automatic migration could not run because Supabase does")
print("not expose a raw SQL RPC by default.")
print("")
print("Please run this SQL in ONE of these ways:")
print("")
print("Option A: Using psql (if you have PostgreSQL client installed):")
print(f"  psql postgresql://postgres:<DB_PASSWORD>@db.ycxeszmtmkwksxejrwbj.supabase.co:5432/postgres")
print("")
print("Option B: Using Supabase SQL Editor at:")
print("  https://supabase.com/dashboard/project/ycxeszmtmkwksxejrwbj/sql")
print("")
print("SQL to run:")
print("-" * 60)
print(SQL)
print(INDEX_SQL)
print("-" * 60)
print("")
print("After running the SQL, re-run this script to verify the column exists.")
