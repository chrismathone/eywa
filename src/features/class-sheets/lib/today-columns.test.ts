import { describe, expect, it } from "vitest";
import {
  SHEET_CARD_CHROME,
  SHEET_DAY_MAX_W,
  TODAY_BASE_COLS,
  TODAY_GUTTER,
  TODAY_NAME_W,
  TODAY_PLAN_W,
  TODAY_SLOT_W,
  todayContentWidth,
  todayNoteWidth,
  todaySlotCols,
  todaySlotOffset,
  weeklyNamePx,
  weeklyNameWidth,
  weeklyNoteWidth,
} from "./today-columns";
import { ROSTER_TEXT_COLS, type RosterForm } from "./roster-form";

const FORMS: RosterForm[] = ["default", "selfStudy"];

describe("오늘 면 가로 치수 — 위 카드 레일과 아래 표가 같은 격자", () => {
  it("교시 폭 = 카드 + 숨", () => {
    expect(TODAY_SLOT_W).toBe(TODAY_PLAN_W + TODAY_GUTTER);
  });

  it.each(FORMS)(
    "🔴 [%s] 표의 한 교시 열들을 더하면 카드 한 칸과 같다(이게 어긋나면 줄이 안 맞는다)",
    (form) => {
      expect(todaySlotCols(form).reduce((a, b) => a + b, 0)).toBe(TODAY_SLOT_W);
    },
  );

  it.each(FORMS)("[%s] 열 구성 = 출결·유닛·태도 + 자유 입력 + 특이사항", (form) => {
    const cols = todaySlotCols(form);
    expect(cols).toHaveLength(TODAY_BASE_COLS.length + ROSTER_TEXT_COLS[form].length + 1);
    expect(cols.slice(0, 3)).toEqual([...TODAY_BASE_COLS]);
    expect(cols[cols.length - 1]).toBe(todayNoteWidth(form));
  });

  // 임계 200→120(2026-08-17 열 다이어트 — 원장 "특이사항 열너비를 줄이면서 같이 전체적 열너비를 줄이면
  // 될듯"). JJ 폼이 436px 교시에서 142라 200은 성립 불가 — 120은 "한 어절은 보이는" 하한이었다.
  //
  // 120→100(2026-08-28, 원장 *"특이사항 열너비 조금만 줄여줘 현재의 80% 정도"* → TODAY_PLAN_W 432→406,
  // JJ 폼 오늘 면 138→112). 🔑 **하한의 근거가 바뀌었다**: 특이사항 칸은 이제
  // [NoteCell](../components/note-cell.tsx)이라 **포커스하면 스티커 메모로 펼쳐지고**(248×88) 접힌
  // 상태의 전문은 마우스 오버로 읽힌다 — 즉 이 폭은 쓰는 자리가 아니라 **미리보기 폭**이다.
  // 그래서 "한 어절"이 아니라 "머리 '특이사항'(11px bold ≈44px)이 한 줄로 서고 값 몇 글자가 보인다"가
  // 새 근거다(13px 기준 100px ≈ 7자).
  // 🔴 **이 숫자를 더 내려서 통과시키지 말 것** — 이 가드의 본래 목적(고정 열을 늘리다 특이사항이
  //    슬리버로 무너지는 것을 잡는다)은 그대로다. 걸리면 고정 열을 줄이거나 폼을 다시 볼 것.
  it.each(FORMS)("[%s] 특이사항이 슬리버가 되지 않는다 — 고정 열을 늘리면 여기서 걸린다", (form) => {
    expect(todayNoteWidth(form)).toBeGreaterThanOrEqual(100);
  });

  it("JJ 폼은 칸이 하나 더 많고 그만큼 특이사항이 줄어든다(원장 2026-08-13)", () => {
    expect(todayNoteWidth("selfStudy")).toBeLessThan(todayNoteWidth("default"));
  });

  it("k번째 교시 시작점 = 학생 열 + k×교시 폭 (위아래 같은 식)", () => {
    expect(todaySlotOffset(0)).toBe(TODAY_NAME_W);
    expect(todaySlotOffset(1)).toBe(TODAY_NAME_W + TODAY_SLOT_W);
    expect(todaySlotOffset(3)).toBe(TODAY_NAME_W + 3 * TODAY_SLOT_W);
  });

  it("총 폭 = 마지막 교시의 끝 — 레일과 표가 같은 길이로 끝난다", () => {
    for (const n of [1, 2, 3, 5, 8]) {
      expect(todayContentWidth(n)).toBe(todaySlotOffset(n - 1) + TODAY_SLOT_W);
    }
  });

  it("교시가 없으면 학생 열만", () => {
    expect(todayContentWidth(0)).toBe(TODAY_NAME_W);
    expect(todayContentWidth(-3)).toBe(TODAY_NAME_W);
  });
});

