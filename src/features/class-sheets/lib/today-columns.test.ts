import { describe, expect, it } from "vitest";
import {
  TODAY_BASE_COLS,
  TODAY_GUTTER,
  TODAY_NAME_W,
  TODAY_PLAN_W,
  TODAY_SLOT_W,
  todayContentWidth,
  todayNoteWidth,
  todaySlotCols,
  todaySlotOffset,
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
