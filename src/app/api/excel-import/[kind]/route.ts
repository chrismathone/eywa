import { NextResponse } from "next/server";
import { kstToday } from "@/lib/date-kst";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { loadImporter } from "@/features/excel-import/server/registry";
import { gateImport, runImport } from "@/features/excel-import/server/run";
import { buildTemplate } from "@/features/excel-import/server/workbook";

/**
 * 엑셀 가져오기 공용 주소 — `GET` = 서식 내려받기 · `POST` = 올리기(미리보기·반영·오류 표시 파일).
 * 서버 액션이 아니라 route인 이유: 서버 액션 요청 본문 기본 한도가 1MB라 원생·출결 파일이 막힌다(여기는 5MB).
 * 🔴 파일명 한글은 헤더에 직접 넣지 않는다(B1 — `attachmentFilename`). 게이트는 `gateImport`(full만) 한 곳.
 */
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const def = await loadImporter((await params).kind);
  if (!def) return NextResponse.json({ error: "없는 가져오기입니다" }, { status: 404 });
  const gate = await gateImport(def);
  if ("error" in gate) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const sheets = await def.template(gate);
  const wb = buildTemplate(def.title, sheets, def.guide);
  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf, {
    headers: { "Content-Type": XLSX, "Content-Disposition": attachmentFilename(`${def.title}_서식_${kstToday()}.xlsx`), "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const def = await loadImporter((await params).kind);
  if (!def) return NextResponse.json({ error: "없는 가져오기입니다" }, { status: 404 });
  let fd: FormData;
  try {
    fd = await req.formData();
  } catch {
    return NextResponse.json({ error: "파일을 받지 못했습니다(5MB까지)" }, { status: 400 });
  }
  const out = await runImport(def, fd);
  if (out.kind === "file") {
    return new NextResponse(new Uint8Array(out.buf), {
      headers: { "Content-Type": XLSX, "Content-Disposition": attachmentFilename(out.name), "Cache-Control": "no-store" },
    });
  }
  return NextResponse.json(out.body, { status: out.status ?? 200 });
}
