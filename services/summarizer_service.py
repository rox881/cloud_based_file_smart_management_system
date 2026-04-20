import re
from collections import Counter

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")
_TOKEN_RE = re.compile(r"[a-z0-9]{2,}")

_STOP_WORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "has",
    "he",
    "in",
    "is",
    "it",
    "its",
    "of",
    "on",
    "that",
    "the",
    "to",
    "was",
    "were",
    "will",
    "with",
    "this",
    "these",
    "those",
    "you",
    "your",
    "we",
    "our",
    "or",
    "if",
    "not",
    "can",
    "may",
    "than",
}


class SummarizerService:
    """Small extractive summarizer for long document text."""

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        return [t for t in _TOKEN_RE.findall((text or "").lower()) if t not in _STOP_WORDS]

    def generate_summary(self, text: str, max_sentences: int = 3, max_chars: int = 420) -> str:
        cleaned = " ".join((text or "").split())
        if not cleaned:
            return ""

        if len(cleaned) <= max_chars:
            return cleaned

        sentences = [s.strip() for s in _SENTENCE_SPLIT_RE.split(cleaned) if s.strip()]
        if not sentences:
            clipped = cleaned[:max_chars].rsplit(" ", 1)[0].strip()
            return f"{clipped}..." if clipped else cleaned[:max_chars]

        freq = Counter(self._tokenize(cleaned))
        if not freq:
            clipped = cleaned[:max_chars].rsplit(" ", 1)[0].strip()
            return f"{clipped}..." if clipped else cleaned[:max_chars]

        scored_sentences: list[tuple[float, int, str]] = []
        for idx, sentence in enumerate(sentences):
            words = self._tokenize(sentence)
            if not words:
                continue
            score = sum(freq[w] for w in words) / max(len(words), 1)
            # Keep medium-length sentences favored over overly short/noisy ones.
            if len(words) < 5:
                score *= 0.65
            elif len(words) > 45:
                score *= 0.85
            scored_sentences.append((score, idx, sentence))

        if not scored_sentences:
            clipped = cleaned[:max_chars].rsplit(" ", 1)[0].strip()
            return f"{clipped}..." if clipped else cleaned[:max_chars]

        top = sorted(scored_sentences, key=lambda row: row[0], reverse=True)[: max(1, max_sentences)]
        top_in_original_order = sorted(top, key=lambda row: row[1])
        summary = " ".join(item[2] for item in top_in_original_order)

        if len(summary) <= max_chars:
            return summary

        clipped = summary[:max_chars].rsplit(" ", 1)[0].strip()
        return f"{clipped}..." if clipped else summary[:max_chars]
