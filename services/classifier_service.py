import os
import threading
import time
from typing import Any

from supabase import Client

_CATEGORY_CACHE: list[dict[str, Any]] | None = None
_CACHE_TIMESTAMP = 0
_CACHE_LOCK = threading.Lock()
_SUPABASE_CLIENT: Client | None = None
supabase: Client | None = None


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
            _CATEGORY_CACHE = result.data or []
            _CACHE_TIMESTAMP = time.time()
            print(f"DEBUG: Loaded {len(_CATEGORY_CACHE)} categories from Supabase cache")
            return _CATEGORY_CACHE
        except Exception as e:  # noqa: BLE001
            print(f"WARNING: Failed to load categories from Supabase ({str(e)}). Using fallback.")
            return []


def classify_document(file_name: str, content_text: str) -> tuple[str, int]:
    categories = _load_categories_from_supabase()
    if not categories:
        print(f"DEBUG CLASSIFICATION: {file_name} → uncategorized (confidence: 0) [Supabase]")
        return "uncategorized", 0

    best_category = "uncategorized"
    best_score = 0
    file_lower = (file_name or "").lower()
    text_lower = content_text.lower() if content_text else ""

    for cat in categories:
        score = 0
        keywords = cat.get("keywords", []) or []
        weight = float(cat.get("score_weight", 1) or 1)

        for kw in keywords:
            kw_lower = str(kw).lower()
            if kw_lower in file_lower:
                score += 2 * weight
            if kw_lower in text_lower:
                score += 1 * weight

        if score > best_score:
            best_score = score
            best_category = str(cat.get("category_name") or "uncategorized")

    confidence = int(min(100, best_score * 10)) if best_score > 0 else 0
    print(
        f"DEBUG CLASSIFICATION: {file_name} → {best_category} (confidence: {confidence}) [Supabase]"
    )
    return best_category, confidence
