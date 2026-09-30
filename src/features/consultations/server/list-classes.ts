import "server-only";
import { kstDateOf } from "@/lib/date-kst";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { candidateKey, resolveConsultationClass } from "../class-mapping";
import { loadClassCandidatesRpc } from "./class-support";
import type { StudentConsultationRow } from "./queries";

/**
 * 목록 한 쪽에서 **아직 판정 안 한 옛 행**(class_source 비어 있음)의 반을 화면에서만 판정해 채운다 — 저장은 안 한다
 * (백필 `scripts/_oneoff/backfill-consultation-classes.mjs --apply` 또는 다음 저장 때 굳는다).
 *
 * 🔴 사람이 고른 값(manual — '미매핑' 포함)과 이미 판정된 값(auto)은 건드리지 않는다(원장 *"관리자 상담 등록 시에 미매핑할 수도 있게"*).
 * 성능: 쪽 하나(≤120행)의 (학생, 날짜) 쌍을 RPC **한 번**에 싣는다(N+1·큰 `.in()` 없음, B3). 판정 안 한 행이 없으면 부르지도 않는다.
 * ⚠️ 판정 보조가 실패해도 목록은 산다 — 그 행들은 '—'로 남는다(조회 실패를 미매핑으로 저장하지는 않는다: 여긴 표시뿐).
 */
export async function annotateAutoClasses(rows: StudentConsultationRow[]): Promise<StudentConsultationRow[]> {
  const todo = rows.filter((r) => r.classSource === null && r.studentId);
  if (todo.length === 0) return rows;
  const pairs = todo
    .map((r) => ({ studentId: r.studentId, date: kstDateOf(r.consultedAt) ?? "" }))
    .filter((p) => p.date);
  let candidates: Awaited<ReturnType<typeof loadClassCandidatesRpc>>;
  let labels: Record<string, string>;
  try {
    const [cands, settings] = await Promise.all([loadClassCandidatesRpc(pairs), getTenantSettings()]);
    candidates = cands;
    labels = subjectLabelRecord(settings.operations.subjects);
  } catch (e) {
    console.error("[consultations] 반 자동 판정(표시) 실패:", e instanceof Error ? e.message : e);
    return rows;
  }
  if (!candidates) return rows;
  return rows.map((r) => {
    if (r.classSource !== null) return r;
    const date = kstDateOf(r.consultedAt);
    const list = date ? (candidates.get(candidateKey(r.studentId, date)) ?? []) : [];
    const judged = resolveConsultationClass({ counselorId: r.counselorId, subject: r.subject, labels, candidates: list });
    const picked = judged.classId ? list.find((c) => c.classId === judged.classId) : undefined;
    return { ...r, classId: judged.classId, className: picked?.className ?? null, classAuto: true };
  });
}
