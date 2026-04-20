import os
import threading
import uuid
import hashlib
import base64
import json
import time
from typing import Any

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from supabase import Client, create_client
from werkzeug.utils import secure_filename

from services.classifier_service import classify_document, set_supabase_client
from services.database_service import DatabaseService
from services.ocr_service import OCRService
from services.pdf_service import PDFService
from services.semantic_service import SemanticSearchService
from services.summarizer_service import SummarizerService
from services.text_extractor_service import TextExtractorService

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
ADMIN_EMAILS = {
    item.strip().lower()
    for item in os.getenv("ADMIN_EMAILS", "").split(",")
    if item.strip()
}

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in environment variables.")


def _decode_jwt_payload(token: str) -> dict[str, Any]:
    """Decode JWT payload without verification for startup diagnostics."""
    parts = (token or "").split(".")
    if len(parts) != 3:
        raise RuntimeError("SUPABASE_KEY is not a valid JWT format.")

    payload_b64 = parts[1]
    pad_len = (-len(payload_b64)) % 4
    payload_b64 += "=" * pad_len
    try:
        raw = base64.urlsafe_b64decode(payload_b64.encode("ascii"))
        return json.loads(raw.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"Could not decode SUPABASE_KEY payload: {exc}") from exc


def _validate_supabase_server_key(token: str) -> None:
    payload = _decode_jwt_payload(token)
    role = str(payload.get("role") or "")
    exp = int(payload.get("exp") or 0)
    now = int(time.time())

    if role != "service_role":
        raise RuntimeError(
            "SUPABASE_KEY must be the service_role key for backend upload/write operations. "
            f"Current role claim: {role or 'missing'}"
        )

    if exp and exp <= now:
        raise RuntimeError("SUPABASE_KEY JWT is expired. Replace it with a fresh service_role key.")


_validate_supabase_server_key(SUPABASE_KEY)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
auth_supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
set_supabase_client(supabase)
app = Flask(__name__)
database_service = DatabaseService(supabase, auth_client=auth_supabase)
text_extractor = TextExtractorService(OCRService(), PDFService())
semantic_search_service = SemanticSearchService()
summarizer_service = SummarizerService()

USER_QUOTA_BYTES = 50 * 1024 * 1024  # 50MB per user
NEAR_DUPLICATE_THRESHOLD = float(os.getenv("NEAR_DUPLICATE_THRESHOLD", "0.92"))

job_store: dict[str, dict[str, Any]] = {}
job_lock = threading.Lock()


def _extract_access_token() -> str:
    auth_header = (request.headers.get("Authorization", "") or "").strip()
    if auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1].strip()
    return (request.headers.get("X-Access-Token", "") or "").strip()


def _get_authenticated_user() -> tuple[dict[str, str] | None, tuple[Any, int] | None]:
    token = _extract_access_token()
    if not token:
        return None, (jsonify({"error": "Unauthorized. Missing bearer token."}), 401)

    try:
        identity = database_service.get_user_identity_from_token(token)
    except Exception as exc:  # noqa: BLE001
        return None, (jsonify({"error": f"Unauthorized. Invalid token: {exc}"}), 401)

    email = (identity or {}).get("email", "")
    user_id = (identity or {}).get("id", "")

    if not email:
        return None, (jsonify({"error": "Unauthorized. Could not resolve user identity."}), 401)

    return {"email": email, "id": user_id}, None


def _get_authenticated_email() -> tuple[str | None, tuple[Any, int] | None]:
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return None, auth_error
    return (user or {}).get("email", ""), None


def _get_admin_email() -> tuple[str | None, tuple[Any, int] | None]:
    email, auth_error = _get_authenticated_email()
    if auth_error:
        return None, auth_error
    if not email or email.lower() not in ADMIN_EMAILS:
        return None, (jsonify({"error": "Forbidden. Admin access required."}), 403)
    return email, None


