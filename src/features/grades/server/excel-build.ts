import "server-only";
import ExcelJS from "exceljs";
import { ENGLISH_TRACK_LABEL } from "@/features/classes/english-track";
import { AXIS_SHEET_NAME, SCORE_SHEET_COLUMNS, SCORE_SHEET_NAME, axisSheetRows, type GradeSheetAxis } from "../sheet";
import type { GradeSheet } from "../types";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
/** 학생ID 열 — 고치면 안 되는 앵커라 옅게 깔아 눈에 띄게 한다. */
const ANCHOR_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F7" } };

/**
 * 성적 엑셀 — **지금 화면에 선 명단과 점수가 그대로 들어간 파일**(빈 서식이 아니다, 재고 선례).
 * 고쳐서 다시 올리면 적힌 칸만 반영되고 빈 칸은 그대로 남는다(원장 2026-09-22).
 *
 * 🔑 축(년도·학기·과목·트랙·시험·만점·시험일)은 `안내` 시트가 든다 — 파일이 스스로 어디에 쓰일지 말한다.
 *    값은 `axisSheetRows` 한 곳에서 나오고 파서도 같은 함수를 기준으로 읽는다(왕복 보장, sheet.ts).
 * 🔴 빈 점수는 **빈 칸**으로 낸다(`—`·`0`을 적지 않는다) — 다시 올릴 때 "안 적은 칸"으로 읽혀야 한다.
 */
export async function buildGradesWorkbook(
  sheet: GradeSheet,
  meta: { subjectLabel: string; slotLabel: string },
): Promise<ExcelJS.Workbook> {
  const { selection } = sheet;
  // ⚠️ 만점은 `selection`이 단일 소스다(화면·엑셀·저장이 같은 값을 본다) — meta로 또 받지 않는다.
  const axis: GradeSheetAxis = {
    year: selection.year,
    term: selection.term,
    subject: selection.subject,
    track: selection.track,
    slot: selection.slot,
    maxScore: selection.maxScore,
    date: selection.date,
  };

  const wb = new ExcelJS.Workbook();
  wb.creator = "aywa";
  wb.created = new Date();

  const ws = wb.addWorksheet(SCORE_SHEET_NAME);
  ws.columns = SCORE_SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const r of sheet.rows) {
    ws.addRow({
      studentId: r.studentId,
      name: r.name,
      school: r.school ?? "",
      grade: r.grade ?? "",
      className: r.className,
      // 🔴 점수 없음 = 빈 칸(0이 아니다). 0을 적으면 안 본 시험이 0점으로 굳는다.
      score: r.score ?? "",
    });
  }
  const anchorCol = SCORE_SHEET_COLUMNS.findIndex((c) => c.key === "studentId") + 1;
  for (let r = 2; r <= sheet.rows.length + 1; r++) ws.getCell(r, anchorCol).fill = ANCHOR_FILL;

  const guide = wb.addWorksheet(AXIS_SHEET_NAME);
  guide.columns = [
    { header: "항목", key: "label", width: 14 },
    { header: "값", key: "value", width: 24 },
    { header: "설명", key: "note", width: 40 },
  ];
  guide.getRow(1).font = { bold: true };
  guide.getRow(1).fill = HEADER_FILL;
  const trackLabel = selection.track ? ENGLISH_TRACK_LABEL[selection.track] : "";
  for (const row of axisSheetRows(axis, { ...meta, trackLabel })) {
    guide.addRow(row);
  }
  guide.addRow({});
  const lines = [
    "이 파일은 위 축(학기·과목·시험)으로 반영됩니다 — 값 칸은 고치지 마세요.",
    "'성적' 시트의 점수 칸만 채워서 성적관리 화면의 [엑셀] → 파일 선택 → [반영]으로 올립니다.",
    "빈 점수 칸은 그대로 둡니다(이미 넣어 둔 성적을 지우지 않습니다). 점수를 지우려면 화면에서 지우세요.",
    "0점은 유효한 점수입니다 — 결석·미응시는 빈 칸으로 두세요.",
    "학생ID 열(회색)은 매칭 키입니다. 고치거나 지우면 그 행은 반영되지 않습니다.",
    "명단에 없는 학생ID를 새로 적어 넣을 수는 없습니다(반 배정은 학생·수업 화면에서).",
    "오류가 하나라도 있으면 아무것도 반영하지 않습니다 — 미리보기에서 고칠 곳을 알려 줍니다.",
  ];
  for (const t of lines) guide.addRow({ label: `· ${t}` });
  return wb;
}
