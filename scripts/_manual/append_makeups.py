"""Append the offline supplement while preserving every existing page's rendering."""
import hashlib
import sys
from pathlib import Path
import pymupdf

source, supplement, output = map(Path, sys.argv[1:4])
with pymupdf.open(source) as original, pymupdf.open(supplement) as extra:
    assert not any("보강관리 추가 안내" in entry[1] for entry in original.get_toc()), "Already includes the makeup supplement; provide the original base PDF"
    count = len(original)
    original_hashes = [hashlib.sha256(page.get_pixmap().samples).hexdigest() for page in original]
    original.insert_pdf(extra)
    original.set_toc(original.get_toc() + [[1, "보강관리 추가 안내 (2026-10-05)", count + 1]])
    original.save(output, garbage=3, deflate=True)
with pymupdf.open(output) as updated:
    assert len(updated) == count + 2
    assert original_hashes == [hashlib.sha256(updated[i].get_pixmap().samples).hexdigest() for i in range(count)]
    assert "도입 사전 점검" in updated[count].get_text()
    print(f"PASS: {count} original page renderings preserved; 2 makeup pages appended")
