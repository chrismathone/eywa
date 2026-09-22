"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { EXAM_SLOT_LABEL } from "../exam-slots";
import { TERM_LABEL } from "../term";
import {
  AXIS_SHEET_NAME,
  REQUIRED_SCORE_HEADERS,
  SCORE_SHEET_COLUMNS,
  SCORE_SHEET_NAME,
  isBlankCells,
  mapHeaders,
  parseAxisSheetRows,
  parseScoreRow,
  scoreConflictErrors,
  type GradeSheetAxis,
  type ScoreSheetKey,
  type ScoreSheetRow,
} from "../sheet";
import type { GradeSelection } from "../types";
import { gradeWriteError } from "./access";
import { getGradeSheet } from "./queries";
// ⚠️ `gradesSchemaReady()`를 따로 부르지 않는다 — `getGradeSheet`가 이미 `schemaReady`로 알려 준다(왕복 1회).
import { writeGradeCells } from "./write";

/**
 * 성적 엑셀 올리기 — 원장 2026-09-22: *"양식에 맞춰서 성적하고 기입 쭈루룩해서 업로드할수있는 기능"*.
 *
 * 흐름: 파일 → 서식 확인(안내 시트의 축 · 성적 시트의 학생ID·점수 열) → 행 파싱 → **그 학기 명단과 대조**
 * → 행별 미리보기(반영/그대로) → **오류가 하나라도 있으면 아무것도 안 쓴다** → `dryRun`이면 여기서 끝.
 *
 * 🔴 **축은 파일이 정한다**(안내 시트) — 화면에서 고른 축과 대조하지 않는다(sheet.ts 머리주석).
 *    대신 미리보기가 "2026년 2학기 · 영어(EiE) · 듣기평가"를 크게 적어 사람이 확인한다.
 * 🔴 **빈 점수 칸은 건드리지 않는다**(원장 선택) — 지우기는 화면에서. 그래서 파일로는 성적이 사라질 수 없다.
 * 🔴 **명단 밖 학생ID는 오류**([[#77]]) — 파일로 남의 반·남의 학기 성적을 밀어 넣는 우회를 막는다.
 *    판정 근거는 화면과 같은 `getGradeSheet`(강사 스코프도 그 안에서 걸린다).
 * ⚠️ 5MB까지. 엑셀 날짜 칸은 시간대가 없어 UTC 성분으로 읽는다(`cellText`).
 */
export type GradesExcelCounts = { total: number; apply: number; keep: number };
export type GradesExcelPreviewRow = {
  rowNum: number;
  name: string;
  className: string;
  action: "apply" | "keep";
  summary: string;
};
export type GradesExcelResult =
  | {
      error?: string;
      /** 서식 자체가 안 맞음 — 화면이 파일 선택을 취소한다. */
      formatMismatch?: boolean;
      dryRun?: boolean;
      /** 이 파일이 어느 칸에 들어가는지(한글 한 줄). 사람이 확인하는 자리다. */
      axisSummary?: string;
      counts?: GradesExcelCounts;
      preview?: GradesExcelPreviewRow[];
      /** 보여 줄 만큼만(최대 30건). 전체 건수는 `errorTotal`. */
      errors?: string[];
      /** 오류 전체 건수 — 목록을 잘라도 "몇 건 남았는지"는 사실대로. */
      errorTotal?: number;
      notes?: string[];
      applied?: boolean;
    }
  | undefined;

const MAX_BYTES = 5 * 1024 * 1024;
const PREVIEW_MAX = 200;
const ERROR_MAX = 30;

/** ExcelJS 셀 값 → 문자열(richText·수식 결과·날짜 안전화). 엑셀 날짜엔 시간대가 없어 UTC 성분으로 읽는다. */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (o.result != null) return cellText(o.result);
    return String(v);
  }
  return String(v);
}

function readScoreSheet(ws: ExcelJS.Worksheet) {
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell.value);
  });
  const map = mapHeaders<ScoreSheetKey>(headers, SCORE_SHEET_COLUMNS);
  const rows: { rowNum: number; cells: Partial<Record<ScoreSheetKey, string>> }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Partial<Record<ScoreSheetKey, string>> = {};
    for (const [key, idx] of map) cells[key] = cellText(row.getCell(idx + 1).value).trim();
    if (isBlankCells(cells)) continue;
    rows.push({ rowNum: r, cells });
  }
  return { map, rows };
}

