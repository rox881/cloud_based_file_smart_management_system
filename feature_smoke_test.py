"""Tiny smoke test for newly added semantic/summarization/dedup logic."""

from services.semantic_service import SemanticSearchService
from services.summarizer_service import SummarizerService


def main() -> None:
    semantic = SemanticSearchService()
    summarizer = SummarizerService()

    docs = [
        {
            "id": 1,
            "file_name": "invoice_april.pdf",
            "category": "invoice",
            "content_text": "invoice total amount due gst tax billed to customer",
            "summary_text": "April invoice with GST and due amount.",
        },
        {
            "id": 2,
            "file_name": "project_report.docx",
            "category": "report",
            "content_text": "this report discusses cloud deployment, autoscaling and monitoring",
            "summary_text": "Engineering cloud deployment report.",
        },
    ]

    semantic_hits = semantic.search("billing invoice amount", docs, top_k=5)
    print("semantic_hits:", semantic_hits)

    near_doc, near_score = semantic.find_near_duplicate(
        "invoice amount due and gst taxes for customer billing",
        docs,
        min_score=0.3,
    )
    print("near_duplicate:", near_doc.get("file_name") if near_doc else None, round(near_score, 4))

    summary = summarizer.generate_summary(
        "This document explains cloud file management. "
        "It covers semantic search, duplicate detection, and usage quotas. "
        "These features improve scalability and quality for engineering projects."
    )
    print("summary:", summary)


if __name__ == "__main__":
    main()
