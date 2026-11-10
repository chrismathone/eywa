import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { cardReasonSlots } from "./onescreen-card-reasons";
import { cardTemplateManager, cardTemplatePanel } from "./onescreen-card-english";
import { HomeworkMissReasonInput } from "./homework-miss-reason";
import { ReasonNoteInput } from "./reason-note-input";
import type { OneScreenStudent, Subject } from "../types";

// 카드 칸 그리기 함수(batch D) — 조건이 안 맞으면 예전처럼 null, 맞으면 같은 입력 칸을 같은 배선으로 돌려준다.
const tests = { daily: { score: null, max: 10, prevScore: null }, check: { score: null, max: 10, prevScore: null } };
const student = (over: Partial<OneScreenStudent> = {}) =>
  ({ id: "s1", name: "학생", attitude: null, homework: "", tests, subjects: [], ...over }) as unknown as OneScreenStudent;
const math = (over: Partial<Subject> = {}) => ({ name: "수학", subjectKey: "math", classId: "c1", ...over }) as unknown as Subject;
const reasonActions = () => ({
  setHomeworkMissReasonFor: vi.fn(),
  setAttitudeNoteFor: vi.fn(),
  setMakeupReasonFor: vi.fn(),
});
type InputEl = ReactElement<{ disabled?: boolean; labelKey?: string; onChange: (v: string) => void }>;

describe("사유 칸 셋(숙제 미제출 · 수업 태도 의견 · 보강 사유)", () => {
  it("과목 칩이 없으면 셋 다 null", () => {
    const slots = cardReasonSlots({
      selected: student(),
      ctx: { readonlyView: false },
      row: { previewSubject: undefined, previewReport: undefined },
      rowActions: reasonActions(),
    });
    expect(slots).toEqual({ homeworkExtra: null, attitudeExtra: null, makeupExtra: null });
  });

  it("숙제 미제출 행만 미제출 사유 칸 — 그 (학생, 과목)으로 쓴다", () => {
    const actions = reasonActions();
    const slots = cardReasonSlots({
      selected: student(),
      ctx: { readonlyView: false },
      row: { previewSubject: math({ homework: "미제출" }), previewReport: undefined },
      rowActions: actions,
    });
    const el = slots.homeworkExtra as InputEl;
    expect(el.type).toBe(HomeworkMissReasonInput);
    expect(el.props.disabled).toBe(false);
    el.props.onChange("아팠음");
    expect(actions.setHomeworkMissReasonFor).toHaveBeenCalledWith("s1", "수학", "아팠음");
    expect(slots.attitudeExtra).toBeNull();
    expect(slots.makeupExtra).toBeNull();
  });

  it("결석 날짜를 못 찾은 보강 줄은 보강 사유 칸 — 열람 전용이면 잠긴다", () => {
    const slots = cardReasonSlots({
      selected: student({ isMakeup: true }),
      ctx: { readonlyView: true },
      row: { previewSubject: math(), previewReport: undefined },
      rowActions: reasonActions(),
    });
    const el = slots.makeupExtra as InputEl;
    expect(el.type).toBe(ReasonNoteInput);
    expect(el.props.labelKey).toBe("os.card.mkReason.label");
    expect(el.props.disabled).toBe(true);
  });
});

describe("영어 템플릿 칸 · 관리 창", () => {
  const t = ((k: string) => k) as never;
  it("영어 행이 아니면 템플릿 칸은 null", () => {
    expect(
      cardTemplatePanel({
        selected: student(),
        ctx: { canLinkIjw: false, uploadingAttKey: null },
        row: { previewSubject: math(), previewReport: undefined },
        english: {} as never,
        rowActions: {} as never,
        t,
      }),
    ).toBeNull();
  });

  it("관리 창은 열려 있을 때만 그린다", () => {
    const english = { englishTemplates: [], setEnglishTemplates: vi.fn(), templateNotice: null, templateListFailed: false, setTemplateManagerOpen: vi.fn() };
    const ctx = { teacherName: "선생님", activeDate: "2026-11-11" };
    const row = { setReports: vi.fn() };
    expect(cardTemplateManager({ ctx, row, english: { ...english, templateManagerOpen: false }, t })).toBeNull();
    expect(cardTemplateManager({ ctx, row, english: { ...english, templateManagerOpen: true }, t })).not.toBeNull();
  });
});
