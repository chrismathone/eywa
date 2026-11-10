"""Build the Windows PowerShell 5.1 package; never include credentials or test state."""
import hashlib
import json
import zipfile
from pathlib import Path

source = Path(__file__).resolve().parent
repo = source.parent.parent
names = ["Collector.psm1", "Run.ps1", "Setup.ps1", "설치.cmd", "수집폴더.cmd", "지금실행.cmd", "상태확인.cmd", "사용안내.txt"]
payload = {}
for name in names:
    text = (source / name).read_text(encoding="utf-8-sig")
    # Windows PowerShell 5.1 requires a BOM to read Korean reliably.
    encoding = "utf-8-sig" if name.endswith((".ps1", ".psm1", ".txt")) else "ascii"
    payload[name] = text.replace("\r\n", "\n").replace("\n", "\r\n").encode(encoding)
manifest = {"version": "1.1.0", "files": {name: hashlib.sha256(data).hexdigest() for name, data in payload.items()}}
payload["checksums.json"] = json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")
dest = repo / "public/downloads/aywa-collection-pc-1.1.0.zip"
dest.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
    for name, data in payload.items():
        entry = zipfile.ZipInfo(name, date_time=(2026, 11, 2, 0, 0, 0))
        entry.compress_type = zipfile.ZIP_DEFLATED
        archive.writestr(entry, data)
with zipfile.ZipFile(dest) as archive:
    assert set(archive.namelist()) == set(payload)
    for name, data in payload.items():
        assert archive.read(name) == data
print(json.dumps({"package": str(dest), "bytes": dest.stat().st_size, "sha256": hashlib.sha256(dest.read_bytes()).hexdigest(), "entries": len(payload)}))
