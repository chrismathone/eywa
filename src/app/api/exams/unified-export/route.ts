import ExcelJS from "exceljs";
import { NextResponse, type NextRequest } from "next/server";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { attachmentFilename } from "@/lib/http/content-disposition";
import { getUnifiedGrades } from "@/features/grades/unified/server/queries";
import { KIND_LABEL, schoolGradeLabel, withPreviousScores } from "@/features/grades/unified/model";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: string | null): value is string {
  if (!value || !ISO.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export async function GET(request: NextRequest) {
  await requireAccess("exams");
  const params = request.nextUrl.searchParams;
  const today = kstToday();
  const to = validDate(params.get("to")) ? params.get("to")! : today;
  const fallback = new Date(`${to}T00:00:00Z`);
  fallback.setUTCDate(fallback.getUTCDate() - 180);
  const start = fallback.toISOString().slice(0, 10);
  const from = validDate(params.get("from")) && params.get("from")! <= to ? params.get("from")! : start;
  const kind = params.get("kind") ?? "all";
  const subject = params.get("subject") ?? "all";
  const showMissing = params.get("missing") === "1";
  const [data, settings] = await Promise.all([getUnifiedGrades(from, to), getTenantSettings()]);
  // 과목 칸은 학원설정 라벨로(내부 키 `math`·`subject_1`을 내보내지 않는다 — 전수 점검 D3).
  const { labelOf } = buildSubjectMaps(settings.operations.subjects);
  const rows = withPreviousScores(data.records).filter((row) => row.date >= from && row.date <= to &&
    (kind === "all" || row.kind === kind) && (subject === "all" || row.subject === subject) &&
    (showMissing || row.score != null || row.source === "level" || !!row.rawScore));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("통합 성적 원장", { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = [
    { header: "시험일", key: "date", width: 14 }, { header: "이름", key: "name", width: 14 },
    { header: "학교학년", key: "schoolGrade", width: 17 }, { header: "과목", key: "subject", width: 14 },
    { header: "반", key: "classes", width: 30 }, { header: "담임", key: "teachers", width: 18 },
    { header: "시험", key: "kind", width: 17 }, { header: "점수", key: "score", width: 11 },
    { header: "만점", key: "maxScore", width: 11 }, { header: "이전 점수", key: "previous", width: 13 },
    { header: "증감", key: "delta", width: 13 }, { header: "상담일", key: "consultation", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF153E75" } };
  sheet.autoFilter = { from: "A1", to: "L1" };
  for (const row of rows) {
    const added = sheet.addRow({ date: row.date, name: row.name, schoolGrade: schoolGradeLabel(row.school, row.grade),
      subject: labelOf(row.subject), classes: row.classes.map((item) => item.name).join(" / "),
      teachers: [...new Set(row.classes.map((item) => item.teacher).filter(Boolean))].join(" / "),
      kind: KIND_LABEL[row.kind],
      // 숫자로 못 읽은 결과(레벨·원문 점수)는 빈칸이 아니라 원문 그대로(D3).
      score: row.score ?? row.rawScore, maxScore: row.maxScore, previous: row.previousScore,
      delta: row.delta == null ? null : `${row.delta > 0 ? "↑" : row.delta < 0 ? "↓" : ""}${Math.abs(row.delta)}${row.deltaUnit === "%p" ? "%p" : ""}`,
      consultation: row.consultationDate ?? row.manualConsultationDate,
    });
    if (row.delta != null && row.delta !== 0) added.getCell(11).font = { color: { argb: row.delta > 0 ? "FF078552" : "FFD73A49" } };
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new NextResponse(buffer, { headers: {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": attachmentFilename(`통합성적_${from}_${to}.xlsx`),
  } });
}
