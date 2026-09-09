/**
 * 반 이동의 **적용일** 규약 — 순수 함수 단일 소스.
 *
 * 원장 2026-09-09: *"드래그를 놓을때 기본뷰건 통합뷰건 날짜를 지정할 수 있게. (드랍을 하면 날짜지정 팝업)"*
 * → *"그렇게되면 기존 수업에서는 '연보라색 계열'로 '이동 대기' 상태가 되고, 미래에 이동할 반에서는
 *    '대기'생 상태가 되는것."*
 *
 * 날짜의 출처가 셋(건별 팝업 · 툴바 '적용일' · 큐 앵커)이라 **어느 것이 이기는지**를 한 곳에 못박는다.
 * 화면(건별 날짜 표시)과 저장(RPC 인자)이 같은 함수를 읽어야 "보이는 날짜와 저장되는 날짜"가 안 갈린다.
 */

/**
 * 이 한 건이 실제로 적용될 날짜.
 *
 * 우선순위 = **건별(팝업) > 툴바 적용일 > 큐 앵커**. `null`은 "즉시"(서버 `current_date`)라는 뜻이고,
 * 저장은 그때 RPC에 날짜를 **넘기지 않는다**.
 *
 * 🔴 즉시 의도를 절대 날짜로 얼리지 않는다 — 자정을 넘겨 저장하면 그 날짜가 과거가 돼 서버 소급 가드
 *    (`eff < kstToday()`)에 거부된다. 그래서 팝업이 기본값과 같은 날짜를 돌려줄 땐 `moveOn`을 안 채운다.
 */
export function resolveApplyDate(
  /** 드롭 팝업에서 고른 날짜(기본값과 같으면 null로 들어온다). */
  moveOn: string | null | undefined,
  /** 툴바 '적용일'에서 사람이 바꾼 값(안 바꿨으면 null). */
  toolbarDate: string | null | undefined,
  /** 큐가 만들어진 주의 앵커(이번 주=null, 미래 주=그 주 월요일). */
  queueAnchor: string | null | undefined,
): string | null {
  return moveOn ?? toolbarDate ?? queueAnchor ?? null;
}

/**
 * 오늘보다 **뒤**면 예약 이동 — 출발 반은 '이동 대기'(연보라), 도착 반은 '대기'로 보인다.
 * ⚠️ 오늘은 예약이 아니다(즉시). `null`(즉시)도 예약이 아니다.
 */
export function isScheduledMove(applyOn: string | null | undefined, today: string): boolean {
  return !!applyOn && !!today && applyOn > today;
}

/**
 * 팝업이 고른 날짜를 큐에 실을 값으로 — 기본값과 같으면 `null`(얼리지 않는다).
 * @param picked 팝업 입력값(`YYYY-MM-DD`)
 * @param fallback 팝업을 열 때 보여 준 기본값(= 툴바 적용일 ?? 이 주의 바닥 날짜)
 */
export function freezeMoveDate(picked: string, fallback: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(picked)) return null;
  return picked === fallback ? null : picked;
}

/** `2026-09-15` → `9/15`(좁은 줄·배지용). 형식이 아니면 원문 그대로. */
export function shortMoveDate(date: string | null | undefined): string {
  if (!date) return "";
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(date);
  return m ? `${Number(m[1])}/${Number(m[2])}` : date;
}
