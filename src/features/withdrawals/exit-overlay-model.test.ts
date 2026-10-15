import { describe, expect, it } from "vitest";
import { DEFAULT_CHURN_OPTIONS } from "@/features/teacher-portfolio/evaluation/options";
import {
  buildOverlayMonth,
  exclusionNote,
  isExcludedExit,
  isExitOverlayHotkey,
  monthHeading,
  reasonKeyOf,
  type OverlayExitInput,
} from "./exit-overlay-model";
import { teacherTints, TEACHER_TINTS } from "./exit-overlay-teachers";

const exit = (p: Partial<OverlayExitInput> & Pick<OverlayExitInput, "key" | "teachers" | "date">): OverlayExitInput => ({
  kind: "withdrawn",
  name: p.key,
  schoolGrade: "칠성초6",
  reasonRaw: "dissatisfaction",
  memo: null,
  ...p,
});

const RULES = DEFAULT_CHURN_OPTIONS;

describe("사유 → 제외 판정(기본 이사·질병·권고퇴원·졸업 — 강사평가 설정)", () => {
  it("표준 키·라벨과 같은 글·표기 흔들림은 키로 본다", () => {
    expect(reasonKeyOf("relocation")).toBe("relocation");
    expect(reasonKeyOf("이사")).toBe("relocation");
    expect(reasonKeyOf("moved")).toBe("relocation");
    expect(reasonKeyOf("권고퇴원")).toBe("advised");
  });
  it("그 밖의 자유 글은 키가 아니다('기타'로 뭉개지 않는다)", () => {
    expect(reasonKeyOf("종강")).toBeNull();
    expect(reasonKeyOf("")).toBeNull();
    expect(reasonKeyOf(null)).toBeNull();
  });
  it("기본은 넷만 제외 — 수업 불만족·타 학원·기타는 센다", () => {
    for (const r of ["relocation", "illness", "advised", "graduated", "이사", "질병", "졸업"]) expect(isExcludedExit(r, RULES.excludeReasons)).toBe(true);
    for (const r of ["dissatisfaction", "competitor", "other", "종강", null]) expect(isExcludedExit(r, RULES.excludeReasons)).toBe(false);
  });
  it("원장이 고른 사유를 그대로 — 졸업을 다시 세고 타 학원을 빼면 그렇게", () => {
    const reasons = ["relocation", "illness", "advised", "competitor"];
    expect(isExcludedExit("graduated", reasons)).toBe(false);
    expect(isExcludedExit("타 학원으로 이동", reasons)).toBe(true);
  });
});

