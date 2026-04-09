import fitz


class PDFService:
    def extract_text(self, file_bytes: bytes) -> str:
        pages: list[str] = []
        with fitz.open(stream=file_bytes, filetype="pdf") as pdf_doc:
            for page in pdf_doc:
                pages.append(page.get_text("text") or "")
        return "\n".join(pages).strip()