def _extract_auth_result(res: Any, fallback_email: str = "") -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    """Support both object and dict-shaped Supabase auth responses."""
    session_data: dict[str, Any] | None = None
    user_data: dict[str, Any] | None = None

    session_obj = getattr(res, "session", None)
    if session_obj is None and isinstance(res, dict):
        session_obj = res.get("session") or (res.get("data") or {}).get("session")

    if session_obj:
        if isinstance(session_obj, dict):
            session_data = {
                "access_token": session_obj.get("access_token"),
                "refresh_token": session_obj.get("refresh_token"),
            }
        else:
            session_data = {
                "access_token": getattr(session_obj, "access_token", None),
                "refresh_token": getattr(session_obj, "refresh_token", None),
            }

    user_obj = getattr(res, "user", None)
    if user_obj is None and isinstance(res, dict):
        user_obj = res.get("user") or (res.get("data") or {}).get("user")

    if user_obj:
        if isinstance(user_obj, dict):
            user_data = {
                "id": str(user_obj.get("id") or ""),
                "email": user_obj.get("email") or fallback_email,
                "user_metadata": user_obj.get("user_metadata") or {},
            }
        else:
            user_data = {
                "id": str(getattr(user_obj, "id", "")),
                "email": getattr(user_obj, "email", fallback_email),
                "user_metadata": getattr(user_obj, "user_metadata", {}),
            }

    return session_data, user_data


def _set_job_state(job_id: str, state: dict[str, Any]) -> None:
    with job_lock:
        job_store[job_id] = state


