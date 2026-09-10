/**
 * **신규생 체크 칸의 표시** — 상태 → 칸 안 글자 + 칸 모양. 순수·Vitest.
 *
 * 🔴 **판정은 여기서 안 한다** — 상태는 [`statusOf`](./onboarding-items)가 정하고 이 파일은 **그리기만**
 *    한다. 기한 계산을 복제하면 표와 상단 숫자가 다른 사실을 말한다(기준일이 둘이라 특히 갈리기 쉽다).
 *
 * 🔴 **통짜 채움(초록)은 `done` 하나뿐이다.** 예전엔 상태마다 칸을 통째로 칠했는데, 그러면 `due`·
 *    `overdue`·`pending`·`waived` 칸이 **글자 하나 없는 색 막대**로 서서(그 삼항이 `done`·`upcoming`만
 *    그렸다) "검게 지운 자국"처럼 보였다. 상단이 `0% 완료`인데 색칠된 칸이 6개면 한 화면이 스스로
 *    모순된다. 지금은 **초록 칸 개수 = 그 학생 진도**라 한 행을 훑으면 어디까지 왔는지가 읽힌다.
 *
 * 🔴 **지난 기간에 안 된 칸은 연붉은 틴트**(원장 2026-09-10 *"신규생 관리에서 지난 기간에 되지 않았던
 *    항목들 전부 연붉은색 계열로 셀 색칠해줘"*) — `overdue`(기한 지남)와 `waived`(기능 시작일 이전에
 *    기한이 지남) 둘이다. `waived`를 완전히 비웠더니 표의 왼쪽 절반이 흰 공백이 됐는데, **그 칸들이
 *    곧 "그때 안 한 것"**이라 화면이 아무 말도 안 하는 편이 더 나빴다.
 *    🔴 **칠하는 것은 표시일 뿐 세는 것이 아니다** — `progressOf`의 분모·`지연 N`·완료율은 그대로다
 *    (원장 *"지나간 미완료 건에 대해서는 됐고"*). 틴트를 근거로 집계를 바꾸지 말 것.
 *    🔴 둘의 **톤은 갈라 둔다**: `overdue`는 틴트 위에 **빨강 굵은 글자 + 1px 빨강 테두리**(오늘 손 쓸
 *    수 있는 것), `waived`는 **글자 없이 틴트만**(이미 지나간 것). 같아 보이면 둘이 뭉갠다.
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
 * ⚠️ 아직 기한이 안 온 칸(`due`·`upcoming`·`pending`)에 **`bg-white`를 박지 말 것** — 배경을 비워 둬야
 *    (투명) 지연이 있는 행의 옅은 붉은 틴트(`bg-danger-soft/40`)가 칸에도 이어진다. 흰색을 칠하면 그
 *    행만 이름·날짜 열에만 틴트가 남아 표가 깨져 보인다. 평소 배경이 흰 카드라 결과는 "흰 바탕"이다.
 */

/** 지난 기간에 안 된 칸의 연붉은 틴트 — `--danger-soft`는 반투명(12%)이라 행 틴트 위에 겹쳐도 뭉개지지 않는다. */
const PAST_MISS_TINT = "bg-danger-soft";
export type OnboardingCellStyle = {
  /** 칸(버튼)에 붙는 클래스 — 채움·글자색·굵기·테두리 색. */
  box: string;
  /** 마우스 오버·스크린리더가 읽는 상태 이름. */
  label: string;
};

export const STATUS_STYLE: Record<OnboardingItemStatus, OnboardingCellStyle> = {
  done: { box: "bg-green text-white border-transparent", label: "완료" },
  overdue: { box: `${PAST_MISS_TINT} border-danger text-danger font-bold`, label: "지연" },
  due: { box: "border-amber text-amber font-bold", label: "오늘·임박" },
  upcoming: { box: "border-transparent text-green font-medium", label: "예정" },
  pending: { box: "border-transparent text-text-dim font-medium", label: "기한 없음(첫 수업일 미정)" },
  // 🔴 틴트만 — 글자·테두리를 얹지 말 것(그러면 '오늘 손 쓸 수 있는 지연'과 구분이 사라진다).
  waived: { box: `${PAST_MISS_TINT} border-transparent`, label: "기능 시작 전 기한 — 세지 않습니다" },
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
 * 필요시 항목의 기준일 이전 기한 — **빈 칸, 틴트도 점선도 없다.**
 * 🔴 필수가 아니라 "안 됐다"가 성립하지 않는다(원장 2026-09-10) — 여기에 연붉은 틴트를 칠하면
 *    안 해도 되는 일을 놓친 것처럼 보인다.
 */
const OPTIONAL_WAIVED_BOX = "border-transparent";

/**
 * 이 칸에 붙일 클래스.
 * ⚠️ 필요시 항목은 **어떤 상태에서도 재촉 색(danger·amber)을 안 받는다** — 지난 기간 틴트도 마찬가지다.
 */
export function cellBoxClass(status: OnboardingItemStatus, optional: boolean): string {
  if (!optional) return STATUS_STYLE[status].box;
  if (status === "waived") return OPTIONAL_WAIVED_BOX;
  return status === "done" ? OPTIONAL_DONE_BOX : OPTIONAL_OPEN_BOX;
}

/**
 * 마우스 오버 표시 — **배경이 있는 칸은 밝기로, 빈 칸은 옅은 채움으로.**
 * ⚠️ 투명한 칸에 `brightness`를 걸면 아무 일도 안 일어나고, 틴트 칸에 불투명 회색을 덮으면 그 순간
 *    연붉은 표시가 사라진다 — 그래서 판정을 `cellBoxClass` 하나에서 파생시킨다(두 벌로 갈리지 않게).
 */
export function cellHoverClass(status: OnboardingItemStatus, optional: boolean): string {
  return cellBoxClass(status, optional).includes("bg-") ? "hover:brightness-95" : "hover:bg-muted";
}
