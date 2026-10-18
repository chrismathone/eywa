// 오늘 수학 탭에 "지금 다니는 반이 없다"고 나올 때의 까닭(원장 2026-10-18 *"계정 생성이 안 되었는지, 정말로 반이 연결 안
// 되었는지, 오류인지"*). 탭은 에이와에서 지금 수학 반을 다니는 학생에게만 서므로(*"지난 수강건은 필요가 없음"*), 여기 오는
// 경우는 둘: 에이와엔 지금 수학 반이 있는데 오늘 수학엔 아직 없다(반영 대기 · 오래가면 확인) · 에이와 쪽 조회 실패(단정하지 않는다).
// 학생 로그인 계정은 반 연결과 관계없다 — 여기서 다루지 않는다.

export type ClassGap =
  | { kind: "sync_pending"; aywaClasses: string[] }
  | { kind: "unknown" };

export function classGap(aywaMathClasses: string[] | null): ClassGap {
  return aywaMathClasses?.length ? { kind: "sync_pending", aywaClasses: aywaMathClasses } : { kind: "unknown" };
}
