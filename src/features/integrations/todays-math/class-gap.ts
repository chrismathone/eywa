// 오늘 수학 탭에 "지금 다니는 반이 없다"고 나올 때, 왜 없는지를 가른다(원장 2026-10-18 *"계정 생성이 안 되었는지,
// 정말로 반이 연결 안 되었는지, 오류인지"*). 학생 로그인 계정은 반 연결과 관계없다 — 여기서 다루지 않는다.
// 판정 재료는 둘: aywa의 지금 수학 반(오늘 수학 명단에 설 조건 — 반 기간 마감은 못 본다, 그래서 '오류'로 단정하지 않는다) · 오늘 수학이 아는 상태(연결 · 반 · 수강 종료 시각).
// aywa 쪽 조회가 실패했으면(null) 이유를 단정하지 않는다.

export type ClassGap =
  /** aywa엔 지금 수학 반이 있는데 오늘 수학엔 없다 — 명단은 1분마다 맞추니, 오래가면 동기화 오류 */
  | { kind: "sync_pending"; aywaClasses: string[]; withdrawnAt: string | null }
  /** aywa에서 수학 반이 끝나 오늘 수학도 수강 종료로 처리했다 — 기록은 남는다 */
  | { kind: "ended"; withdrawnAt: string | null }
  /** 오늘 수학에 연결된 적이 없고 aywa에도 지금 수학 반이 없다 */
  | { kind: "not_in_math" }
  /** aywa 쪽을 확인하지 못했다 */
  | { kind: "unknown" };

export function classGap(input: {
  linked: boolean;
  withdrawnAt: string | null | undefined;
  aywaMathClasses: string[] | null;
}): ClassGap {
  if (input.aywaMathClasses === null) return { kind: "unknown" };
  const withdrawnAt = input.withdrawnAt ?? null;
  if (input.aywaMathClasses.length > 0) return { kind: "sync_pending", aywaClasses: input.aywaMathClasses, withdrawnAt };
  return input.linked ? { kind: "ended", withdrawnAt } : { kind: "not_in_math" };
}
