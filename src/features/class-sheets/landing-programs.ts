/**
 * ECS 주간 랜딩 — **프로그램(EiE / 인재원 영어) 좌우 분단** (순수 · Vitest).
 *
 * 원장 2026-08-28: *"영어 강사 시트 단체 뷰에서 EiE와 인재원 영어를 분리해서 좌 우로 2단"*.
 * 42반이 담임 묶음으로 섞여 흐르던 화면에서, 프로그램은 **행을 봐야만** 알 수 있었다(EiE 약자 반과
 * `중등E_…` 반이 한 열에 번갈아 선다). 좌우로 가르면 그 판단이 **자리**로 끝난다.
 *
 * 🔴 **판정은 `english_track` 컬럼 하나**(0176a) — 반 이름으로 추측하지 않는다. 그리고 갈래는 프로그램
 *    필터 칩과 **같은 비대칭**을 쓴다: EiE는 정확히 일치, 인재원 영어는 "EiE가 아닌 전부"(미분류 포함).
 *    양쪽을 정확히 일치로 거르면 미분류 반이 **두 단 모두에서 사라진다** — 잘못된 칸에 있는 건 눈에 띄어
 *    고쳐지지만 사라진 건 아무도 모른다([`english-track.ts`](@/features/classes/english-track)의 같은 🔴).
 * ⚠️ 그래서 이 함수는 모든 카드를 **정확히 한 단에 한 번씩** 넣는다(landing-programs.test.ts가 잠근다).
 * ⚠️ 한쪽이 비면 `null` — 나눌 게 없는데 반쪽을 비워 두면 화면 절반이 낭비다(프로그램 필터로 한쪽만
 *    보는 중, 담임이 한 프로그램만 맡은 경우가 그렇다). 그때 화면은 기존 단일 흐름으로 그린다.
 * ⚠️ 순서는 **EiE 먼저**(왼쪽) — 필터 칩·폼 선택지(`ENGLISH_TRACK_OPTIONS`)와 같은 순서라야 고른 것을
 *    같은 자리에서 찾는다.
 */
import {
  ENGLISH_TRACK_LABEL,
  keepEnglishTrack,
  type EnglishTrack,
} from "@/features/classes/english-track";

/** 분단에 필요한 최소 모양 — 서버 타입(`SheetLandingCard`)에 안 묶어 순수하게 테스트된다. */
export type LandingProgramTrackable = {
  englishTrack?: string | null;
  english_track?: string | null;
};

export type LandingProgramPanel<T> = {
  key: EnglishTrack;
  /** 화면 라벨 — raw 코드('eie') 노출 금지 규칙의 단일 출처를 그대로 쓴다. */
  label: string;
  cards: T[];
};

/** 좌(EiE)·우(인재원 영어) 두 단. 한쪽이라도 비면 `null`(= 나누지 않는다). */
export function splitLandingByProgram<T extends LandingProgramTrackable>(
  cards: readonly T[],
): [LandingProgramPanel<T>, LandingProgramPanel<T>] | null {
  const eie = keepEnglishTrack(cards, "eie");
  const injaewon = keepEnglishTrack(cards, "injaewon");
  if (eie.length === 0 || injaewon.length === 0) return null;
  return [
    { key: "eie", label: ENGLISH_TRACK_LABEL.eie, cards: eie },
    { key: "injaewon", label: ENGLISH_TRACK_LABEL.injaewon, cards: injaewon },
  ];
}
