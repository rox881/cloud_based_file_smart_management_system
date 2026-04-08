import os
import time
import uuid
from io import BytesIO
from typing import Any

import pytesseract
from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request
from PIL import Image
from supabase import Client, create_client
from werkzeug.utils import secure_filename

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# Change this path if Tesseract is installed in a different location.
pytesseract.pytesseract.tesseract_cmd = os.getenv(
    "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
)

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
KEYWORD_RULES = {
    "Invoice": ["invoice", "tax", "gst", "amount due", "bill to"],
    "Receipt": ["receipt", "paid", "cash", "total", "transaction"],
    "ID Document": ["passport", "aadhaar", "license", "identity", "dob"],
    "Contract": ["agreement", "contract", "terms", "party", "signature"],
}

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("Missing SUPABASE_URL or SUPABASE_KEY in environment variables.")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
app = Flask(__name__)


def _extract_function_data(response: Any) -> dict[str, Any]:
    if response is None:
        return {}
    if isinstance(response, dict):
        return response
    if hasattr(response, "data") and isinstance(response.data, dict):
        return response.data
    if hasattr(response, "model_dump"):
        dumped = response.model_dump()
        if isinstance(dumped, dict):
            if isinstance(dumped.get("data"), dict):
                return dumped["data"]
            return dumped
    return {}


def _is_image_file(filename: str) -> bool:
    return os.path.splitext(filename.lower())[1] in IMAGE_EXTENSIONS


def _classify_text_by_keywords(text: str) -> dict[str, Any]:
    normalized = (text or "").lower()
    best_category = "Uncategorized"
    best_score = 0

    for category, keywords in KEYWORD_RULES.items():
        score = sum(1 for keyword in keywords if keyword in normalized)
        if score > best_score:
            best_score = score
            best_category = category

    confidence = round(min(best_score / 3, 1.0), 2) if best_score else 0
    return {"category": best_category, "confidence": confidence}


def _invoke_classify_function_with_retry(payload: dict[str, Any], max_attempts: int = 2) -> Any:
    last_error: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return supabase.functions.invoke(
                "classify-doc",
                invoke_options={"body": payload},
            )
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if "timed out" not in str(exc).lower() or attempt == max_attempts:
                raise
            time.sleep(1)
    if last_error:
        raise last_error
    raise RuntimeError("Unexpected classify-doc invocation state")


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

    uploaded_paths: list[dict[str, str]] = []
    ocr_text_by_file: dict[str, str] = {}
    ocr_errors: list[dict[str, str]] = []

    try:
        for file in valid_files:
            safe_name = secure_filename(file.filename)
            object_path = f"uploads/{uuid.uuid4().hex}_{safe_name}"
            file_bytes = file.read()

            if not file_bytes:
                continue

            supabase.storage.from_("documents").upload(
                object_path,
                file_bytes,
                {"upsert": "true", "content-type": file.mimetype or "application/octet-stream"},
            )

            extracted_text = ""
            if _is_image_file(file.filename):
                try:
                    extracted_text = pytesseract.image_to_string(Image.open(BytesIO(file_bytes)))
                    ocr_text_by_file[file.filename] = extracted_text
                except Exception as ocr_exc:  # noqa: BLE001
                    ocr_errors.append({"file": file.filename, "error": str(ocr_exc)})

            uploaded_paths.append({"file": file.filename, "path": object_path, "ocr_text": extracted_text})

        if not uploaded_paths:
            return jsonify({"error": "Uploaded files were empty."}), 400

        fn_response = _invoke_classify_function_with_retry(
            payload={"action": "classify_all", "ocr_text_by_file": ocr_text_by_file},
            max_attempts=2,
        )

        data = _extract_function_data(fn_response)

        # Keep frontend contract stable if edge function returns an unexpected shape.
        if "details" not in data:
            details = []
            for entry in uploaded_paths:
                keyword_result = _classify_text_by_keywords(entry.get("ocr_text", ""))
                details.append(
                    {
                        "file": entry["file"],
                        "category": keyword_result["category"],
                        "confidence": keyword_result["confidence"],
                        "destination": entry["path"],
                    }
                )
            data["details"] = details

        # If OCR failed for any image, include warnings without failing the full request.
        if ocr_errors:
            data["ocr_warnings"] = ocr_errors

        # Persist searchable metadata and OCR output in the documents table.
        entries_by_file: dict[str, list[dict[str, str]]] = {}
        for entry in uploaded_paths:
            entries_by_file.setdefault(entry["file"], []).append(entry)

        rows_to_insert = []
        for detail in data.get("details", []):
            file_name = detail.get("file")
            if not file_name:
                continue

            matched_entry = None
            if file_name in entries_by_file and entries_by_file[file_name]:
                matched_entry = entries_by_file[file_name].pop(0)

            folder_location = detail.get("destination") or (matched_entry.get("path") if matched_entry else "")
            content_text = (matched_entry.get("ocr_text") if matched_entry else "") or ""

            rows_to_insert.append(
                {
                    "file_name": file_name,
                    "folder_location": folder_location,
                    "content_text": content_text,
                }
            )

        if rows_to_insert:
            supabase.table("documents").insert(rows_to_insert).execute()

        return jsonify(data), 200

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
                        "error": "Supabase Edge Function auth failed. Use the legacy service_role JWT key (starts with 'eyJ') in SUPABASE_KEY, not an sb_secret/sb_publishable key.",
                        "details": combined_error,
                    }
                ),
                401,
            )
        if "timed out" in combined_error.lower():
            return (
                jsonify(
                    {
                        "error": "Edge Function timed out. Your classify-doc function is taking too long to respond.",
                        "details": combined_error,
                    }
                ),
                504,
            )
        if "requesting your edge function" in error_message:
            return (
                jsonify(
                    {
                        "error": "Edge Function invocation failed. Ensure 'classify-doc' is deployed and set SUPABASE_KEY to legacy service_role JWT (starts with 'eyJ').",
                        "details": combined_error,
                    }
                ),
                502,
            )
        return jsonify({"error": error_message, "details": combined_error}), 500


@app.route("/search", methods=["GET"])
def search_documents():
    query = request.args.get("q", "").strip()
    if not query:
        return jsonify({"error": "Missing query parameter: q"}), 400

    try:
        response = (
            supabase.table("documents")
            .select("*")
            .text_search("content_text", query)
            .execute()
        )
        return jsonify({"results": response.data or []}), 200
    except Exception as exc:  # noqa: BLE001
        return jsonify({"error": str(exc)}), 500


if __name__ == "__main__":
    app.run(debug=True)
