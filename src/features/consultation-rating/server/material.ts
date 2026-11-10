import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { visibleConsultationSummary } from "@/features/consultations/internal-link";
import { consultationCard } from "../harness/card";
import { copyStudentCounts, isRecordingPlaceholder } from "../harness/copies";
import { piiHits } from "@/features/report-rating/harness/pii";
import type { ConsultationRatingInput } from "../harness/types";

/**
 * 평점 재료 읽기 — 상담 id들 → 모델이 볼 칸. admin(RLS 우회)이라 **tenant_id 필터 필수**.
 * 🔴 지금 매길 수 없는 건은 **닫는다**(대기열 failed + 한글 사유): 테스트 학생·없는 상담·외부 AI 전송 금지 정보(주민번호·계좌·카드·급여)가 든 글(가려 보내지 않는다)·
 *    녹음 분석이 아직 끝나지 않은 자리표시 글. 닫힌 건은 상담이 **고쳐지면**(녹음 분석이 끝나 summary·전사가 채워지는 때 포함) 다시 줄을 선다(queue.enqueueConsultations).
 */
export type RatingSkip = { reason: string };
/** `updatedAt` = 재료를 읽던 때 그 상담의 updated_at — 평점·대기열의 source_updated_at(고쳐졌나를 같은 DB 값끼리 견주는 기준)이 된다. */
export type RatingMaterial = { inputs: Map<string, ConsultationRatingInput>; skip: Map<string, RatingSkip>; updatedAt: Map<string, string> };

type Row = {
  id: string; student_id: string; summary: string; subject: string | null; audience: string | null; follow_up_action: string | null;
  processing_status: string | null; transcription: string | null; updated_at: string;
};
const COLS = "id, student_id, summary, subject, audience, follow_up_action, processing_status, transcription, updated_at";

const audienceOf = (v: string | null): ConsultationRatingInput["audience"] => (v === "parent" || v === "student" || v === "both" ? v : null);

/**
 * 같은 글 수(상담 id → 서로 다른 학생 수) — 지점 전체 상담이 필요하다(1,000행 침묵 절단 방지 — fetchAllPaged · 이 지점의 id·학생·글만).
 * 🔴 **테스트 학생의 상담은 세지 않는다**(직원이 '학원이'에게 시험 삼아 같은 글을 넣었다고 실제 학생 상담이 '복사'가 되어 3점으로 눌리지 않게 —
 *    일괄 평점 추출도 같은 모집단이다). 한 바퀴에 한 번만 계산해 넘겨 쓴다(cycle · batch).
 */
export async function loadCopyCounts(tenantId: string): Promise<Map<string, number>> {
  const db = createAdminClient();
  const [all, tests] = await Promise.all([
    fetchAllPaged<{ id: string; student_id: string; summary: string }>((from, to) =>
      db.from("student_consultations").select("id, student_id, summary").eq("tenant_id", tenantId).order("id").range(from, to)),
    fetchAllPaged<{ id: string }>((from, to) => db.from("students").select("id").eq("tenant_id", tenantId).eq("is_test", true).order("id").range(from, to)),
  ]);
  const testSet = new Set(tests.map((s) => s.id));
  return copyStudentCounts(all.filter((r) => !testSet.has(r.student_id)));
}

export async function loadRatingMaterial(tenantId: string, ids: readonly string[], copies?: Map<string, number>): Promise<RatingMaterial> {
  const db = createAdminClient();
  const out: RatingMaterial = { inputs: new Map(), skip: new Map(), updatedAt: new Map() };
  if (!ids.length) return out;
  const [rows, copyCounts] = await Promise.all([
    fetchInChunks<Row>([...ids], (chunk) => db.from("student_consultations").select(COLS).eq("tenant_id", tenantId).in("id", chunk)),
    copies ?? loadCopyCounts(tenantId),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const students = await fetchInChunks<{ id: string; grade: string | null; is_test: boolean | null }>([...new Set(rows.map((r) => r.student_id))], (chunk) =>
    db.from("students").select("id, grade, is_test").eq("tenant_id", tenantId).in("id", chunk));
  const stu = new Map(students.map((s) => [s.id, s]));
  for (const id of ids) {
    const r = byId.get(id);
    const s = r ? stu.get(r.student_id) : undefined;
    if (!r || !s || s.is_test) { out.skip.set(id, { reason: "평점 대상이 아닙니다" }); continue; }
    out.updatedAt.set(id, r.updated_at);
    const visible = visibleConsultationSummary(r.summary);
    // 녹음 상담 — 직접 쓴 기록 없이 자리표시만 있다. 전사가 **정상 끝난(completed)** 것만 쓴다: 너무 짧거나 인식이 모자라 failed로 끝난 녹음도 전사 부스러기를 남기는데
    // 그걸 채점하면 처리 실패가 '낮은 점수'로 저장된다(Codex 리뷰 2026-11-11 — 실패를 점수로 바꾸지 않는다).
    const recording = isRecordingPlaceholder(visible);
    const transcript = recording && r.processing_status === "completed" ? (r.transcription ?? "").trim() || null : null;
    if (recording && !transcript) { out.skip.set(id, { reason: "녹음 분석이 끝나지 않았거나 실패했습니다" }); continue; }
    const input: ConsultationRatingInput = {
      id, summary: visible, subject: r.subject, audience: audienceOf(r.audience), grade: s.grade, followUpAction: r.follow_up_action,
      copyStudents: copyCounts.get(id) ?? 1, transcript,
    };
    // 🔴 보내는 카드 **전체**를 검사한다(본문만 보면 후속 조치 칸에 적힌 환불 계좌가 새나간다 — 적대적 리뷰 2026-11-11).
    const pii = piiHits(consultationCard(input));
    if (pii.length) { out.skip.set(id, { reason: `외부 AI로 보낼 수 없는 정보(${pii.join("·")})가 있어 매기지 않습니다` }); continue; }
    out.inputs.set(id, input);
  }
  return out;
}