describe("한 달 열", () => {
  const exits: OverlayExitInput[] = [
    exit({ key: "a", teachers: ["오세린"], date: "2026-10-01", memo: "수업 따라가기 힘들어함" }),
    // 담임 + 교시 담당 둘 다 퇴원율에 넣은 줄 — 두 묶음에 선다(건수는 한 번).
    exit({ key: "b", teachers: ["박도윤", "오세린"], date: "2026-10-02" }),
    exit({ key: "c", teachers: ["박도윤"], date: "2026-10-02", kind: "subject-ended", reasonRaw: "종강", keepSubjects: ["영어"] }),
    exit({ key: "d", teachers: [], date: "2026-10-06", reasonRaw: "relocation", memo: "대전으로" }),
    exit({ key: "e", teachers: [], date: "2026-10-07" }),
    exit({ key: "f", teachers: ["오세린"], date: "2026-09-30" }), // 지난달 — 이 열에 안 선다
  ];
  const month = buildOverlayMonth({
    month: "2026-10",
    today: "2026-10-14",
    exits,
    zeroTeachers: ["오세린", "한지수", "윤하람", "윤하람"],
    holds: [{ key: "h", name: "최지안", schoolGrade: "달성초4", teacher: "최가온", className: "초4 기본" }],
    rules: RULES,
  });

  it("묶음 = 강사평가 퇴원율이 넣은 선생님마다 · 센 건수 많은 순 · 같으면 가나다 · 선생님 미반영은 맨 뒤", () => {
    expect(month.groups.map((g) => [g.teacher, g.count])).toEqual([
      ["박도윤", 2],
      ["오세린", 2],
      [null, 1],
    ]);
  });
  it("🔴 건수 = 수강종료까지 합친 퇴원에서 줄 그은 줄만 뺀 수 — 여러 묶음에 선 줄도 한 번 · 다른 달 줄은 안 선다", () => {
    expect(month.count).toBe(4);
    expect(month.groups.flatMap((g) => g.rows).map((r) => r.key)).not.toContain("f");
  });
  it("퇴원 0 = 서버가 준 퇴원율 0 명단에서 이 겹침에 센 줄이 있는 선생님을 한 번 더 뺀다(중복 없음, 가나다)", () => {
    expect(month.zero).toEqual(["윤하람", "한지수"]);
  });
  it("줄 글자 — 메모가 있으면 메모 · 제외 줄은 사유 라벨 · 날짜는 M/D · 수강종료는 계속 다니는 과목을 툴팁에", () => {
    const rows = Object.fromEntries(month.groups.flatMap((g) => g.rows).map((r) => [r.key, r]));
    expect(rows.a!.reason).toBe("수업 따라가기 힘들어함");
    expect(rows.a!.dateLabel).toBe("10/1");
    expect(rows.d!.reason).toBe("이사");
    expect(rows.d!.excluded).toBe(true);
    expect(rows.d!.reasonTitle).toBe("이사 · 대전으로");
    expect(rows.c!.reason).toBe("종강");
    expect(rows.c!.reasonTitle).toContain("영어 계속 다님");
  });
  it("담당을 못 찾은 줄(서버가 빈 배열)은 '선생님 미반영' 묶음에 선다 — 줄 그은 줄도 줄 그은 채", () => {
    const none = month.groups.find((g) => g.teacher === null)!;
    expect(none.rows.map((r) => [r.key, r.excluded])).toEqual([["d", true], ["e", false]]);
  });
  it("줄 긋기는 줄의 사유 칸(학생 퇴원 사유)으로 — 선생님 묶음에 선 줄도 그 사유면 긋는다(원장 '지금대로')", () => {
    const m = buildOverlayMonth({ month: "2026-10", today: "2026-10-14", zeroTeachers: [], holds: null, rules: RULES,
      exits: [exit({ key: "x", teachers: ["박도윤"], date: "2026-10-03", reasonRaw: "graduated" })] });
    expect(m.groups.map((g) => [g.teacher, g.count, g.rows[0]!.excluded])).toEqual([["박도윤", 0, true]]);
    expect(m.count).toBe(0);
  });
  it("원장 설정을 따른다 — 졸업을 다시 세면 안 긋고 · 수강종료를 안 세면 퇴원율에 안 든 수강종료를 긋는다", () => {
    const rules = { excludeReasons: ["relocation"], countEnded: false };
    const m = buildOverlayMonth({ month: "2026-10", today: "2026-10-14", zeroTeachers: [], holds: null, rules,
      exits: [
        exit({ key: "g", teachers: [], date: "2026-10-03", reasonRaw: "graduated" }),
        exit({ key: "s", teachers: [], date: "2026-10-04", kind: "subject-ended", reasonRaw: "dissatisfaction" }),
      ] });
    const rows = Object.fromEntries(m.groups.flatMap((g) => g.rows).map((r) => [r.key, r]));
    expect([rows.g!.excluded, rows.s!.excluded, m.count]).toEqual([false, true, 1]);
    expect(rows.s!.reasonTitle).toBe("수업·강사 · 수강종료는 세지 않음");
    // 퇴원율이 '퇴원'으로 센 수강종료 줄(선생님이 붙음)은 긋지 않는다 — 선생님 건수 = 강사평가.
    const t = buildOverlayMonth({ month: "2026-10", today: "2026-10-14", zeroTeachers: [], holds: null, rules,
      exits: [exit({ key: "t", teachers: ["박도윤"], date: "2026-10-04", kind: "subject-ended", reasonRaw: "dissatisfaction" })] });
    expect(t.groups.map((g) => [g.teacher, g.count])).toEqual([["박도윤", 1]]);
  });
  it("🔴 함께 끝난 수강의 종료 사유도 본다 — 사유 칸이 '기타'여도 수강 사유가 '졸업'이면 긋고 그 사유를 적는다(원장 '모든 곳에서')", () => {
    const m = buildOverlayMonth({ month: "2026-10", today: "2026-10-14", zeroTeachers: [], holds: null, rules: RULES,
      exits: [exit({ key: "y", teachers: [], date: "2026-10-03", reasonRaw: "other", endReasons: ["graduated"] })] });
    const r = m.groups[0]!.rows[0]!;
    expect([r.excluded, r.reason, r.reasonTitle, m.count]).toEqual([true, "졸업", "기타 · 졸업", 0]);
  });
  it("안내 한 줄 = 고른 세는 법 그대로(사유는 사유 표 순서)", () => {
    // 사유는 사유 표(REASON_LABEL) 순서 — 2026-10-15 사유 2단계에서 표 순서가 바뀌었다(이사·졸업이 뒤로).
    expect(exclusionNote(RULES)).toBe("과목을 끊은 학생도 퇴원으로 셉니다. 줄을 긋고 건수에서 빼는 것: 질병 · 권고퇴원 · 이사 · 졸업.");
    expect(exclusionNote({ excludeReasons: [], countEnded: false })).toBe("줄을 긋고 건수에서 빼는 것: 과목만 끊은 수강종료.");
    expect(exclusionNote({ excludeReasons: [], countEnded: true })).toBe("과목을 끊은 학생도 퇴원으로 셉니다.");
  });
  it("이번 달이면 '진행 중' · 휴원은 넘겨준 그대로(건수에 안 섞는다)", () => {
    expect(month.live).toBe(true);
    expect(month.holds).toHaveLength(1);
    expect(month.label).toBe("10월");
  });
});