/** 안내 시트 = `항목 | 값` 두 열(3열 '설명'은 사람용). 모르는 줄은 파서가 무시한다. */
function readAxisSheet(ws: ExcelJS.Worksheet): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    out.push({ label: cellText(row.getCell(1).value).trim(), value: cellText(row.getCell(2).value).trim() });
  }
  return out;
}

export async function importGradesExcel(fd: FormData): Promise<GradesExcelResult> {
  // 🔴 게이트가 맨 앞 — 화면이 버튼을 감췄는지와 무관하게 여기서 막는다([[#77]]).
  const gate = await gradeWriteError();
  if (gate) return { error: gate };

  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "엑셀 파일을 선택하세요" };
  if (file.size > MAX_BYTES) return { error: "파일이 너무 큽니다(5MB까지)", formatMismatch: true };
  const dryRun = String(fd.get("dryRun") ?? "") === "1";

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return { error: "엑셀 파일을 읽지 못했습니다 — xlsx 형식인지 확인하세요", formatMismatch: true };
  }

  const axisWs = wb.getWorksheet(AXIS_SHEET_NAME);
  if (!axisWs) {
    return {
      error: `'${AXIS_SHEET_NAME}' 시트가 없습니다 — 어느 학기·시험에 넣을지 알 수 없습니다. [서식 내려받기]로 받은 파일에 작성해 주세요.`,
      formatMismatch: true,
    };
  }
  const parsedAxis = parseAxisSheetRows(readAxisSheet(axisWs));
  if (!parsedAxis.ok) return { error: `${parsedAxis.error} — [서식 내려받기]로 받은 파일에 작성해 주세요.`, formatMismatch: true };
  const axis: GradeSheetAxis = parsedAxis.row;

  const scoreWs = wb.getWorksheet(SCORE_SHEET_NAME) ?? wb.worksheets[0];
  if (!scoreWs) return { error: "시트를 찾을 수 없습니다 — 내려받은 서식으로 작성해 주세요", formatMismatch: true };
  const sheetRead = readScoreSheet(scoreWs);
  const missing = REQUIRED_SCORE_HEADERS.filter((k) => !sheetRead.map.has(k)).map(
    (k) => SCORE_SHEET_COLUMNS.find((c) => c.key === k)!.header,
  );
  if (missing.length > 0) {
    return {
      error: `서식이 일치하지 않습니다 — '${SCORE_SHEET_NAME}' 시트에 ${missing.map((h) => `'${h}'`).join("·")} 열이 없습니다. [서식 내려받기]로 받은 파일에 작성해 주세요.`,
      formatMismatch: true,
    };
  }

  const errors: string[] = [];
  const notes: string[] = [];
  const parsedRows: ScoreSheetRow[] = [];
  const nameByRow = new Map<number, string>();
  for (const { rowNum, cells } of sheetRead.rows) {
    nameByRow.set(rowNum, String(cells.name ?? "").trim());
    const p = parseScoreRow(cells, rowNum, axis.maxScore);
    if (p.ok) parsedRows.push(p.row);
    else errors.push(p.error);
  }
  errors.push(...scoreConflictErrors(parsedRows));

  // 축 요약 — 과목 라벨은 학원설정이 단일 소스(하드코딩 금지).
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const trackPart = axis.track ? ` (${ENGLISH_TRACK_LABEL[axis.track]})` : "";
  const axisSummary = `${axis.year}년 ${TERM_LABEL[axis.term]} · ${subjects.labelOf(axis.subject)}${trackPart} · ${EXAM_SLOT_LABEL[axis.slot]} · 만점 ${axis.maxScore} · 시험일 ${axis.date}`;

  if (parsedRows.length === 0 && errors.length === 0) return { error: "데이터 행이 없습니다", axisSummary };

  // 명단(= 화면과 같은 조회). 반 전체를 받아 파일의 학생ID를 대조한다.
  const selection: GradeSelection = {
    year: axis.year,
    term: axis.term,
    subject: axis.subject,
    track: axis.track,
    classId: null,
    slot: axis.slot,
    date: axis.date,
    maxScore: axis.maxScore,
  };
  let roster: Awaited<ReturnType<typeof getGradeSheet>>;
  try {
    roster = await getGradeSheet(selection);
  } catch {
    return { error: "명단을 불러오지 못했습니다 — 잠시 뒤 다시 시도해 주세요", axisSummary };
  }
  if (!roster.schemaReady) {
    return {
      error: "성적 표가 아직 준비되지 않아 반영할 수 없습니다(마이그레이션 0283a 적용 필요) — 내려받기·미리보기는 됩니다.",
      axisSummary,
    };
  }

  /** 학생ID → 그 학기 명단 줄들(한 학생이 두 반이면 여럿). */
  const byStudent = new Map<string, { classId: string; className: string; name: string; score: number | null }[]>();
  for (const r of roster.rows) {
    const arr = byStudent.get(r.studentId) ?? [];
    arr.push({ classId: r.classId, className: r.className, name: r.name, score: r.score });
    byStudent.set(r.studentId, arr);
  }

  const preview: GradesExcelPreviewRow[] = [];
  const toWrite: { studentId: string; classId: string | null; score: number }[] = [];
  const seenWrite = new Set<string>();
  for (const row of parsedRows) {
    const hits = byStudent.get(row.studentId);
    if (!hits || hits.length === 0) {
      const who = nameByRow.get(row.rowNum);
      errors.push(
        `${row.rowNum}행: 이 학기 명단에 없는 학생입니다${who ? `(${who})` : ""} — 학생ID를 고쳤거나 다른 학기·과목 시트일 수 있습니다`,
      );
      continue;
    }
    const cur = hits[0]!;
    const className = hits.length > 1 ? `${cur.className} 외 ${hits.length - 1}` : cur.className;
    if (row.score === undefined) {
      preview.push({ rowNum: row.rowNum, name: cur.name, className, action: "keep", summary: "빈 칸 — 그대로 둡니다" });
      continue;
    }
    const same = cur.score != null && cur.score === row.score;
    preview.push({
      rowNum: row.rowNum,
      name: cur.name,
      className,
      action: same ? "keep" : "apply",
      summary: same
        ? `${row.score}점 — 이미 같은 점수입니다`
        : cur.score == null
          ? `${row.score}점 기입`
          : `${cur.score}점 → ${row.score}점`,
    });
    if (same) continue;
    // 한 학생이 두 줄(두 반)이어도 성적은 하나 — 같은 값이라 한 번만 쓴다(sheet.ts scoreConflictErrors).
    if (seenWrite.has(row.studentId)) continue;
    seenWrite.add(row.studentId);
    // 🔑 반이 둘이면 `class_id`를 비운다 — "어느 반 화면에서 적었나"를 남기는 값이라 추측해 넣지 않는다.
    toWrite.push({ studentId: row.studentId, classId: hits.length === 1 ? cur.classId : null, score: row.score });
  }
  const multi = parsedRows.filter((r) => (byStudent.get(r.studentId)?.length ?? 0) > 1).length;
  if (multi > 0) notes.push(`두 반 이상 듣는 학생이 ${multi}줄 있습니다 — 성적은 한 벌이라 한 번만 반영됩니다`);

  const counts: GradesExcelCounts = {
    total: parsedRows.length,
    apply: toWrite.length,
    keep: preview.filter((p) => p.action === "keep").length,
  };
  if (preview.length > PREVIEW_MAX) notes.push(`미리보기는 앞 ${PREVIEW_MAX}행만 보여 줍니다(반영은 전부 됩니다)`);
  const base = { axisSummary, counts, preview: preview.slice(0, PREVIEW_MAX), notes };
  // 오류 목록은 잘라 보내되 **몇 건인지는 숨기지 않는다**(30건만 보이면 다 고쳤다고 착각한다).
  if (errors.length > 0 || dryRun) {
    return { ...base, dryRun, errors: errors.slice(0, ERROR_MAX), errorTotal: errors.length, applied: false };
  }
  if (toWrite.length === 0) return { ...base, dryRun: false, errors: [], applied: true };

  try {
    await writeGradeCells(
      {
        subject: axis.subject,
        year: axis.year,
        term: axis.term,
        slot: axis.slot,
        date: axis.date,
        maxScore: axis.maxScore,
      },
      toWrite,
    );
  } catch {
    return { ...base, dryRun: false, errors: [], applied: false, error: "성적을 저장하지 못했습니다 — 잠시 뒤 다시 시도해 주세요" };
  }

  await logAction({
    action: "exam_scores",
    targetType: "exam",
    targetLabel: `${axisSummary} (엑셀)`,
    metadata: {
      source: "excel",
      fileName: file.name,
      year: axis.year,
      term: axis.term,
      subject: axis.subject,
      track: axis.track,
      slot: axis.slot,
      // 감사로그 문구(`auditDetail`)가 읽는 키 — 화면 저장과 같은 이름이어야 "학생 N명 중 점수 M건 저장"이 뜬다.
      saved: toWrite.length,
      students: roster.rows.length,
      kept: counts.keep,
    },
  });
  revalidatePath("/exams");
  return { ...base, dryRun: false, errors: [], applied: true };
}
