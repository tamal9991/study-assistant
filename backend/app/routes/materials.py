import os
import tempfile
from uuid import UUID
from datetime import datetime
from typing import List
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Material, FileType
from app.deps import get_current_user
from app.extractors import detect_file_type, extract_text, MAX_FILE_SIZE

router = APIRouter(prefix="/materials", tags=["materials"])


class MaterialOut(BaseModel):
    id: UUID
    title: str
    file_type: FileType
    page_count: int | None
    char_count: int
    created_at: datetime

    class Config:
        from_attributes = True
        use_enum_values = True


@router.post("/upload", response_model=MaterialOut, status_code=status.HTTP_201_CREATED)
async def upload_material(
    file: UploadFile = File(...),
    title: str | None = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        file_type = detect_file_type(file.filename or "")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (max 10 MB)")
    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Empty file")

    suffix = "." + (file.filename or "").rsplit(".", 1)[-1].lower()
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(contents)
        tmp_path = tmp.name

    try:
        text, page_count = extract_text(tmp_path, file_type)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not extract text: {e}")
    finally:
        os.unlink(tmp_path)

    if not text or len(text.strip()) < 10:
        raise HTTPException(status_code=400, detail="No readable text found in file")

    material = Material(
        user_id=current_user.id,
        title=(title or file.filename or "Untitled").strip()[:255],
        source_text=text,
        file_type=file_type,
        page_count=page_count,
        char_count=len(text),
    )
    db.add(material)
    db.commit()
    db.refresh(material)
    return material


@router.get("", response_model=List[MaterialOut])
def list_materials(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Material)
        .filter(Material.user_id == current_user.id)
        .order_by(Material.created_at.desc())
        .all()
    )


@router.get("/{material_id}", response_model=MaterialOut)
def get_material(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = (
        db.query(Material)
        .filter(Material.id == material_id, Material.user_id == current_user.id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    return material


@router.delete("/{material_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_material(
    material_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    material = (
        db.query(Material)
        .filter(Material.id == material_id, Material.user_id == current_user.id)
        .first()
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    db.delete(material)
    db.commit()