def _hash_content(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def _run_background_processing(
    job_id: str,
    files_payload: list[dict[str, Any]],
    created_by: str = "",
    owner_user_id: str = "",
) -> None:
    _set_job_state(
        job_id,
        {
            "job_id": job_id,
            "status": "processing",
            "message": "Processing files in background.",
            "processed": 0,
            "total": len(files_payload),
            "details": [],
            "warnings": [],
            "created_by": created_by,
        },
    )

    details: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []
    seen_batch_hashes: dict[str, dict[str, Any]] = {}

    similarity_candidates: list[dict[str, Any]] = []
    try:
        similarity_candidates = database_service.get_documents_for_similarity(
            created_by=created_by,
            user_id=owner_user_id,
            limit=400,
        )
    except Exception as sim_exc:  # noqa: BLE001
        warnings.append({"file": "*", "error": f"semantic index warmup failed: {sim_exc}"})
        print(f"[semantic.warmup.error] {sim_exc}")

    try:
        for index, item in enumerate(files_payload, start=1):
            file_name = item["filename"]
            safe_name = secure_filename(file_name)
            if owner_user_id:
                storage_path = f"users/{owner_user_id}/uploads/{uuid.uuid4().hex}_{safe_name}"
            else:
                storage_path = f"uploads/{uuid.uuid4().hex}_{safe_name}"
            file_bytes = item["bytes"]
            content_type = item.get("mimetype") or "application/octet-stream"
            content_hash = _hash_content(file_bytes)

            if content_hash in seen_batch_hashes:
                prior = seen_batch_hashes[content_hash]
                warning = {
                    "file": file_name,
                    "error": f"Exact duplicate in this batch (same hash as {prior.get('file_name') or 'another file'}).",
                }
                warnings.append(warning)
                details.append(
                    {
                        "file": file_name,
                        "category": "duplicate",
                        "confidence": 100,
                        "destination": prior.get("folder_location") or "duplicate-skipped",
                        "status": "duplicate-skipped",
                        "duplicate_type": "exact",
                    }
                )
                _set_job_state(
                    job_id,
                    {
                        "job_id": job_id,
                        "status": "processing",
                        "message": "Processing files in background.",
                        "processed": index,
                        "total": len(files_payload),
                        "details": details,
                        "warnings": warnings,
                        "created_by": created_by,
                    },
                )
                continue

            try:
                exact_duplicate = database_service.find_exact_duplicate_by_hash(
                    content_hash,
                    created_by=created_by,
                    user_id=owner_user_id,
                )
            except Exception as dup_exc:  # noqa: BLE001
                exact_duplicate = None
                warnings.append({"file": file_name, "error": f"hash duplicate check failed: {dup_exc}"})

            if exact_duplicate:
                warning = {
                    "file": file_name,
                    "error": f"Exact duplicate detected (matches {exact_duplicate.get('file_name')}). Skipped.",
                }
                warnings.append(warning)
                details.append(
                    {
                        "file": file_name,
                        "category": "duplicate",
                        "confidence": 100,
                        "destination": exact_duplicate.get("folder_location") or "duplicate-skipped",
                        "status": "duplicate-skipped",
                        "duplicate_type": "exact",
                        "duplicate_of": exact_duplicate.get("id"),
                    }
                )
                _set_job_state(
                    job_id,
                    {
                        "job_id": job_id,
                        "status": "processing",
                        "message": "Processing files in background.",
                        "processed": index,
                        "total": len(files_payload),
                        "details": details,
                        "warnings": warnings,
                        "created_by": created_by,
                    },
                )
                continue

            try:
                extraction_result = text_extractor.extract_document(file_name, file_bytes, content_type)
                extracted_text = extraction_result["content_text"]
                file_size = int(extraction_result["file_size"])
                mime_type = str(extraction_result["mime_type"])
                print(
                    f"[text.extract] file={file_name} chars={len(extracted_text)} extension={os.path.splitext(file_name.lower())[1]}"
                )
            except Exception as text_exc:  # noqa: BLE001
                warning = {"file": file_name, "error": str(text_exc)}
                warnings.append(warning)
                print(f"[text.extract.error] file={file_name} error={text_exc}")
                extracted_text = ""
                file_size = len(file_bytes)
                mime_type = content_type

            summary_text = summarizer_service.generate_summary(extracted_text) if extracted_text else ""

            near_duplicate: dict[str, Any] | None = None
            near_duplicate_score = 0.0
            if extracted_text.strip():
                near_duplicate, near_duplicate_score = semantic_search_service.find_near_duplicate(
                    extracted_text,
                    similarity_candidates,
                    min_score=NEAR_DUPLICATE_THRESHOLD,
                )
                if near_duplicate:
                    warnings.append(
                        {
                            "file": file_name,
                            "error": (
                                "Near-duplicate detected "
                                f"(similarity {near_duplicate_score:.3f}) with {near_duplicate.get('file_name')}."
                            ),
                        }
                    )

            database_service.upload_to_storage("documents", storage_path, file_bytes, content_type)

            if not extracted_text:
                print(f"[classification.input] file={file_name} has empty extracted text; using filename-only classification")

            try:
                category, confidence = classify_document(file_name, extracted_text)
            except Exception as classify_exc:  # noqa: BLE001
                warning = {"file": file_name, "error": f"classification failed: {classify_exc}"}
                warnings.append(warning)
                print(f"[classification.error] file={file_name} error={classify_exc}")
                category, confidence = "uncategorized", 0

            final_path = storage_path
            db_status = "classified"

            if (category or "uncategorized").strip().lower() == "uncategorized":
                final_path = storage_path  # keep in uploads/
                db_status = "uncategorized"
            else:
                if owner_user_id:
                    classified_path = f"users/{owner_user_id}/classified/{category}/{storage_path.split('/')[-1]}"
                else:
                    classified_path = f"classified/{category}/{storage_path.split('/')[-1]}"
                try:
                    supabase.storage.from_("documents").move(storage_path, classified_path)
                    final_path = classified_path
                    db_status = "classified"
                    print(f"[storage.move] Successfully moved to {final_path}")
                except Exception as move_exc:  # noqa: BLE001
                    print(f"[storage.move] Failed: {move_exc}, keeping in uploads/")
                    final_path = storage_path
                    db_status = "uncategorized"
                    category = "uncategorized"
                    confidence = 0

            if category == "uncategorized":
                db_status = "uncategorized"
            if near_duplicate:
                db_status = "near-duplicate"

            database_service.insert_document(
                file_name,
                final_path,
                extracted_text,
                file_size,
                mime_type,
                category,
                confidence,
                db_status,
                created_by,
                owner_user_id,
                summary_text,
                content_hash,
            )

            details.append(
                {
                    "file": file_name,
                    "category": category,
                    "confidence": confidence,
                    "destination": final_path,
                    "status": db_status,
                    "summary": summary_text,
                }
            )
            if near_duplicate:
                details[-1]["duplicate_type"] = "near"
                details[-1]["duplicate_of"] = near_duplicate.get("id")
                details[-1]["near_duplicate_score"] = round(float(near_duplicate_score), 4)

            similarity_candidates.append(
                {
                    "file_name": file_name,
                    "category": category,
                    "folder_location": final_path,
                    "content_text": extracted_text,
                    "summary_text": summary_text,
                    "content_hash": content_hash,
                }
            )
            seen_batch_hashes[content_hash] = {
                "file_name": file_name,
                "folder_location": final_path,
            }

            _set_job_state(
                job_id,
                {
                    "job_id": job_id,
                    "status": "processing",
                    "message": "Processing files in background.",
                    "processed": index,
                    "total": len(files_payload),
                    "details": details,
                    "warnings": warnings,
                    "created_by": created_by,
                },
            )

        _set_job_state(
            job_id,
            {
                "job_id": job_id,
                "status": "completed",
                "message": "Background processing complete.",
                "processed": len(files_payload),
                "total": len(files_payload),
                "details": details,
                "warnings": warnings,
                "source": "local_flask_background",
                "created_by": created_by,
            },
        )
    except Exception as exc:  # noqa: BLE001
        _set_job_state(
            job_id,
            {
                "job_id": job_id,
                "status": "failed",
                "message": "Background processing failed.",
                "error": str(exc),
                "processed": len(details),
                "total": len(files_payload),
                "details": details,
                "warnings": warnings,
                "created_by": created_by,
            },
        )
        print(f"[background.error] job_id={job_id} error={exc}")


@app.route("/", methods=["GET"])
def index() -> str:
    return render_template("index.html")


@app.route("/favicon.ico", methods=["GET"])
def favicon():
    return "", 204


@app.route("/login", methods=["GET"])
def login_page() -> str:
    """Static login page — will get upgraded to real soon."""
    return render_template("login.html")


@app.route("/signup", methods=["GET"])
def signup_page() -> str:
    """Convenience route for signup."""
    return render_template("login.html")

# ── Auth Endpoints ────────────────────────────────────────────────────────

@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data     = request.get_json(silent=True) or {}
    email    = (data.get("email") or "").strip()
    password = data.get("password") or ""
    name     = (data.get("name") or "").strip()

    if not email or not password:
        return jsonify({"error": "Email and password required"}), 400

    try:
        res = database_service.sign_up(email, password, name)
        session_data, user_data = _extract_auth_result(res, fallback_email=email)

        return jsonify({"session": session_data, "user": user_data}), 200

    except Exception as exc:
        err = str(exc)
        if "already registered" in err.lower() or "already exists" in err.lower():
            return jsonify({"error": "An account with this email already exists. Please sign in."}), 409
        return jsonify({"error": err}), 400


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data     = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or data.get("email") or "").strip()
    password = data.get("password") or ""

    if not identifier or not password:
        return jsonify({"error": "Email/username and password required"}), 400

    try:
        email = database_service.resolve_login_identifier_to_email(identifier)
        res = database_service.sign_in(email, password)
        session_data, user_data = _extract_auth_result(res, fallback_email=email)

        if not session_data or not session_data.get("access_token"):
            return jsonify({"error": "Login succeeded but no access token was returned. Check Supabase auth settings."}), 401

        return jsonify({"session": session_data, "user": user_data}), 200

    except Exception as exc:
        err = str(exc)
        if "invalid login" in err.lower() or "invalid credentials" in err.lower():
            return jsonify({"error": "Invalid username/email or password."}), 401
        if "email not confirmed" in err.lower():
            return jsonify({"error": "Email not confirmed"}), 401
        return jsonify({"error": err}), 401


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    """Client logout is local; this endpoint exists for parity and future server-side revocation."""
    return jsonify({"message": "Logged out."}), 200


