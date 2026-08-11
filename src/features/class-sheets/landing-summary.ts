/**
 * ECS 주간 랜딩 요약 — 반 카드 목록 한 줄 집계(순수 함수).
 *
 * 랜딩이 카드 벽에서 **한 장의 시트**로 바뀌면서(2026-08-11 원장 "이름에 걸맞게 컴팩트하게"), 카드마다
 * 반복되던 "N/M 교시 작성"을 머리 한 줄로 올렸다. 화면에서 세지 않고 여기서 세는 이유는 두 가지다.
 *  · 0으로 나누는 자리가 셋(전체 %, 반별 %, '미작성' 판정)이라 화면에 흩으면 하나는 반드시 새 함정이 된다.
 *  · **이 주에 배정 교시가 0인 반**(휴강·시간표 미배정)은 "안 쓴 반"이 아니다 — 같이 세면 사무실이
 *    고칠 수 없는 일을 재촉받는다(#105의 축소판). `idle`로 따로 세어 화면도 `—`로 갈라 표시한다.
 */

/** 집계에 필요한 최소 모양 — 서버 타입(`SheetLandingCard`)에 묶지 않아 순수하게 테스트된다. */
export type LandingSlotCount = { totalSlots: number; filledSlots: number };

export type LandingSummary = {
  /** 지금 보이는 반 수(프로그램 필터 적용 후). */
  classes: number;
  /** 이 주 배정 교시 합 = 작성률 분모. */
  scheduled: number;
  /** 의미 있는 계획이 들어간 교시 합. */
  filled: number;
  /** 0~100 정수. 분모가 0이면 0. */
  pct: number;
  /** 배정은 있는데 **한 칸도** 안 쓴 반. */
  untouched: number;
  /** 배정된 교시를 **전부** 쓴 반. */
  done: number;
  /** 이 주 배정 교시가 0인 반 — 작성률 계산에서 빠진다(안 쓴 게 아니라 수업이 없는 것). */
  idle: number;
};

export function summarizeLanding(cards: readonly LandingSlotCount[]): LandingSummary {
  let scheduled = 0;
  let filled = 0;
  let untouched = 0;
  let done = 0;
  let idle = 0;
  for (const c of cards) {
    const total = Math.max(0, c.totalSlots);
    // 분자가 분모를 넘으면 %가 100을 넘어 "101% 작성"이 뜬다 — 상류가 어긋나도 화면은 말이 되게 막는다.
    const f = Math.min(Math.max(0, c.filledSlots), total);
    scheduled += total;
    filled += f;
    if (total === 0) idle += 1;
    else if (f === 0) untouched += 1;
    else if (f === total) done += 1;
  }
  return {
    classes: cards.length,
    scheduled,
    filled,
    pct: scheduled > 0 ? Math.round((filled / scheduled) * 100) : 0,
    untouched,
    done,
    idle,
  };
}

/** 반 한 줄의 진행 막대 비율(0~100). 배정 0이면 0 — 막대 자리는 정렬을 위해 남긴다. */
export function landingCardPct(card: LandingSlotCount): number {
  if (card.totalSlots <= 0) return 0;
  const f = Math.min(Math.max(0, card.filledSlots), card.totalSlots);
  return Math.round((f / card.totalSlots) * 100);
}
