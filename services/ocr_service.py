import os
from io import BytesIO

import pytesseract
from PIL import Image


class OCRService:
    def __init__(self) -> None:
        pytesseract.pytesseract.tesseract_cmd = os.getenv(
            "TESSERACT_CMD", r"C:\Program Files\Tesseract-OCR\tesseract.exe"
        )

    def extract_text(self, file_bytes: bytes) -> str:
        return pytesseract.image_to_string(Image.open(BytesIO(file_bytes))).strip()
