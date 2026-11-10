// 평점 줄 세우기 판정(순수 — 서버 대기열과 단위 테스트가 같이 쓴다).
//
// 🔑 '고쳐졌나'는 시계 두 개(앱 서버 · DB)를 견주지 않고 **같은 DB 값끼리** 비교한다: 상담의 `updated_at` ↔ 평점·대기열에 적어 둔 `source_updated_at`
//    (= 재료를 읽던 때 그 상담의 `updated_at`). 재료를 읽은 뒤·저장하기 전에 일어난 수정(녹음 전사 도착 포함)도 그래서 놓치지 않는다.
// 🔴 닫힌(failed) 줄은 **평점이 있어도** 그 상담이 다시 고쳐지기 전엔 다시 세우지 않는다 — 안 그러면 거절·해석 불가·금지 정보로 닫힌 상담이
//    30분마다 3번씩 모델을 부르는 일이 영구히 반복된다(적대적 리뷰 2026-11-11). 판이 올랐으면(rubric이 다르면) 닫힌 줄도 한 번 다시 시도한다.
export type DueConsultation = { id: string; student_id: string; updated_at: string };
/** 지금 기준(판)으로 매긴 평점만 넘긴다. */
export type DueRating = { consultation_id: string; source_updated_at: string | null };
export type DueQueue = { consultation_id: string; stage: string; rubric: string | null; source_updated_at: string | null };

export const IN_FLIGHT_STAGES: ReadonlySet<string> = new Set(["queued", "submitting", "submitted"]);

export function pickDue(
  consultations: readonly DueConsultation[],
  ratings: readonly DueRating[],
  queue: readonly DueQueue[],
  testStudents: ReadonlySet<string>,
  rubric: string,
): string[] {
  const rated = new Map(ratings.map((r) => [r.consultation_id, r]));
  const lines = new Map(queue.map((q) => [q.consultation_id, q]));
  const due: string[] = [];
  for (const c of consultations) {
    if (testStudents.has(c.student_id)) continue;
    const q = lines.get(c.id);
    if (q && IN_FLIGHT_STAGES.has(q.stage)) continue;
    const edited = Date.parse(c.updated_at);
    const newerThan = (at: string | null) => at === null || !(Date.parse(at) >= edited); // 기록이 없으면 확인 못 했으니 후보
    if (q?.stage === "failed" && (q.rubric ?? rubric) === rubric) { if (newerThan(q.source_updated_at)) due.push(c.id); continue; }
    const r = rated.get(c.id);
    if (r) { if (newerThan(r.source_updated_at)) due.push(c.id); continue; }
    due.push(c.id); // 평점이 없다 — 줄이 없거나, 끝났는데(done) 지금 판 평점이 없다(판이 올랐다), 다른 판으로 닫혔다
  }
  return due;
}
