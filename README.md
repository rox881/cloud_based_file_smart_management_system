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
- Search documents using PostgreSQL full-text search via `search_vector`

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

## Environment Variables

Create a `.env` file in the project root with:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_service_role_or_server_key
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_smtp_username
SMTP_PASS=your_smtp_password
SMTP_FROM=no-reply@example.com
```

Notes:

- Share records can still be created if SMTP is not configured.
- Email delivery for shares works only when SMTP variables are set.

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

## Share API Manual Test (PowerShell)

After starting the app locally, you can test the share endpoint directly.

```powershell
$body = @{
  file_name = "sample.pdf"
  storage_path = "classified/invoice/1234_sample.pdf"
  recipient_email = "recipient@example.com"
  permission = "view"
  message = "Please review this file"
} | ConvertTo-Json

Invoke-RestMethod -Method Post \
  -Uri "http://127.0.0.1:5000/api/share" \
  -ContentType "application/json" \
  -Body $body
```

Expected response fields:

- `message`
- `share_token`
- `email_sent`
- `warning` (present when SMTP is missing or email send fails)
- `share`

## Shares Debug API (PowerShell)

Use this endpoint to fetch recent share records for troubleshooting.

```powershell
Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:5000/api/shares?limit=10"
```

Query params:

- `limit` (optional): integer from `1` to `100`, default `20`

Expected response fields:

- `shares` (array)
- `count` (number of returned rows)

## Search Behavior

Search uses PostgreSQL full-text search on `search_vector` and returns:

- `file_name`
- `folder_location`
- `file_size`
- `mime_type`
- `category`
- `confidence`
- `status`

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

## SQL Migration

To add the `category` and `confidence` columns if they are missing, run:

```sql
ALTER TABLE IF EXISTS public.documents
ADD COLUMN IF NOT EXISTS category text,
ADD COLUMN IF NOT EXISTS confidence numeric;
```

## License

No license has been specified for this repository.
