"""Publish only the frontend. Server code and private runtime data stay out."""
from pathlib import Path
import shutil
root=Path(__file__).resolve().parent
public=root/'public'
public.mkdir(exist_ok=True)
for name in ('index.html','mobile.js','mobile.css'):
    shutil.copy2(root/name,public/name)
