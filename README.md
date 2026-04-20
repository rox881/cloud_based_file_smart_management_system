# Cloud Based File Smart Management System

A Flask + Supabase application for uploading, classifying, storing, and searching documents with automatic text extraction and cloud-backed metadata.

## What it does

This project lets you:

- Upload files through a web UI
- Extract text from images, PDFs, TXT files, and DOCX files
- Classify documents using cloud-stored category rules from Supabase
- Move classified files into `classified/<category>/...` folders in Supabase Storage
- Keep uncategorized files in `uploads/`
- Save searchable metadata into the `documents` table
- Search documents with hybrid retrieval (PostgreSQL full-text + semantic vector similarity)
- Generate automatic extractive summaries for each uploaded document
- Detect exact duplicates (SHA-256 hash) and near-duplicates (semantic similarity)
- Enforce a per-user 50MB storage quota

## Why it exists

The goal is to build a smart file management workflow that combines:

- local Flask processing for responsiveness
- Supabase Storage for file persistence
- Supabase Postgres for searchable metadata
- Supabase-driven classification rules for easy category updates without code changes

## How it works

1. A user uploads one or more files in the browser.
2. Flask receives the files and starts a background thread immediately.
3. The background worker:
   - uploads each file to Supabase Storage
   - extracts text from the file
   - classifies the file using categories stored in Supabase
   - moves the file into a category folder if it is classified
   - writes metadata into the `documents` table
4. The browser polls job status until processing is complete.
5. Search uses the `search_vector` column to find matching documents.

## Project Structure

```text
app.py
requirements.txt
services/
  classifier_service.py
  database_service.py
  ocr_service.py
  pdf_service.py
  text_extractor_service.py
static/
  css/style.css
  js/main.js
templates/
  index.html
sql/
  add_documents_category_confidence.sql
```

## Supabase Setup

### 1. Create the tables

Create or verify these tables in Supabase:

#### `document_categories`
Columns:
- `category_name` text
- `keywords` text[]
- `extensions` text[]
- `score_weight` numeric

Example rows:

- `invoice` | `{invoice,tax,gst,amount due,bill to}` | `{pdf,png,jpg,jpeg}` | `1`
- `receipt` | `{receipt,paid,cash,total,transaction}` | `{pdf,png,jpg,jpeg}` | `1`
- `contract` | `{agreement,contract,terms,party,signature}` | `{pdf,docx,txt}` | `1`

#### `documents`
Columns:
- `file_name` text
- `folder_location` text
- `content_text` text
- `file_size` integer
- `mime_type` text
- `category` text
- `confidence` numeric
- `status` text

If needed, use the provided migration file:
- [sql/add_documents_category_confidence.sql](sql/add_documents_category_confidence.sql)

### 2. Create the storage bucket

Create a Supabase Storage bucket named:

- `documents`

The app uploads files into this bucket and then moves them into:

- `uploads/`
- `classified/<category>/`

### 3. Configure row-level security and policies

Make sure your app credentials can:

- insert into `documents`
- select from `documents`
- upload/move objects in the `documents` bucket
- read from `document_categories`

If you are using server-side service-role credentials, keep them on the backend only.

For a permanent multi-user setup, run:

- `sql/add_permanent_rls_policies.sql`

This enforces:

- users can only read/write their own rows in `documents`
- users can only access storage objects under `users/<auth.uid()>/...` in bucket `documents`

Also ensure your backend `.env` uses a valid **service_role** key for `SUPABASE_KEY`.

## Environment Variables

Create a `.env` file in the project root with:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_or_server_key
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
ADMIN_EMAILS=admin1@example.com,admin2@example.com
NEAR_DUPLICATE_THRESHOLD=0.92
```

Notes:

- The app now validates `SUPABASE_KEY` at startup and fails fast if it is not `service_role` or is expired.
- Expired user access tokens are auto-refreshed via `/api/auth/refresh` when `refresh_token` is available.

## Multi-user Security Notes

- User-facing routes now require a valid `Authorization: Bearer <access_token>` header.
- User identity is derived server-side from the access token (not from client `created_by` values).
- Download/share links are restricted to files owned by the authenticated user.
- If `documents.created_by` or `documents.owner_user_id` is unavailable, the app falls back to per-user storage path prefixes (`users/<auth_user_id>/...`) for ownership checks.
- Admin routes require the authenticated email to be listed in `ADMIN_EMAILS`.

## Local Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Start the app

```bash
python app.py
```

### 3. Open the browser

Open the local Flask URL shown in the terminal, usually:

- `http://127.0.0.1:5000`

## Search Behavior

Search supports three modes via `/search?q=...&mode=...`:

- `mode=keyword` : PostgreSQL full-text search (`search_vector`)
- `mode=semantic` : hash-embedding semantic similarity
- `mode=hybrid` (default) : merges keyword + semantic ranking

Responses return:

- `file_name`
- `folder_location`
- `file_size`
- `mime_type`
- `category`
- `confidence`
- `status`
- `summary_text` (when migration is applied)
- `semantic_score` / `search_type` (semantic or hybrid search)

## Classification Behavior

Classification is cloud-driven from `document_categories`.

The classifier:

- caches categories in memory for 5 minutes
- scores filename matches more strongly than text matches
- falls back safely if categories cannot be loaded
- keeps uncategorized files in `uploads/`
- moves classified files into `classified/<category>/`

## Notes

- OCR on images is optional and will not crash the job if it fails.
- Background uploads are non-blocking so the UI stays responsive.
- If a storage move fails, metadata is still saved with the original upload path.
- Exact duplicate files are skipped during upload when hash metadata is available.
- Near-duplicates are stored with `status=near-duplicate` and surfaced as warnings.
- Quota limit is enforced server-side at 50MB per authenticated user.

## SQL Migration

To add the `category` and `confidence` columns if they are missing, run:

```sql
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS confidence numeric;
```

For summaries and hash-based duplicate detection:

```sql
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS summary_text text,
ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON public.documents (content_hash);
```

## License

No license has been specified for this repository.
