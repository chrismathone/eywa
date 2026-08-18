/**
 * **"지금 수업 중인가"의 단일 정의** — 순수 함수(Vitest). 화면·서버가 이 한 곳만 본다.
 *
 * 배경(원장 2026-08-18): *"스케줄 상으로는 전체 수업이 아닌 1개의 수업에 대해서만 수업인데, 마치
 * 전부 수업하는 것처럼 되어 있음."* 실측(프로덕션, 화요일 13:23 KST)이 그 말 그대로였다 —
 * 그 요일에 살아 있는 슬롯 **102개** 중 그 순간 진행 중인 것은 **1개**, 나머지 101개는 아직 시작도
 * 안 했는데 좌석표가 하루치를 한 화면에 통째로 펼치고 있었다(강의실 하나에 11:00~22:00 반이 동시에).
 *
 * 🔴 **끝난 수업을 감추는 게 답이 아니다.** 출결은 지나간 교시도 찍어야 하고, 조치가 필요한 목록에
 *    짧은 시간창을 걸면 고치기도 전에 사라진다([[#105]]). 그래서 이 파일은 **거르는 기준이 아니라
 *    나누는 기준**이다 — 지금/예정/지난 셋으로 갈라 놓으면 화면은 지금을 앞세우고 나머지는 접어 둘 뿐,
 *    목록에서 없어지지는 않는다.
 *
 * 🔑 `signals.ts`의 [`slotPhase`](./signals.ts)와 **질문이 다르다**:
 *      · `slotPhase` = "이 빈 칸을 데스크 큐에 올릴 때가 됐나"(유예 10분 경과 여부) — 조치 판정.
 *      · `nowBandOf` = "이 수업이 지금 열려 있나" — 표시 묶음 판정.
 *    둘을 합치면 유예(`grace`) 중인 반이 큐에 올라가거나, 끝난 반이 화면에서 사라진다.
 */

/**
 * 한 수업(또는 교시)이 지금 시각에 대해 놓인 자리. 화면이 이 순서로 묶는다.
 *
 * 🔴 `later`(한참 뒤 시작)를 따로 둔 이유(원장 2026-08-18): *"지금 수업 및 다음 수업 정도만 보여주면
 *    좋겠다. 2시간 이내에 시작하는 수업 모두 보여줘."* + *"그냥 예정 수업은 없애자."*
 *    좌석표는 **지금 손댈 수 있는 것**만 펼치는 자리다 — 5시간 뒤 수업은 출결을 찍을 수도 없는데
 *    자리만 차지하고, 그 탓에 정작 지금 반이 스크롤 아래로 밀렸다.
 *    ⚠️ 그래도 **개수는 머리줄에 적는다** — 화면에서 통째로 지우면 "오늘 수업이 이게 다인가"로 읽힌다.
 */
export type NowBand = "now" | "upcoming" | "later" | "past";

/**
 * 시작 이만큼 **전**부터 '지금'으로 올린다 — 아이들은 미리 오고, 강사도 시작 전에 찍는다
 * (데스크 게이트가 강사에게 유예를 적용하지 않는 것과 같은 폭).
 */
export const NOW_LEAD_MIN = 10;
/**
 * 종료 이만큼 **뒤**까지 '지금'에 남긴다 — 하원 직후가 출결을 마지막으로 손보는 시각이다.
 * 그 뒤엔 '지난'으로 내려갈 뿐 **사라지지 않는다**([[#105]]).
 */
export const NOW_TAIL_MIN = 10;
/**
 * '예정'으로 **펼쳐 보여줄** 앞창(분) — 원장 2026-08-18: *"2시간 이내에 시작하는 수업 모두."*
 * 이보다 뒤에 시작하는 수업은 `later`로 빠져 화면에서 접힌다(개수만 머리줄에 남는다).
 */
export const SOON_WINDOW_MIN = 120;

/** 화면 라벨 — raw 코드(now/past)를 UI에 내보내지 않는다(전역 규칙). */
export const NOW_BAND_LABEL: Record<NowBand, string> = {
  now: "지금 수업 중",
  upcoming: "곧 시작",
  later: "이후 수업",
  past: "지난 수업",
};

/** 묶음 배열 순서 — 지금이 맨 앞. 정렬·렌더 순서를 두 곳에서 따로 적지 않는다. */
export const NOW_BAND_ORDER: readonly NowBand[] = ["now", "upcoming", "later", "past"];

/**
 * 한 교시의 묶음. 분 단위(KST 자정 기준)로만 계산한다 — 날짜 판정은 호출부 몫이다.
 *
 * ⚠️ `endMin`이 없으면 **끝난 척하지 않는다**(`slotPhase`와 같은 규약) — 시작했으면 계속 '지금'이다.
 *    실측상 살아 있는 슬롯 586개 중 종료시각이 빈 행은 **0개**라 지금은 이론상의 분기다.
 */
export function nowBandOf(
  nowMin: number,
  startMin: number,
  endMin: number | null,
  leadMin: number = NOW_LEAD_MIN,
  tailMin: number = NOW_TAIL_MIN,
  soonMin: number = SOON_WINDOW_MIN,
): NowBand {
  if (nowMin < startMin - leadMin) {
    // 아직 시작 전 — 앞창 안이면 '곧 시작', 그보다 멀면 '이후'(화면에서 접힌다).
    return startMin - nowMin > soonMin ? "later" : "upcoming";
  }
  if (endMin != null && nowMin >= endMin + tailMin) return "past";
  return "now";
}

/**
 * 여러 교시를 한 카드로 접을 때의 묶음 — **하나라도 열려 있으면 '지금'**.
 *
 * 좌석표 카드는 반×오늘 하나라(원장 2026-08-14) 연강 2~3교시가 한 장에 접힌다. 첫 교시만 보고
 * 판정하면 14:20 교시가 끝난 뒤 랩실로 옮겨 수업 중인 반이 '지난'으로 내려간다.
 * 남은 교시가 있으면 '예정', 전부 끝났으면 '지난'. 빈 배열은 '지난'(보여줄 수업이 없다).
 */
export function foldNowBands(bands: readonly NowBand[]): NowBand {
  if (bands.includes("now")) return "now";
  if (bands.includes("upcoming")) return "upcoming";
  // 🔴 '이후'가 '지난'을 이긴다 — 오전에 끝난 교시와 저녁 교시를 함께 가진 반을 '지난'으로 내리면
  //    저녁이 되어도 접힌 채로 남는다(연강 반이 통째로 사라지는 길).
  if (bands.includes("later")) return "later";
  return "past";
}

/**
 * 묶음별로 가른다 — **지금 → 예정 → 지난** 순, 빈 묶음은 빼고. 원소 순서는 보존한다(호출부가 이미 정렬).
 *
 * 🔴 거르지 않는다. 셋을 다 돌려주므로 화면은 지난 수업을 접어 둘 뿐 잃지 않는다 —
 *    출결은 지나간 교시도 찍어야 한다([[#105]]).
 */
export function splitByNowBand<T extends { band: NowBand }>(
  items: readonly T[],
): { band: NowBand; items: T[] }[] {
  return NOW_BAND_ORDER.map((band) => ({ band, items: items.filter((i) => i.band === band) })).filter(
    (g) => g.items.length > 0,
  );
}
