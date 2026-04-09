import mimetypes
import os
from io import BytesIO
from typing import Any

from docx import Document
import pytesseract

if os.name == 'nt':
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'

from services.ocr_service import OCRService
from services.pdf_service import PDFService


class TextExtractorService:
    IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}
    PDF_EXTENSIONS = {".pdf"}
    TEXT_EXTENSIONS = {".txt"}
    DOCX_EXTENSIONS = {".docx"}

    def __init__(self, ocr_service: OCRService, pdf_service: PDFService) -> None:
        self.ocr_service = ocr_service
        self.pdf_service = pdf_service

    def extract_text(self, filename: str, file_bytes: bytes) -> str:
        return self.extract_document(filename, file_bytes)["content_text"]

    def extract_document(self, filename: str, file_bytes: bytes, mime_type: str | None = None) -> dict[str, Any]:
        extension = os.path.splitext(filename.lower())[1]
        resolved_mime_type = mime_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        file_size = len(file_bytes)
        content_text = ""

        if extension in self.IMAGE_EXTENSIONS:
            try:
                content_text = self.ocr_service.extract_text(file_bytes)
            except Exception as ocr_exc:  # noqa: BLE001
                print(f"WARNING: OCR failed for {filename}: {ocr_exc}")
                content_text = ""
        elif extension in self.PDF_EXTENSIONS:
            content_text = self.pdf_service.extract_text(file_bytes)
        elif extension in self.TEXT_EXTENSIONS:
            content_text = self._extract_text_file(file_bytes)
        elif extension in self.DOCX_EXTENSIONS:
            content_text = self._extract_docx_text(file_bytes)

        return {
            "content_text": content_text,
            "file_size": file_size,
            "mime_type": resolved_mime_type,
        }

    @staticmethod
    def _extract_text_file(file_bytes: bytes) -> str:
        try:
            return file_bytes.decode("utf-8").strip()
        except UnicodeDecodeError:
            return file_bytes.decode("latin-1", errors="ignore").strip()

    @staticmethod
    def _extract_docx_text(file_bytes: bytes) -> str:
        doc = Document(BytesIO(file_bytes))
        lines = [paragraph.text for paragraph in doc.paragraphs if paragraph.text]
        return "\n".join(lines).strip()
