/**
 * 강사별 업무 현황 '원생상담' 줄의 기간 — 서버(어느 달 저장값을 쓸지)와 화면(카드 아래 안내 · 패널 설명)이 같은 규칙을 쓴다.
 * 🔑 import 없는 순수 모듈이다 — 클라이언트 카드가 불러도 서버 전용 모듈이 딸려 오지 않는다.
 */

/**
 * 쓸 달 — 이번 달 저장 줄이 하나라도 있으면 이번 달, 없으면 그 앞의 가장 늦은 달.
 * 직원 포트폴리오 집계는 **어제까지**를 세므로 매달 1일(과 2일 새벽 집계 전)엔 이번 달 줄이 아직 없다 —
 * 그날 칸이 통째로 '—'가 되지 않게 지난달(1일 새벽에 마감된 값)을 그 달 이름으로 밝혀 보인다.
 * 강사마다 달을 섞지 않는다(한 표 = 한 달 · 이번 달 줄이 없는 강사는 '—').
 */
export function pickCounselMonth<T extends { month: string }>(rows: readonly T[], thisMonth: string): { month: string | null; rows: T[] } {
  const current = rows.filter((r) => r.month === thisMonth);
  if (current.length) return { month: thisMonth, rows: current };
  const earlier = rows.map((r) => r.month).filter((m) => m < thisMonth).sort().at(-1);
  return earlier ? { month: earlier, rows: rows.filter((r) => r.month === earlier) } : { month: null, rows: [] };
}

/** 기간 이름 — 이번 달이면 '이번 달', 아니면 그 달('9월'). `today`는 화면 기준일(YYYY-MM-DD). */
export function counselPeriodLabel(counselMonth: string | null | undefined, today: string): string {
  return counselMonth && counselMonth !== today.slice(0, 7) ? `${Number(counselMonth.slice(5, 7))}월` : "이번 달";
}
