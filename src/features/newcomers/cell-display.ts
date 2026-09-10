/**
 * **신규생 체크 칸의 표시** — 상태 → 칸 안 글자 + 칸 모양. 순수·Vitest.
 *
 * 🔴 **판정은 여기서 안 한다** — 상태는 [`statusOf`](./onboarding-items)가 정하고 이 파일은 **그리기만**
 *    한다. 기한 계산을 복제하면 표와 상단 숫자가 다른 사실을 말한다(기준일이 둘이라 특히 갈리기 쉽다).
 *
 * 🔴 **채움(색칠)은 `done` 하나뿐이다.** 예전엔 상태마다 칸을 통째로 칠했는데, 그러면 `due`·`overdue`·
 *    `pending`·`waived` 칸이 **글자 하나 없는 색 막대**로 서서(그 삼항이 `done`·`upcoming`만 그렸다)
 *    "검게 지운 자국"처럼 보였다. 상단이 `0% 완료`인데 색칠된 칸이 6개면 한 화면이 스스로 모순된다.
 *    지금은 **초록 칸 개수 = 그 학생 진도**라 한 행을 훑으면 어디까지 왔는지가 읽힌다.
 *
 * 🔴 **왼쪽→오른쪽 진행("프로그레스바")이 아니다.** 기준일이 둘이라 기한이 열 순서대로 오지 않는다 —
 *    등록일과 첫 수업일 간격이 20일이면 3열 OJT(등록+7)가 1열 사전 콜(첫수업−1)보다 12일 **먼저** 온다.
 *    그래서 열 순서를 진행 순서로 읽히게 만들지 말 것(열 폭 균등은 비교를 위해 유지).
 */

import type { OnboardingItemStatus } from "./onboarding-items";

/** 칸 안에 무엇을 그리나. `blank`는 "그릴 것이 없다"는 **결정**이지 누락이 아니다. */
export type OnboardingCellMark =
  | { kind: "check" }
  | { kind: "text"; text: string }
  | { kind: "blank" };

/** 기한을 모를 때 적는 말 — raw 코드·빈 칸 대신 한글로. */
const UNKNOWN_TEXT = "미정";

/**
 * 칸 안 글자.
 *
 * 🔴 **`D-0`을 쓰지 않는다** — 남은 날 0은 `오늘`이다(사람이 읽는 말).
 * 🔴 **지연은 `+9`가 아니라 `D+9`** — 첫 수업 열이 이미 `+9`(경과일)를 쓰고 있어, 같은 글자면 뜻이 갈린다.
 * 🔴 **`waived`는 완전히 비운다** — 134칸에 `—`를 반복하면 그 기호가 화면의 본문이 된다.
 *    (이유는 칸에서 사라지지 않는다 — `title`·`aria-label`이 그대로 말한다.)
 */
export function cellMarkOf(status: OnboardingItemStatus, daysLeft: number | null): OnboardingCellMark {
  if (status === "done") return { kind: "check" };
  if (status === "waived") return { kind: "blank" };
  if (status === "pending") return { kind: "text", text: UNKNOWN_TEXT };
  // 아래 셋은 기한이 있어야 나오는 상태라 daysLeft가 null일 수 없다.
  // 그래도 null이면 **없는 날짜를 지어내지 않고** 모른다고 적는다.
  if (daysLeft === null) return { kind: "text", text: UNKNOWN_TEXT };
  if (status === "overdue") return { kind: "text", text: `D+${Math.abs(daysLeft)}` };
  return { kind: "text", text: daysLeft <= 0 ? "오늘" : `D-${daysLeft}` };
}

/**
 * 상태 → 칸 모양·이름. 🔴 **화면 파일에 상태→색 맵을 새로 만들지 말고 이 표 하나만 고칠 것**
 * (앱 전역 규약: 화면 안에서 `STATUS_META`를 복사하면 새 상태가 조용히 "—"로 삼켜진다).
 *
 * 색은 의미색 캐논 그대로 — 완료=green(positive) · 지연=danger(critical) · 오늘·임박=amber(caution) ·
 * 예정=green(아직 여유) · 기한 없음=무채색(inert). ⚠️ 2026-09-08부터 글자색은 한 값(`#121212`)이라
 * 무채색 칸은 **색이 아니라 굵기**로 물러선다(`font-medium` vs 재촉의 `font-bold`).
 *
 * ⚠️ 완료가 아닌 칸에 **`bg-white`를 박지 말 것** — 배경을 비워 둬야(투명) 지연이 있는 행의 옅은
 *    붉은 틴트(`bg-danger-soft/40`)가 칸에도 이어진다. 흰색을 칠하면 그 행만 이름·날짜 열에만 틴트가
 *    남아 표가 깨져 보인다. 평소 배경이 흰 카드라 결과는 그대로 "흰 바탕"이다.
 */
export type OnboardingCellStyle = {
  /** 칸(버튼)에 붙는 클래스 — 채움·글자색·굵기·테두리 색. */
  box: string;
  /** 마우스 오버·스크린리더가 읽는 상태 이름. */
  label: string;
};

export const STATUS_STYLE: Record<OnboardingItemStatus, OnboardingCellStyle> = {
  done: { box: "bg-green text-white border-transparent", label: "완료" },
  overdue: { box: "border-danger text-danger font-bold", label: "지연" },
  due: { box: "border-amber text-amber font-bold", label: "오늘·임박" },
  upcoming: { box: "border-transparent text-green font-medium", label: "예정" },
  pending: { box: "border-transparent text-text-dim font-medium", label: "기한 없음(첫 수업일 미정)" },
  waived: { box: "border-transparent", label: "기능 시작 전 기한 — 세지 않습니다" },
};

/**
 * '필요시' 항목(2개월 콜)의 칸 — **채움 없이 점선 테두리**.
 *
 * 🔴 **재촉 색(danger·amber)을 쓰지 않는다.** 이 항목은 지연·완료율 분모에서 빠지는데(`progressOf`),
 *    칸만 앰버로 칠하면 상단 "오늘·임박 4"와 표에 보이는 앰버 칸 수가 **안 맞는다**(실제로 6개 중 2개가
 *    이 열이었다). 색 = 세는 것, 점선 = 세지 않는 것.
 * ⚠️ 완료는 초록 채움을 유지하되 **점선은 남긴다** — 필수 완료와 구분돼야 "이건 필요시였다"가 보인다.
 */
const OPTIONAL_DONE_BOX = "bg-green text-white border-dashed border-white/70";
const OPTIONAL_OPEN_BOX = "border-dashed border-line-strong text-text-dim font-medium";

/**
 * 이 칸에 붙일 클래스.
 * ⚠️ `waived`는 **필요시 여부보다 먼저** 빈 칸으로 떨어진다 — 기능 시작 전 기한은 셀 것 자체가 없어서
 *    점선으로도 표시하지 않는다(빈 칸이 곧 "여긴 볼 것 없음"이다).
 */
export function cellBoxClass(status: OnboardingItemStatus, optional: boolean): string {
  if (!optional || status === "waived") return STATUS_STYLE[status].box;
  return status === "done" ? OPTIONAL_DONE_BOX : OPTIONAL_OPEN_BOX;
}
