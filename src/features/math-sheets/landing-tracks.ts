/**
 * MCS 랜딩 — **정규 / 특강 좌우 분단** + 담임 묶기 (순수 · Vitest).
 *
 * 원장 2026-09-01: *"정규 / 특강 좌우 2단으로 분리시켜 정렬"* + *"특강 없으면 정규만."*
 * 그전까진 둘이 담임 묶음 안에 섞여 흘렀다 — 실측 9월 이수진 담임 11반 중 4반이 특강이라, 어느 것이
 * 방학 단기강좌인지 **반 이름을 읽어야만** 알 수 있었다. 좌우로 가르면 그 판단이 **자리**로 끝난다.
 *
 * 🔴 **판정을 새로 짓지 않는다** — 시간표가 쓰는 [`isSpecialLecture`](@/features/classes/special-lecture)
 *    단일 소스를 그대로 통과한 값(`MathClassCard.isSpecial`)만 읽는다. 여기서 이름 규칙을 다시 적으면
 *    같은 반을 시간표는 특강, MCS는 정규라고 부르는 날이 온다.
 * ⚠️ 갈래는 **대칭**이다(영어의 EiE 분단과 다르다) — 특강은 참/거짓 하나뿐이라 "미분류"가 없어서,
 *    양쪽을 정확히 일치로 걸러도 사라지는 카드가 없다. 그래도 모든 카드가 **정확히 한 단에 한 번씩**
 *    들어가는지는 테스트가 잠근다(분단의 최소 조건).
 * ⚠️ 한쪽이 비면 `null` = **나누지 않는다.** 원장 *"특강 없으면 정규만"* — 반쪽을 비워 두면 화면 절반이
 *    낭비다. 특강만 맡은 강사에게 빈 '정규' 단을 보이지 않는 것도 같은 이유라 **양방향**으로 판정한다.
 * ⚠️ 순서는 **정규 먼저**(왼쪽) — 지시 문구의 순서이고, 실측상 대부분이 정규다(활성 수학 반 72개 중
 *    특강 7개). 뒤집으면 늘 작은 단이 먼저 온다.
 */

export type MathTrack = "regular" | "special";

/** 화면 라벨 — raw 코드 노출 금지 규칙. '특강'은 시간표·급여와 같은 낱말이다. */
export const MATH_TRACK_LABEL: Record<MathTrack, string> = {
  regular: "정규",
  special: "특강",
};

/** 분단·묶기에 필요한 최소 모양 — 서버 타입(`MathClassCard`)에 안 묶어 순수하게 테스트된다. */
export type MathTrackable = { isSpecial: boolean };
export type MathTeacherNamed = { teacherName: string | null };

export type MathTrackPanel<T> = {
  key: MathTrack;
  label: string;
  cards: T[];
};

/** 좌(정규)·우(특강) 두 단. 한쪽이라도 비면 `null`(= 나누지 않는다). */
export function splitLandingByTrack<T extends MathTrackable>(
  cards: readonly T[],
): [MathTrackPanel<T>, MathTrackPanel<T>] | null {
  const regular = cards.filter((c) => !c.isSpecial);
  const special = cards.filter((c) => c.isSpecial);
  if (regular.length === 0 || special.length === 0) return null;
  return [
    { key: "regular", label: MATH_TRACK_LABEL.regular, cards: regular },
    { key: "special", label: MATH_TRACK_LABEL.special, cards: special },
  ];
}

/** 담임이 없는 반의 묶음 이름 — 추측해서 사람 이름을 지어내지 않는다. */
export const NO_HOMEROOM_LABEL = "담임 미지정";

/**
 * 담임으로 묶어 **한글 이름순**으로 세운다 — 단일 목록이든 한 단 안이든 **같은 기계**로 묶는다.
 *
 * ⚠️ 한 담임이 정규·특강을 다 맡으면 **양쪽 단에 묶음이 하나씩** 생긴다(ECS 프로그램 분단과 같다).
 *    각 묶음의 작성률은 그 단 몫만 센다 — 합치면 옆 단 숫자가 섞여 "누가 안 썼나"를 못 읽는다.
 */
export function groupMathCardsByTeacher<T extends MathTeacherNamed>(
  cards: readonly T[],
): { teacherName: string; cards: T[] }[] {
  const map = new Map<string, T[]>();
  for (const card of cards) {
    const key = card.teacherName ?? NO_HOMEROOM_LABEL;
    const list = map.get(key) ?? [];
    list.push(card);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([teacherName, list]) => ({ teacherName, cards: list }))
    .sort((a, b) => a.teacherName.localeCompare(b.teacherName, "ko"));
}
