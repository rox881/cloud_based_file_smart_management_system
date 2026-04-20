import os
import threading
import time
import re
from typing import Any

from supabase import Client

_CATEGORY_CACHE: list[dict[str, Any]] | None = None
_CACHE_TIMESTAMP = 0
_CACHE_LOCK = threading.Lock()
_SUPABASE_CLIENT: Client | None = None
supabase: Client | None = None

_DEFAULT_CATEGORIES: list[dict[str, Any]] = [
    {
        "category_name": "assignment",
        "keywords": ["assignment", "homework", "coursework", "submission", "question", "exercise", "lab"],
        "extensions": ["pdf", "doc", "docx", "txt"],
        "score_weight": 1.2,
    },
    {
        "category_name": "report",
        "keywords": ["report", "analysis", "findings", "summary", "project report", "study"],
        "extensions": ["pdf", "doc", "docx", "txt"],
        "score_weight": 1.1,
    },
    {
        "category_name": "invoice",
        "keywords": ["invoice", "bill", "amount due", "tax", "gst", "payment", "receipt"],
        "extensions": ["pdf", "png", "jpg", "jpeg"],
        "score_weight": 1.3,
    },
    {
        "category_name": "contract",
        "keywords": ["contract", "agreement", "terms", "party", "signature", "clause"],
        "extensions": ["pdf", "doc", "docx", "txt"],
        "score_weight": 1.2,
    },
]
_TOKEN_RE = re.compile(r"[a-z0-9]+")


def set_supabase_client(client: Client) -> None:
    global _SUPABASE_CLIENT, supabase
    _SUPABASE_CLIENT = client
    supabase = client


def _load_categories_from_supabase() -> list[dict[str, Any]]:
    global _CATEGORY_CACHE, _CACHE_TIMESTAMP

    with _CACHE_LOCK:
        if _CATEGORY_CACHE is not None and (time.time() - _CACHE_TIMESTAMP < 300):
            return _CATEGORY_CACHE

        try:
            if supabase is None:
                raise RuntimeError("Supabase client is not configured for classifier_service.")
            result = supabase.table("document_categories").select("*").execute()
            cloud_categories = result.data or []
            _CATEGORY_CACHE = cloud_categories if cloud_categories else [dict(item) for item in _DEFAULT_CATEGORIES]
            _CACHE_TIMESTAMP = time.time()
            if cloud_categories:
                print(f"DEBUG: Loaded {len(_CATEGORY_CACHE)} categories from Supabase cache")
            else:
                print("WARNING: document_categories is empty. Using built-in fallback categories.")
            return _CATEGORY_CACHE
        except Exception as e:  # noqa: BLE001
            print(f"WARNING: Failed to load categories from Supabase ({str(e)}). Using built-in fallback categories.")
            _CATEGORY_CACHE = [dict(item) for item in _DEFAULT_CATEGORIES]
            _CACHE_TIMESTAMP = time.time()
            return _CATEGORY_CACHE


def _tokenize(text: str) -> set[str]:
    return set(_TOKEN_RE.findall((text or "").lower()))


def _term_variants(term: str) -> set[str]:
    base = (term or "").strip().lower()
    if not base:
        return set()
    variants = {base}
    if base.endswith("s") and len(base) > 3:
        variants.add(base[:-1])
    else:
        variants.add(f"{base}s")
    return variants


def classify_document(file_name: str, content_text: str) -> tuple[str, int]:
    categories = _load_categories_from_supabase()
    if not categories:
        print(f"DEBUG CLASSIFICATION: {file_name} → uncategorized (confidence: 0) [Supabase]")
        return "uncategorized", 0

    best_category = "uncategorized"
    best_score = 0.0
    file_lower = (file_name or "").lower()
    text_lower = content_text.lower() if content_text else ""
    file_tokens = _tokenize(file_lower)
    text_tokens = _tokenize(text_lower)
    file_ext = os.path.splitext(file_lower)[1].lstrip(".")

    for cat in categories:
        score = 0.0
        keywords = cat.get("keywords", []) or []
        weight = float(cat.get("score_weight", 1) or 1)
        cat_name = str(cat.get("category_name") or "").strip().lower()

        # Strong signal: category name appears in file name/content (with singular/plural variants).
        for variant in _term_variants(cat_name):
            if variant and variant in file_lower:
                score += 4.0 * weight
            if variant and variant in text_lower:
                score += 1.2 * weight
            if variant and variant in file_tokens:
                score += 1.4 * weight
            if variant and variant in text_tokens:
                score += 0.6 * weight

        for kw in keywords:
            kw_lower = str(kw).lower()
            if not kw_lower:
                continue

            if kw_lower in file_lower:
                score += 2.6 * weight
            if kw_lower in text_lower:
                score += 1.1 * weight

            kw_tokens = _tokenize(kw_lower)
            if kw_tokens and kw_tokens.issubset(file_tokens):
                score += 1.5 * weight
            if kw_tokens and kw_tokens.issubset(text_tokens):
                score += 0.8 * weight

        # Light bonus for extension compatibility.
        extensions = {str(ext).lower().lstrip(".") for ext in (cat.get("extensions", []) or []) if str(ext).strip()}
        if file_ext and file_ext in extensions:
            score += 0.35 * weight

        if score > best_score:
            best_score = score
            best_category = str(cat.get("category_name") or "uncategorized")

    confidence = int(min(100, best_score * 8.5)) if best_score > 0 else 0
    print(
        f"DEBUG CLASSIFICATION: {file_name} → {best_category} (confidence: {confidence}) [Supabase]"
    )
    return best_category, confidence