describe("열 머리 · 선생님 색 · 단축키", () => {
  it("올해가 아니면 연도를 붙인다", () => {
    expect(monthHeading("2026-08", "2026-10-14")).toBe("8월");
    expect(monthHeading("2025-12", "2026-01-05")).toBe("2025년 12월");
  });
  it("색은 오늘 담임 가나다순으로 고정 — 그때 담임은 뒤에 이어 붙는다 · 16색", () => {
    expect(new Set(TEACHER_TINTS).size).toBe(16);
    const a = teacherTints(["박도윤", "오세린"], ["김예전"]);
    const b = teacherTints(["오세린", "박도윤"], []);
    expect(a["박도윤"]).toBe(b["박도윤"]);
    expect(a["박도윤"]).toBe(TEACHER_TINTS[0]);
    expect(a["오세린"]).toBe(TEACHER_TINTS[1]);
    expect(a["김예전"]).toBe(TEACHER_TINTS[2]);
  });
  const key = (p: Partial<Parameters<typeof isExitOverlayHotkey>[0]>) =>
    isExitOverlayHotkey({ code: "KeyX", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, repeat: false, target: null, ...p });
  it("X 자리(KeyX)면 한/영 상관없이 연다 — 조합키·누르고 있기·입력칸은 아니다", () => {
    expect(key({})).toBe(true);
    expect(key({ code: "KeyZ" })).toBe(false);
    expect(key({ ctrlKey: true })).toBe(false);
    expect(key({ metaKey: true })).toBe(false);
    expect(key({ shiftKey: true })).toBe(false);
    expect(key({ repeat: true })).toBe(false);
    expect(key({ target: { tagName: "INPUT" } as unknown as EventTarget })).toBe(false);
    expect(key({ target: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget })).toBe(false);
  });
});
