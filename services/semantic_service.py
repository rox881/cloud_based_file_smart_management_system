import hashlib
import math
import re
from typing import Any

_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")


class SemanticSearchService:
    """Lightweight hash-embedding semantic search and near-duplicate detection."""

    def __init__(self, vector_dim: int = 256) -> None:
        self.vector_dim = max(64, int(vector_dim or 256))

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return _TOKEN_RE.findall((text or "").lower())

    def embed_text(self, text: str) -> list[float]:
        tokens = self._tokenize(text)
        if not tokens:
            return [0.0] * self.vector_dim

        vector = [0.0] * self.vector_dim
        for token in tokens:
            digest = hashlib.sha1(token.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "big") % self.vector_dim
            sign = -1.0 if (digest[4] & 1) else 1.0
            weight = 1.0 + math.log1p(len(token))
            vector[idx] += sign * weight

        norm = math.sqrt(sum(v * v for v in vector))
        if norm <= 0:
            return vector
        return [v / norm for v in vector]

    @staticmethod
    def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
        return float(sum(a * b for a, b in zip(vec_a, vec_b)))

    @staticmethod
    def _document_search_text(doc: dict[str, Any]) -> str:
        return " ".join(
            part
            for part in [
                str(doc.get("file_name") or ""),
                str(doc.get("category") or ""),
                str(doc.get("summary_text") or ""),
                str(doc.get("content_text") or ""),
            ]
            if part
        )

    def search(
        self,
        query: str,
        documents: list[dict[str, Any]],
        top_k: int = 20,
        min_score: float = 0.18,
    ) -> list[dict[str, Any]]:
        query_vec = self.embed_text(query)
        if not any(query_vec):
            return []

        scored: list[dict[str, Any]] = []
        for doc in documents:
            doc_text = self._document_search_text(doc)
            if not doc_text.strip():
                continue
            doc_vec = self.embed_text(doc_text)
            score = self.cosine_similarity(query_vec, doc_vec)
            if score < min_score:
                continue

            row = dict(doc)
            row["semantic_score"] = round(score, 4)
            row["search_type"] = "semantic"
            scored.append(row)

        scored.sort(key=lambda item: item.get("semantic_score", 0.0), reverse=True)
        return scored[: max(1, int(top_k or 20))]

    def find_near_duplicate(
        self,
        content_text: str,
        documents: list[dict[str, Any]],
        min_score: float = 0.92,
        min_text_chars: int = 30,
    ) -> tuple[dict[str, Any] | None, float]:
        source = (content_text or "").strip()
        if len(source) < min_text_chars:
            return None, 0.0

        src_vec = self.embed_text(source)
        if not any(src_vec):
            return None, 0.0

        best_doc: dict[str, Any] | None = None
        best_score = 0.0

        for doc in documents:
            candidate = str(doc.get("content_text") or "").strip()
            if len(candidate) < min_text_chars:
                continue
            score = self.cosine_similarity(src_vec, self.embed_text(candidate))
            if score > best_score:
                best_score = score
                best_doc = doc

        if best_score >= min_score:
            return best_doc, float(best_score)
        return None, float(best_score)
