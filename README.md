# Cloud-Based File Smart Management System

Cloud-native document management platform built with Flask and Supabase. The system ingests user files, extracts text, classifies content, stores metadata, and supports secure multi-user access with search, sharing, and admin management features.

## Live Deployment

Production URL: https://cloud-file-smart-management.onrender.com/

## Overview

This project provides an end-to-end workflow for smart document handling:

- Authentication-based user access
- Multi-file upload with asynchronous background processing
- OCR and text extraction from common document formats
- Rule-driven classification using cloud-managed categories
- Cloud storage organization by user and category
- Metadata persistence in Supabase Postgres
- Hybrid search (keyword + semantic)
- Duplicate and near-duplicate handling
- Signed URL download/share flow
- Admin dashboard for global document and category operations

## Core Features

1. Secure multi-user login and signup
2. Document ingestion for PDF, DOCX, TXT, PNG, JPG, JPEG
3. OCR support via Tesseract for image-based text
4. Automatic category classification and confidence scoring
5. User-level storage quota enforcement (50 MB)
6. Background job tracking for upload/classification status
7. Hybrid search:
   - keyword full-text search
   - semantic retrieval
   - hybrid merge mode
8. Summary generation for extracted content
9. Exact and near-duplicate detection
10. User file actions:
   - download via signed URL
   - share via signed URL
   - delete own files
11. Admin functionality:
   - stats and document overview
   - document edit/delete
   - category create/update/delete

## Architecture

### Application Layer

- Flask application server (`app.py`)
- Background processing via local worker threads
- Service-oriented design in `services/`

### Data and Storage Layer

- Supabase Postgres for document metadata and category rules
- Supabase Storage bucket for file objects
- Row-level security policies for user isolation

### Processing Layer

- `TextExtractorService` for format-specific extraction
- `OCRService` for image OCR
- `PDFService` for PDF text extraction
- `classifier_service` for rule-based classification
- `SemanticSearchService` for semantic retrieval and similarity
- `SummarizerService` for extractive summaries

## Technology Stack

- Backend: Flask, Python
- Cloud DB/Storage/Auth: Supabase
- OCR: Tesseract + `pytesseract`
- Document parsing: PyMuPDF, python-docx, Pillow
- Production server: Gunicorn
- Deployment: Render (Docker)

## Repository Structure

```text
app.py
requirements.txt
Dockerfile
render.yaml
run_migration.py
services/
  classifier_service.py
  database_service.py
  ocr_service.py
  pdf_service.py
  semantic_service.py
  summarizer_service.py
  text_extractor_service.py
sql/
  add_created_by_column.sql
  add_documents_category_confidence.sql
  add_owner_user_id_column.sql
  add_documents_summary_and_hash_columns.sql
  add_permanent_rls_policies.sql
static/
  css/
  js/
templates/
  index.html
  login.html
  admin.html
```

## Local Development

1. Install dependencies

```bash
pip install -r requirements.txt
```

2. Run the app

```bash
python app.py
```

3. Open in browser

```text
http://127.0.0.1:5000
```

## Database and Storage Setup (Supabase)

1. Create/verify tables:
- `documents`
- `document_categories`

2. Create storage bucket:
- `documents`

3. Apply SQL migrations from the `sql/` directory.

4. Apply permanent RLS policies:
- `sql/add_permanent_rls_policies.sql`

## API Surface (High-Level)

### Authentication

- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`

### User Operations

- `POST /api/classify`
- `GET /api/jobs/<job_id>`
- `GET /search`
- `GET /api/my-documents`
- `DELETE /api/my-documents`
- `GET /api/user/stats`
- `GET /api/download`
- `GET /api/share`

### Admin Operations

- `GET /api/admin/stats`
- `GET /api/admin/documents`
- `GET /api/admin/documents/<doc_id>`
- `PUT /api/admin/documents/<doc_id>`
- `DELETE /api/admin/documents/<doc_id>`
- `GET /api/admin/categories`
- `POST /api/admin/categories`
- `PUT /api/admin/categories/<cat_id>`
- `DELETE /api/admin/categories/<cat_id>`

### Health

- `GET /api/health/supabase`

## Search Modes

`/search?q=<query>&mode=<mode>` supports:

- `keyword`: full-text search
- `semantic`: similarity-based retrieval
- `hybrid`: merged ranking (default)

## Deployment

This repository includes production deployment files:

- `Dockerfile`
- `.dockerignore`
- `render.yaml`

Recommended host: Render (Docker runtime).

Deployment checklist:

1. Push repository to GitHub.
2. Create Render service from `render.yaml` (Blueprint) or Dockerfile.
3. Configure required runtime variables in hosting platform.
4. Deploy and validate health endpoint.
5. Execute smoke test (login, upload, search, download/share, delete, admin).

## Operational Notes

- Startup includes backend key validation checks.
- User token refresh flow is supported.
- Background processing currently uses in-memory job state.
- For horizontal scaling, move queue/state to shared infrastructure.

## Troubleshooting

### Upload 403 (`new row violates row-level security policy`)

Check:

1. Storage and table RLS policies are correctly applied.
2. Bucket path conventions match policy (`users/<uid>/...`).
3. Backend is using service-role context for storage/table operations.

### Auth 401 (`token is expired`)

Check:

1. Client session refresh flow is active.
2. Browser stores both access and refresh tokens.

### OCR issues

Check:

1. Tesseract is installed in runtime image.
2. OCR command path is valid in runtime environment.

## Academic Context

This project demonstrates practical cloud-computing concepts:

- managed cloud database/storage integration
- secure multi-tenant access control
- asynchronous backend processing
- production deployment and operational readiness
- search and intelligence features on top of cloud data

## License

No license has been specified for this repository.
