from pathlib import Path
from pypdf import PdfReader
from docx import Document
from PIL import Image
import pytesseract

from app.models import FileType


ALLOWED_EXTENSIONS = {
    "pdf": FileType.pdf,
    "docx": FileType.docx,
    "png": FileType.image,
    "jpg": FileType.image,
    "jpeg": FileType.image,
    "webp": FileType.image,
    "txt": FileType.text,
    "md": FileType.text,
}

MAX_FILE_SIZE = 10 * 1024 * 1024   # 10 MB


def detect_file_type(filename: str) -> FileType:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError(f"Unsupported file type: .{ext}")
    return ALLOWED_EXTENSIONS[ext]


def extract_text(file_path: str, file_type: FileType) -> tuple[str, int | None]:
    """Returns (text, page_count). page_count is None for non-paginated formats."""
    path = Path(file_path)

    if file_type == FileType.pdf:
        reader = PdfReader(path)
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return text.strip(), len(reader.pages)

    if file_type == FileType.docx:
        doc = Document(path)
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        return text.strip(), None

    if file_type == FileType.image:
        text = pytesseract.image_to_string(Image.open(path))
        return text.strip(), None

    if file_type == FileType.text:
        return path.read_text(encoding="utf-8").strip(), None

    raise ValueError(f"Unsupported file type: {file_type}")