@app.route("/api/auth/refresh", methods=["POST"])
def auth_refresh():
    data = request.get_json(silent=True) or {}
    refresh_token = str(data.get("refresh_token") or "").strip()

    if not refresh_token:
        return jsonify({"error": "refresh_token is required"}), 400

    try:
        res = database_service.refresh_session(refresh_token)
        session_data, user_data = _extract_auth_result(res)
        if not session_data or not session_data.get("access_token"):
            return jsonify({"error": "Could not refresh session."}), 401
        return jsonify({"session": session_data, "user": user_data}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": f"Session refresh failed: {exc}"}), 401


@app.route("/api/health/supabase", methods=["GET"])
def health_supabase():
    """Quick connection probe for Supabase project wiring."""
    try:
        probe = supabase.table("documents").select("id").limit(1).execute()
        return jsonify({"ok": True, "documents_probe_count": len(probe.data or [])}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.route("/api/classify", methods=["POST"])
def classify_documents():
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    files = request.files.getlist("files")
    valid_files = [f for f in files if f and f.filename]

    if not valid_files:
        return jsonify({"error": "No files were uploaded."}), 400

    files_payload: list[dict[str, Any]] = []
    try:
        for file in valid_files:
            file_bytes = file.read()

            if not file_bytes:
                continue

            files_payload.append(
                {
                    "filename": file.filename,
                    "mimetype": file.mimetype,
                    "bytes": file_bytes,
                }
            )

        if not files_payload:
            return jsonify({"error": "Uploaded files were empty."}), 400

        quota_stats = database_service.get_user_stats(created_by, user_id=owner_user_id)
        used_bytes = int(quota_stats.get("total_bytes_used") or 0)
        incoming_bytes = sum(len(item.get("bytes") or b"") for item in files_payload)
        projected_total = used_bytes + incoming_bytes

        if projected_total > USER_QUOTA_BYTES:
            remaining = max(0, USER_QUOTA_BYTES - used_bytes)
            return (
                jsonify(
                    {
                        "error": "User storage quota exceeded (50MB).",
                        "quota_bytes": USER_QUOTA_BYTES,
                        "used_bytes": used_bytes,
                        "incoming_bytes": incoming_bytes,
                        "remaining_bytes": remaining,
                    }
                ),
                413,
            )

        job_id = uuid.uuid4().hex
        _set_job_state(
            job_id,
            {
                "job_id": job_id,
                "status": "queued",
                "message": "Upload received. Processing will start shortly.",
                "processed": 0,
                "total": len(files_payload),
                "details": [],
                "warnings": [],
                "created_by": created_by,
            },
        )

        worker = threading.Thread(
            target=_run_background_processing,
            args=(job_id, files_payload, created_by, owner_user_id),
            daemon=True,
        )
        worker.start()

        return (
            jsonify(
                {
                    "job_id": job_id,
                    "status": "queued",
                    "message": "Upload received! Processing in background.",
                    "total": len(files_payload),
                }
            ),
            202,
        )

    except Exception as exc:  # noqa: BLE001
        error_message = str(exc)
        cause_message = str(getattr(exc, "__cause__", "") or "")
        context_message = str(getattr(exc, "__context__", "") or "")
        combined_error = " | ".join(part for part in [error_message, cause_message, context_message] if part)

        if "row-level security policy" in error_message or "statusCode': 403" in error_message:
            return (
                jsonify(
                    {
                        "error": "Supabase rejected upload (RLS policy). Use a service-role key on the server or add a storage INSERT policy for this bucket/path.",
                        "details": error_message,
                    }
                ),
                403,
            )
        if "Invalid Token or Protected Header formatting" in combined_error:
            return (
                jsonify(
                    {
                        "error": "Supabase auth failed. Ensure SUPABASE_KEY is a valid service_role JWT for server-side storage and table operations.",
                        "details": combined_error,
                    }
                ),
                401,
            )
        if "timed out" in combined_error.lower():
            return (
                jsonify(
                    {
                        "error": "Request timed out while processing upload/search. Try fewer or smaller files and check Supabase latency.",
                        "details": combined_error,
                    }
                ),
                504,
            )
        return jsonify({"error": error_message, "details": combined_error}), 500


@app.route("/api/jobs/<job_id>", methods=["GET"])
def get_job_status(job_id: str):
    created_by, auth_error = _get_authenticated_email()
    if auth_error:
        return auth_error

    with job_lock:
        job = job_store.get(job_id)
    if not job:
        return jsonify({"error": "Job not found."}), 404
    if job.get("created_by") and job.get("created_by") != created_by:
        return jsonify({"error": "Forbidden. This job belongs to another user."}), 403
    return jsonify(job), 200


@app.route("/search", methods=["GET"])
def search_documents():
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    query = request.args.get("q", "").strip()
    mode = request.args.get("mode", "hybrid").strip().lower()
    if mode not in {"keyword", "semantic", "hybrid"}:
        mode = "hybrid"
    if not query:
        return jsonify({"error": "Missing query parameter: q"}), 400

    try:
        print(f"[search] query={query} mode={mode} created_by={created_by or 'all'}")

        keyword_results: list[dict[str, Any]] = []
        semantic_results: list[dict[str, Any]] = []

        if mode in {"keyword", "hybrid"}:
            response = database_service.search_documents(query, created_by=created_by, user_id=owner_user_id)
            keyword_results = response.data or []

        if mode in {"semantic", "hybrid"}:
            docs_for_semantic = database_service.get_documents_for_similarity(
                created_by=created_by,
                user_id=owner_user_id,
                limit=500,
            )
            semantic_results = semantic_search_service.search(
                query,
                docs_for_semantic,
                top_k=30,
                min_score=0.18,
            )

        if mode == "keyword":
            return jsonify({"results": keyword_results, "mode": "keyword"}), 200
        if mode == "semantic":
            return jsonify({"results": semantic_results, "mode": "semantic"}), 200

        merged: dict[str, dict[str, Any]] = {}

        for row in keyword_results:
            key = str(row.get("id") or row.get("folder_location") or row.get("file_name") or uuid.uuid4().hex)
            base = dict(row)
            base["search_type"] = "keyword"
            base["semantic_score"] = float(base.get("semantic_score") or 0.0)
            base["_rank"] = 1.0
            merged[key] = base

        for row in semantic_results:
            key = str(row.get("id") or row.get("folder_location") or row.get("file_name") or uuid.uuid4().hex)
            semantic_score = float(row.get("semantic_score") or 0.0)
            if key in merged:
                merged[key]["semantic_score"] = max(float(merged[key].get("semantic_score") or 0.0), semantic_score)
                merged[key]["search_type"] = "hybrid"
                merged[key]["_rank"] = 1.0 + semantic_score
                if row.get("summary_text") and not merged[key].get("summary_text"):
                    merged[key]["summary_text"] = row.get("summary_text")
            else:
                base = dict(row)
                base["search_type"] = "semantic"
                base["_rank"] = 0.5 + semantic_score
                merged[key] = base

        ranked = sorted(merged.values(), key=lambda item: float(item.get("_rank") or 0.0), reverse=True)
        for item in ranked:
            item.pop("_rank", None)

        return jsonify({"results": ranked[:50], "mode": "hybrid"}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/my-documents", methods=["GET"])
def my_documents():
    """Return only documents uploaded by the requesting user."""
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    try:
        response = database_service.get_documents_by_user(created_by, user_id=owner_user_id)
        return jsonify({"data": response.data or []}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/my-documents", methods=["DELETE"])
def my_documents_delete():
    """Delete one user-owned document and its storage object by path."""
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    payload = request.get_json(silent=True) or {}
    path = str(payload.get("path") or "").strip()
    if not path:
        return jsonify({"error": "path is required"}), 400

    try:
        if not database_service.user_owns_path(path, created_by=created_by, user_id=owner_user_id):
            return jsonify({"error": "Forbidden. You do not have access to this file."}), 403

        deleted = database_service.delete_user_document_by_path(path, created_by=created_by, user_id=owner_user_id)
        if not deleted:
            return jsonify({"error": "Document not found."}), 404

        try:
            database_service.delete_storage_object(path)
        except Exception as storage_exc:  # noqa: BLE001
            print(f"[my_documents.delete.storage.warn] path={path} error={storage_exc}")

        return jsonify({"message": "Document deleted.", "path": path}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/user/stats", methods=["GET"])
def user_stats():
    """Return storage quota usage for the requesting user."""
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    try:
        stats = database_service.get_user_stats(created_by, user_id=owner_user_id)
        stats["quota_bytes"] = USER_QUOTA_BYTES
        return jsonify(stats), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/download", methods=["GET"])
def download_file():
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"error": "Missing path parameter."}), 400

    try:
        if not database_service.user_owns_path(path, created_by=created_by, user_id=owner_user_id):
            return jsonify({"error": "Forbidden. You do not have access to this file."}), 403
        url = database_service.get_download_url(path, expires_in=120)
        return jsonify({"url": url}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/share", methods=["GET"])
def share_file():
    user, auth_error = _get_authenticated_user()
    if auth_error:
        return auth_error
    created_by = (user or {}).get("email", "")
    owner_user_id = (user or {}).get("id", "")

    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"error": "Missing path parameter."}), 400

    try:
        if not database_service.user_owns_path(path, created_by=created_by, user_id=owner_user_id):
            return jsonify({"error": "Forbidden. You do not have access to this file."}), 403
        url = database_service.get_download_url(path, expires_in=604800)  # 7 days
        return jsonify({"url": url}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


# ── Admin Dashboard ──────────────────────────────────────────────


@app.route("/admin", methods=["GET"])
def admin_page() -> str:
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    return render_template("admin.html")


@app.route("/api/admin/stats", methods=["GET"])
def admin_stats():
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    try:
        stats = database_service.get_admin_stats()
        return jsonify(stats), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/documents", methods=["GET"])
def admin_list_documents():
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    try:
        response = database_service.get_all_documents()
        return jsonify({"data": response.data or []}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/documents/<doc_id>", methods=["GET"])
def admin_get_document(doc_id: str):
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    try:
        response = database_service.get_document(doc_id)
        return jsonify({"data": response.data}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/documents/<doc_id>", methods=["PUT"])
def admin_update_document(doc_id: str):
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    if not payload:
        return jsonify({"error": "Empty payload."}), 400
    # Only allow safe fields
    allowed = {"file_name", "category", "confidence", "status", "mime_type"}
    filtered = {k: v for k, v in payload.items() if k in allowed}
    if not filtered:
        return jsonify({"error": "No valid fields to update."}), 400
    try:
        response = database_service.update_document(doc_id, filtered)
        return jsonify({"data": response.data}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/documents/<doc_id>", methods=["DELETE"])
def admin_delete_document(doc_id: str):
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    try:
        # Get document first so we can also delete the storage file
        doc_resp = database_service.get_document(doc_id)
        doc = doc_resp.data
        folder_location = doc.get("folder_location", "") if doc else ""

        database_service.delete_document(doc_id)

        # Try to delete the storage object too
        if folder_location:
            try:
                database_service.delete_storage_object(folder_location)
            except Exception:  # noqa: BLE001
                pass  # storage delete is best-effort

        return jsonify({"message": "Document deleted."}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/download", methods=["GET"])
def admin_download():
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    path = request.args.get("path", "").strip()
    if not path:
        return jsonify({"error": "Missing path parameter."}), 400
    try:
        url = database_service.get_download_url(path)
        return jsonify({"url": url}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/categories", methods=["GET"])
def admin_list_categories():
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    try:
        response = database_service.get_all_categories()
        return jsonify({"data": response.data or []}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/categories", methods=["POST"])
def admin_create_category():
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    name = (payload.get("category_name") or "").strip()
    if not name:
        return jsonify({"error": "category_name is required."}), 400
    insert_data = {
        "category_name": name,
        "keywords": payload.get("keywords", []),
        "extensions": payload.get("extensions", []),
        "score_weight": float(payload.get("score_weight", 1)),
    }
    try:
        response = database_service.create_category(insert_data)
        return jsonify({"data": response.data}), 201
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/categories/<int:cat_id>", methods=["PUT"])
def admin_update_category(cat_id: int):
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    if not payload:
        return jsonify({"error": "Empty payload."}), 400
    allowed = {"category_name", "keywords", "extensions", "score_weight"}
    filtered = {k: v for k, v in payload.items() if k in allowed}
    if not filtered:
        return jsonify({"error": "No valid fields to update."}), 400
    if "score_weight" in filtered:
        filtered["score_weight"] = float(filtered["score_weight"])
    try:
        response = database_service.update_category(cat_id, filtered)
        return jsonify({"data": response.data}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/admin/categories/<int:cat_id>", methods=["DELETE"])
def admin_delete_category(cat_id: int):
    _, auth_error = _get_admin_email()
    if auth_error:
        return auth_error
    try:
        database_service.delete_category(cat_id)
        return jsonify({"message": "Category deleted."}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True)
