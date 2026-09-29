import "server-only";
import ExcelJS from "exceljs";
import { colLetter, issueText, type ImportIssue, type SheetSpec } from "../spec";

/**
 * ExcelJS 경계 — 읽기(격자로) · 서식 만들기 · **오류 칸 표시 파일**(원장 2026-09-29 *"어디서 업로드 에러가 나는지도 확인가능하게"*).
 * 🔑 날짜 칸은 시간대가 없어 UTC 성분으로 읽는다(재고·성적과 같은 규약).
 */

export const GUIDE_SHEET_NAME = "안내";
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
const REQUIRED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFDE2C4" } };
const ERROR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
const VALIDATION_ROWS = 1000;
const INLINE_LIST_MAX = 250;

export function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    const d = `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
    // 엑셀 '시각'만 있는 칸은 1899-12-30 날짜로 온다 → HH:MM
    if (v.getUTCFullYear() <= 1900) return `${String(v.getUTCHours()).padStart(2, "0")}:${String(v.getUTCMinutes()).padStart(2, "0")}`;
    return d;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (o.result != null) return cellText(o.result);
    if (o.error != null) return "";
    return String(v);
  }
  return String(v);
}

export async function loadWorkbook(buf: ArrayBuffer): Promise<ExcelJS.Workbook | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf);
    return wb;
  } catch {
    return null;
  }
}

/** 시트 → 문자열 격자(행 index 0 = 엑셀 1행). */
export function sheetGrid(ws: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const line: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      line[col - 1] = cellText(cell.value);
    });
    out.push(Array.from(line, (x) => x ?? ""));
  }
  return out;
}

/** 시트 이름(또는 별칭 — 내보내기 파일의 시트 이름)으로 찾기(공백 무시). 시트가 하나뿐인 가져오기면 첫 시트로 폴백. */
export function findSheet(wb: ExcelJS.Workbook, name: string, fallbackFirst: boolean, aliases: readonly string[] = []): ExcelJS.Worksheet | null {
  const squash = (s: string) => s.replace(/\s+/g, "");
  const want = squash(name);
  const hit = wb.worksheets.find((w) => squash(w.name) === want) ?? wb.worksheets.find((w) => aliases.some((a) => squash(a) === squash(w.name)));
  if (hit) return hit;
  if (!fallbackFirst) return null;
  return wb.worksheets.find((w) => w.name !== GUIDE_SHEET_NAME) ?? null;
}

export type TemplateSheet = { spec: SheetSpec; rows: Record<string, string | number | null>[] };

/**
 * 서식 — 시트마다 머리 줄(필수 열은 주황 + `*`) · 드롭다운 · 틀 고정 + 안내 시트(열 설명·매칭 키·방식).
 * `rows`에 지금 데이터를 담으면 그 파일을 고쳐 **덮어쓰기**로 다시 올릴 수 있다.
 */
export function buildTemplate(title: string, sheets: TemplateSheet[], guideLines: readonly string[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "에이와";
  wb.created = new Date();
  for (const { spec, rows } of sheets) {
    const ws = wb.addWorksheet(spec.name);
    // 내보내기 파일 전용 열(exportOnly)은 서식에 싣지 않는다 — 읽을 줄만 안다.
    const cols = spec.columns.filter((c) => !c.exportOnly);
    ws.columns = cols.map((c) => ({ header: c.required ? `${c.header}*` : c.header, key: c.key, width: c.width ?? 14 }));
    const head = ws.getRow(1);
    head.font = { bold: true };
    cols.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.fill = c.required ? REQUIRED_FILL : HEADER_FILL;
      if (c.hint) cell.note = c.hint;
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of rows) ws.addRow(r);
    // 모든 칸을 글자로 — 전화번호 앞 0·긴 숫자가 엑셀에서 깨지지 않게
    cols.forEach((_, i) => {
      ws.getColumn(i + 1).numFmt = "@";
    });
    cols.forEach((c, i) => {
      if (!c.options?.length) return;
      const safe = c.options.filter((l) => !/[",]/.test(l));
      const joined = safe.join(",");
      if (!safe.length || joined.length > INLINE_LIST_MAX) return;
      const dv: ExcelJS.DataValidation = { type: "list", allowBlank: true, showErrorMessage: !!c.strictOptions, formulae: [`"${joined}"`] };
      const L = colLetter(i);
      for (let r = 2; r <= Math.max(VALIDATION_ROWS, rows.length + 200); r++) ws.getCell(`${L}${r}`).dataValidation = dv;
    });
  }
  const guide = wb.addWorksheet(GUIDE_SHEET_NAME);
  guide.columns = [
    { header: `${title} 엑셀 서식 안내`, key: "a", width: 22 },
    { header: "", key: "b", width: 18 },
    { header: "", key: "c", width: 90 },
  ];
  guide.getRow(1).font = { bold: true, size: 13 };
  for (const t of guideLines) guide.addRow({ a: t });
  guide.addRow({});
  guide.addRow({ a: "시트", b: "열", c: "설명(* = 필수 · 주황 칸)" }).font = { bold: true };
  for (const { spec } of sheets) {
    if (spec.keyHint) guide.addRow({ a: spec.name, b: "(매칭 키)", c: spec.keyHint });
    for (const c of spec.columns.filter((x) => !x.exportOnly)) {
      const opts = c.options?.length ? ` 선택: ${c.options.join(" · ")}` : "";
      guide.addRow({ a: spec.name, b: c.required ? `${c.header}*` : c.header, c: `${c.hint ?? ""}${opts}`.trim() });
    }
  }
  return wb;
}

/**
 * 올린 파일에 **오류 칸을 빨갛게 칠하고 메모를 단** 사본 + 맨 앞에 '오류목록' 시트. 행·열을 모르는 오류는 목록에만.
 * 사람이 이 파일을 열어 빨간 칸만 고쳐 다시 올리면 된다.
 */
export async function annotateErrors(wb: ExcelJS.Workbook, issues: readonly ImportIssue[]): Promise<Buffer> {
  for (const i of issues) {
    if (!i.row) continue;
    const ws = wb.worksheets.find((w) => w.name.replace(/\s+/g, "") === i.sheet.replace(/\s+/g, ""));
    if (!ws) continue;
    if (i.col) {
      const cell = ws.getCell(`${i.col}${i.row}`);
      cell.fill = ERROR_FILL;
      const prev = typeof cell.note === "string" ? `${cell.note}\n` : "";
      cell.note = `${prev}${i.message}`;
    } else {
      ws.getRow(i.row).eachCell({ includeEmpty: false }, (c) => {
        c.fill = ERROR_FILL;
      });
      const first = ws.getRow(i.row).getCell(1);
      first.note = `${typeof first.note === "string" ? `${first.note}\n` : ""}${i.message}`;
    }
  }
  const old = wb.getWorksheet("오류목록");
  if (old) wb.removeWorksheet(old.id);
  const list = wb.addWorksheet("오류목록");
  list.columns = [
    { header: "시트", key: "sheet", width: 12 },
    { header: "행", key: "row", width: 6 },
    { header: "열", key: "col", width: 6 },
    { header: "열 제목", key: "header", width: 14 },
    { header: "적은 값", key: "value", width: 22 },
    { header: "문제", key: "message", width: 70 },
  ];
  list.getRow(1).font = { bold: true };
  list.getRow(1).fill = HEADER_FILL;
  for (const i of issues) list.addRow({ sheet: i.sheet, row: i.row ?? "", col: i.col ?? "", header: i.header ?? "", value: i.value ?? "", message: i.message });
  // 파일을 열면 '오류목록'부터 보이게 — 시트 순서는 못 바꾸니(ExcelJS) 활성 탭으로 연다.
  const at = wb.worksheets.findIndex((w) => w.name === "오류목록");
  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: Math.max(0, at), visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export { issueText };
