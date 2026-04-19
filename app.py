import os
import re
import smtplib
import threading
import uuid
from email.message import EmailMessage
from typing import Any
from ssl import create_default_context

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from supabase import Client, create_client
from werkzeug.utils import secure_filename

from services.classifier_service import classify_document, set_supabase_client
from services.database_service import DatabaseService
from services.ocr_service import OCRService
from services.pdf_service import PDFService
from services.text_extractor_service import TextExtractorService

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

SMTP_HOST = os.getenv("SMTP_HOST")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")
SMTP_FROM = os.getenv("SMTP_FROM")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in environment variables.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
set_supabase_client(supabase)
app = Flask(__name__)
database_service = DatabaseService(supabase)
text_extractor = TextExtractorService(OCRService(), PDFService())

job_store: dict[str, dict[str, Any]] = {}
job_lock = threading.Lock()


EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _set_job_state(job_id: str, state: dict[str, Any]) -> None:
    with job_lock:
        job_store[job_id] = state


def _is_valid_email(email: str) -> bool:
    return bool(EMAIL_REGEX.match(email or ""))


def _smtp_is_configured() -> bool:
    return bool(SMTP_HOST and SMTP_USER and SMTP_PASS and SMTP_FROM)


def _send_share_email(
    recipient_email: str,
    file_name: str,
    storage_path: str,
    share_token: str,
    permission: str,
    message: str | None,
) -> None:
    if not _smtp_is_configured():
        raise RuntimeError("SMTP is not configured.")

    email_message = EmailMessage()
    email_message["Subject"] = f"File shared with you: {file_name}"
    email_message["From"] = SMTP_FROM
    email_message["To"] = recipient_email

    custom_message = message.strip() if isinstance(message, str) else ""
    email_body_lines = [
        "A file has been shared with you.",
        "",
        f"File: {file_name}",
        f"Storage Path: {storage_path}",
        f"Permission: {permission}",
        f"Share Token: {share_token}",
    ]

    if custom_message:
        email_body_lines.extend(["", f"Message from sender: {custom_message}"])

    email_message.set_content("\n".join(email_body_lines))

    try:
        if SMTP_PORT == 465:
            with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20, context=create_default_context()) as smtp:
                smtp.login(SMTP_USER, SMTP_PASS)
                smtp.send_message(email_message)
        else:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
                smtp.ehlo()
                smtp.starttls(context=create_default_context())
                smtp.ehlo()
                smtp.login(SMTP_USER, SMTP_PASS)
                smtp.send_message(email_message)
    except Exception as exc:  # noqa: BLE001
        print(f"[smtp.error] {type(exc).__name__}: {exc}")
        raise


def _run_background_processing(job_id: str, files_payload: list[dict[str, Any]]) -> None:
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
        },
    )

    details: list[dict[str, Any]] = []
    warnings: list[dict[str, str]] = []

    try:
        for index, item in enumerate(files_payload, start=1):
            file_name = item["filename"]
            safe_name = secure_filename(file_name)
            storage_path = f"uploads/{uuid.uuid4().hex}_{safe_name}"
            file_bytes = item["bytes"]
            content_type = item.get("mimetype") or "application/octet-stream"

            database_service.upload_to_storage("documents", storage_path, file_bytes, content_type)

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

            database_service.insert_document(
                file_name,
                final_path,
                extracted_text,
                file_size,
                mime_type,
                category,
                confidence,
                db_status,
            )

            details.append(
                {
                    "file": file_name,
                    "category": category,
                    "confidence": confidence,
                    "destination": final_path,
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
            },
        )
        print(f"[background.error] job_id={job_id} error={exc}")


@app.route("/", methods=["GET"])
def index() -> str:
    return render_template("index.html")


@app.route("/favicon.ico", methods=["GET"])
def favicon():
    return "", 204


@app.route("/api/classify", methods=["POST"])
def classify_documents():
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
            },
        )

        worker = threading.Thread(
            target=_run_background_processing,
            args=(job_id, files_payload),
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
    with job_lock:
        job = job_store.get(job_id)
    if not job:
        return jsonify({"error": "Job not found."}), 404
    return jsonify(job), 200


@app.route("/api/share", methods=["POST"])
def share_document():
    payload = request.get_json(silent=True) or {}

    file_name = str(payload.get("file_name", "")).strip()
    storage_path = str(payload.get("storage_path", "")).strip()
    recipient_email = str(payload.get("recipient_email", "")).strip().lower()
    permission = str(payload.get("permission", "view")).strip().lower() or "view"
    message = payload.get("message")
    expires_at = payload.get("expires_at")

    if not file_name:
        return jsonify({"error": "Missing required field: file_name"}), 400
    if not storage_path:
        return jsonify({"error": "Missing required field: storage_path"}), 400
    if not recipient_email:
        return jsonify({"error": "Missing required field: recipient_email"}), 400
    if not _is_valid_email(recipient_email):
        return jsonify({"error": "Invalid recipient email format."}), 400
    if permission not in {"view", "download"}:
        return jsonify({"error": "Invalid permission. Allowed values: view, download."}), 400

    share_token = uuid.uuid4().hex
    email_sent = False
    warning_message = None
    smtp_error = None

    try:
        response = database_service.create_file_share(
            file_name=file_name,
            storage_path=storage_path,
            recipient_email=recipient_email,
            share_token=share_token,
            permission=permission,
            status="pending",
            message=str(message).strip() if message is not None else None,
            expires_at=str(expires_at).strip() if expires_at is not None else None,
        )

        if _smtp_is_configured():
            try:
                _send_share_email(
                    recipient_email=recipient_email,
                    file_name=file_name,
                    storage_path=storage_path,
                    share_token=share_token,
                    permission=permission,
                    message=str(message).strip() if message is not None else None,
                )
                email_sent = True

                try:
                    database_service.update_file_share_status(share_token=share_token, status="sent")
                except Exception as status_exc:  # noqa: BLE001
                    warning_message = f"Email sent, but failed to update share status: {status_exc}"
            except Exception as mail_exc:  # noqa: BLE001
                smtp_error = f"{type(mail_exc).__name__}: {mail_exc}"
                warning_message = f"Share saved, but email could not be sent: {smtp_error}"
        else:
            warning_message = "Share saved. SMTP is not configured, so no email was sent."

        result_message = "Share record created and email sent." if email_sent else "Share record created."
        return (
            jsonify(
                {
                    "message": result_message,
                    "share_token": share_token,
                    "email_sent": email_sent,
                    "warning": warning_message,
                    "smtp_error": smtp_error,
                    "share": response.data[0] if getattr(response, "data", None) else None,
                }
            ),
            201,
        )
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/api/shares", methods=["GET"])
def list_shares():
    raw_limit = request.args.get("limit", "20").strip()

    try:
        limit = int(raw_limit)
    except ValueError:
        return jsonify({"error": "Invalid limit. Use an integer value."}), 400

    if limit < 1 or limit > 100:
        return jsonify({"error": "Invalid limit. Allowed range is 1 to 100."}), 400

    try:
        response = database_service.list_file_shares(limit=limit)
        return jsonify({"shares": response.data or [], "count": len(response.data or [])}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


@app.route("/search", methods=["GET"])
def search_documents():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Missing query parameter: q"}), 400

    try:
        print(f"[search] query={query}")
        response = database_service.search_documents(query)
        return jsonify({"results": response.data or []}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True)
