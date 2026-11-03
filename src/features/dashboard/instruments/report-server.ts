import "server-only";
import { HOMEWORK_WINDOW_DAYS, UNREAD_WINDOW_DAYS } from "@/features/dashboard/onescreen/server/queries";
import { monthKeys } from "@/features/dashboard/overview/model";
import { mondayOf } from "@/features/consultations/stats-recent";
import { reportTrend, type ReportBucketRow } from "@/features/lesson-reports/stats/report-trend";
import type { getTenantSettings } from "@/features/owner/server/queries";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { createClient } from "@/lib/supabase/server";
import type { ReportExtras } from "./extras-types";
import { foldWeeks, homeworkStudents, reportCells, type HomeworkRecord } from "./report-board";

const WEEKS = 12;
const MONTHS = 12;
const DAY = 86_400_000;
const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * 학습 · 학부모 보고 카드·상세의 값 — 수업보고서 통계와 같은 RPC(`lesson_report_buckets`)와 운영실 카드와 같은 과목 축이다.
 * 달 칸은 달 집계로, 주 칸은 날 집계를 접어 만든다(RPC에 주 칸이 없다). 명단은 학생 메뉴를 볼 수 있을 때만(`withNames`).
 */
export async function loadReportExtras(today: string, settings: Awaited<ReturnType<typeof getTenantSettings>>, opts: { classnoteOn: boolean; withNames: boolean }): Promise<ReportExtras> {
  const db = await createClient();
  const tracked = (settings.report.classnoteSubjects ?? []).map((v) => String(v ?? "").trim()).filter(Boolean);
  const from = shift(mondayOf(today), -(WEEKS - 1) * 7);
  const days = Array.from({ length: Math.round((Date.parse(today) - Date.parse(from)) / DAY) + 1 }, (_, i) => shift(from, i));
  const months = monthKeys(today, MONTHS);
  const buckets = (start: string, grain: "day" | "month") => fetchAllPaged<ReportBucketRow>((a, b) =>
    db.rpc("lesson_report_buckets", { p_from: start, p_to: today, p_grain: grain }).order("bucket").order("subject").order("homework_score").range(a, b));
  const [dayRows, monthRows, records] = await Promise.all([
    buckets(from, "day"),
    buckets(`${months[0]}-01`, "month"),
    opts.withNames
      ? fetchAllPaged<HomeworkRecord>((a, b) => {
          let q = db.from("lesson_reports").select("student_id, class_id, subject, homework_score, report_date").gte("report_date", shift(today, -(HOMEWORK_WINDOW_DAYS - 1))).lte("report_date", today);
          if (tracked.length) q = q.in("subject", tracked);
          return q.order("id", { ascending: true }).range(a, b);
        })
      : null,
  ]);
  const dayTrend = reportTrend({ rows: dayRows, tracked, period: { grain: "day", days, from, to: today, month: null, clipped: false } });
  const since = shift(today, -(UNREAD_WINDOW_DAYS - 1));
  const recent = reportCells(dayTrend).filter((d) => d.key >= since);
  const picked = records ? homeworkStudents(records) : null;
  const names = picked
    ? await fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(picked.map((s) => s.id), (chunk) => db.from("students").select("id, name, school, grade").in("id", chunk))
    : [];
  const byId = new Map(names.map((s) => [s.id, s]));
  return {
    weeks: foldWeeks(dayTrend),
    months: reportCells(reportTrend({ rows: monthRows, tracked, period: { grain: "month", months } })),
    read: opts.classnoteOn ? { read: recent.reduce((n, d) => n + d.read, 0), sent: recent.reduce((n, d) => n + d.sent, 0) } : null,
    students: picked ? picked.map((s) => { const row = byId.get(s.id); return { ...s, name: row?.name ?? "—", schoolGrade: row ? schoolGradeLabel(row.school, row.grade) || null : null }; }) : null,
  };
}