/*
 * 이름 열에 `/학교학년`이 붙은 뒤의 폭 규약(원장 2026-09-10 *"학생이름 → 학생이름/학교학년"*).
 *
 * 아래 숫자는 전부 **2026-09-10 크롬 실측**(Pretendard, 이름 16px/700 + 학교학년 14px/600)이다:
 *   `김덕현/침산중1` 96.5 · `박서연D/경명여중2` 120.8 · 머리 `특이사항` 51.5(한 줄) / 26(두 줄).
 * 실데이터(영어 재원생 241명): 학교학년 4자 197 · 5자 40 / 이름 3자 212 · 4자 26.
 */
describe("주간 카드 이름 열 — 학교학년까지 담되 특이사항을 슬리버로 만들지 않는다", () => {
  /** 카드가 최소 폭(TODAY_PLAN_W)일 때의 표 폭 = 종전과 같은 조건. */
  const MIN_TABLE = TODAY_PLAN_W - SHEET_CARD_CHROME;

  it("기본 폼은 가장 흔한 조합(`김덕현/침산중1` ≈ 96.5 + 여백)이 최소 폭에서도 들어간다", () => {
    expect(weeklyNamePx("default", MIN_TABLE)).toBeGreaterThanOrEqual(101);
  });

  it.each(FORMS)("[%s] 최소 폭에서도 특이사항 머리가 두 줄로 설 폭(26px)은 남는다", (form) => {
    expect(weeklyNoteWidth(form, MIN_TABLE)).toBeGreaterThanOrEqual(26);
  });

  it("🔴 JJ 폼은 최소 폭에서 **종전 이름 열(60px) 그대로** — 이 화면에 회귀를 만들지 않는다", () => {
    // 고정 열만 309px이라 여기에 기본 폼과 같은 116을 고정으로 주면 특이사항이 0이 된다.
    expect(weeklyNamePx("selfStudy", MIN_TABLE)).toBeGreaterThanOrEqual(59);
    expect(weeklyNoteWidth("selfStudy", MIN_TABLE)).toBeGreaterThanOrEqual(28);
  });

  it.each(FORMS)("[%s] 카드가 넓어지면 특이사항이 그만큼 넓어진다(남는 폭은 특이사항 몫)", (form) => {
    const narrow = weeklyNoteWidth(form, MIN_TABLE);
    const wide = weeklyNoteWidth(form, MIN_TABLE + 200);
    expect(wide).toBeGreaterThan(narrow + 100);
  });

  it("기본 폼 이름 열은 **고정**이라 넓은 카드에서 이름 뒤가 빈 여백이 되지 않는다", () => {
    // 원장 2026-08-11 *"학생 뒤에 여백 많으니까 여백 최소화"* — 남는 폭은 전부 특이사항이 가져간다.
    expect(weeklyNameWidth("default")).toBe(TODAY_NAME_W);
    expect(weeklyNamePx("default", MIN_TABLE + 400)).toBe(TODAY_NAME_W);
  });

  it("카드 최대 폭은 최소의 두 배 — 요일 한둘뿐인 반이 화면을 통째로 먹지 않는다", () => {
    expect(SHEET_DAY_MAX_W).toBe(TODAY_PLAN_W * 2);
  });
});
