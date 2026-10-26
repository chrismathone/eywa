import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { assembleRatingReports, type SentReport } from "../harness/assemble";
import type { RatingReport } from "../harness/types";

/**
 * 평점 재료 — 대상 보고서 + 비교 재료(그 학생들의 이전 발송분 · 그 날짜들의 같은 반 발송분)를 읽어 옛 추출기와 같은 계산으로 붙인다.
 * 🔴 admin(RLS 우회)이라 **tenant_id 필터 필수**. 임베드는 쓰지 않는다(lesson_reports → classes FK가 여럿이라 이름 없는 임베드는 깨진다, [[#94]]).
 * 🔴 학생 id 목록 × 여러 달 보고서 = 청크 안에서도 1,000행을 넘을 수 있다 → `fetchAllPagedInChunks` + id 정렬([[#54]]).
 */
const COLS = "id, report_date, subject, makeup, student_id, created_at, class_id, makeup_class_id, classnote_class_id, textbook, progress, homework_today, daily_test, check_test, exam_info, homework_score, attitude, notes, trend_note, video_homework, classnote_status, classnote_queued_at";
/** 비교 재료의 모집단 — 옛 추출기와 같게 정상·회수. 평점 대상은 정상(success)만(아래). */
const SENT = ["success", "recalled"];
/** 직전 보고서를 찾는 폭 — 그보다 오래 쉰 과목은 '직전 알림장 없음'으로 본다(옛 배치는 폭이 없었다 — 차이는 드물다). */
const PREV_LOOKBACK_DAYS = 400;

type Row = {
  id: string; report_date: string; subject: string | null; makeup: boolean | null; student_id: string; created_at: string;
  class_id: string | null; makeup_class_id: string | null; classnote_class_id: string | null;
  textbook: string | null; progress: string | null; homework_today: string | null; daily_test: string | null; check_test: string | null;
  exam_info: string | null; homework_score: string | null; attitude: string | null; notes: string | null; trend_note: string | null;
  video_homework: boolean | null; classnote_status: string | null; classnote_queued_at: string | null;
};
type Student = { id: string; name: string | null; school: string | null; grade: string | null; is_test: boolean | null };

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** 평점을 지금 매길 수 없는 보고서 — drop = 매기지 않는다(줄을 닫는다) · wait = 아직 발송 전(다시 보내는 중 등)이라 다음에 다시 본다. */
export type RatingSkip = { drop: boolean; reason: string };
/** mentSource = 대상 보고서의 멘트 작성 방식(0214a) — 기준 v6의 자동작성 상한이 읽는다(비교 재료에는 없다). */
export type RatingMaterial = { reports: Map<string, RatingReport>; skip: Map<string, RatingSkip>; mentSource: Map<string, string | null> };

/**
 * 대상 id → 평점 재료. 대상은 **정상 발송(success)된 보고서만** — 회수된 보고서는 학부모가 보지 않은 글이라 매기지 않는다.
 * 비교 재료(직전 글 · 같은 반 같은 날)는 옛 모집단 그대로 정상·회수 둘 다(10-22 오프라인 배치와 같은 계산).
 */
export async function loadRatingMaterial(tenantId: string, reportIds: readonly string[]): Promise<RatingMaterial> {
  const db = createAdminClient();
  const targets = await fetchInChunks<Row & { ment_source: string | null }>([...reportIds], (chunk) =>
    db.from("lesson_reports").select(`${COLS}, ment_source`).eq("tenant_id", tenantId).in("id", chunk));
  const mentSource = new Map(targets.map((r) => [r.id, r.ment_source ?? null]));
  const skip = new Map<string, RatingSkip>();
  const found = new Map(targets.map((r) => [r.id, r]));
  for (const id of reportIds) {
    const r = found.get(id);
    if (!r) skip.set(id, { drop: true, reason: "보고서가 없습니다" });
    // 회수는 끝이 아니다 — 고쳐 다시 보내는 길이다(회수 → 발송). 기다렸다가 다시 나가면 매기고, 14일 안에 안 나가면 대기열이 닫는다.
    else if (r.classnote_status === "recalled") skip.set(id, { drop: false, reason: "회수된 보고서 — 다시 보내면 매깁니다" });
    else if (r.classnote_status !== "success" || !r.classnote_queued_at) skip.set(id, { drop: false, reason: "아직 발송되지 않았습니다(다시 보내는 중)" });
  }
  const live = targets.filter((r) => !skip.has(r.id));
  if (!live.length) return { reports: new Map(), skip, mentSource };
  const dates = [...new Set(live.map((r) => r.report_date))].sort();
  const studentIds = [...new Set(live.map((r) => r.student_id))];
  const [history, sameDays] = await Promise.all([
    fetchAllPagedInChunks<Row>(studentIds, (chunk, from, to) => db.from("lesson_reports").select(COLS).eq("tenant_id", tenantId).in("student_id", chunk)
      .in("classnote_status", SENT).not("classnote_queued_at", "is", null).gte("report_date", shift(dates[0], -PREV_LOOKBACK_DAYS)).lte("report_date", dates[dates.length - 1])
      .order("id").range(from, to)),
    fetchAllPaged<Row>((from, to) => db.from("lesson_reports").select(COLS).eq("tenant_id", tenantId).in("report_date", dates)
      .in("classnote_status", SENT).not("classnote_queued_at", "is", null).order("id").range(from, to)),
  ]);
  const byId = new Map<string, Row>();
  for (const r of [...history, ...sameDays, ...live]) byId.set(r.id, r);
  const students = await fetchInChunks<Student>([...new Set([...byId.values()].map((r) => r.student_id))], (chunk) =>
    db.from("students").select("id, name, school, grade, is_test").eq("tenant_id", tenantId).in("id", chunk));
  const S = new Map(students.map((s) => [s.id, s]));
  const population: SentReport[] = [];
  for (const r of byId.values()) {
    const s = S.get(r.student_id);
    if (!s || s.is_test) continue; // 옛 모집단과 같게 — 테스트 학생은 비교 재료에서도 뺀다
    population.push({
      id: r.id, d: r.report_date, subject: r.subject, makeup: r.makeup, student: s.name ?? "", school: s.school, grade: s.grade,
      textbook: r.textbook, progress: r.progress, homework_today: r.homework_today, daily_test: r.daily_test, check_test: r.check_test,
      exam_info: r.exam_info, homework_score: r.homework_score, attitude: r.attitude, notes: r.notes, trend_note: r.trend_note,
      video_homework: r.video_homework, student_id: r.student_id, created_at: r.created_at,
      unit_class: r.class_id ?? r.makeup_class_id ?? r.classnote_class_id ?? null,
    });
  }
  const assembled = assembleRatingReports(population);
  const reports = new Map<string, RatingReport>();
  for (const r of live) {
    const a = assembled.get(r.id);
    if (a) reports.set(r.id, a);
    else skip.set(r.id, { drop: true, reason: "테스트 학생이거나 학생 정보가 없습니다" });
  }
  return { reports, skip, mentSource };
}
