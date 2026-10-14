import { describe, expect, it } from "vitest";
import {
  buildOverlayMonth,
  isExcludedExit,
  isExitOverlayHotkey,
  monthHeading,
  reasonKeyOf,
  type OverlayExitInput,
} from "./exit-overlay-model";
import { teacherTints, TEACHER_TINTS } from "./exit-overlay-teachers";

const exit = (p: Partial<OverlayExitInput> & Pick<OverlayExitInput, "key" | "teacher" | "date">): OverlayExitInput => ({
  kind: "withdrawn",
  name: p.key,
  schoolGrade: "칠성초6",
  reasonRaw: "dissatisfaction",
  memo: null,
  ...p,
});

describe("사유 → 제외 판정(이사·질병·권고퇴원·졸업)", () => {
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
  it("넷만 제외 — 수업 불만족·타 학원·기타는 센다", () => {
    for (const r of ["relocation", "illness", "advised", "graduated", "이사", "질병", "졸업"]) expect(isExcludedExit(r)).toBe(true);
    for (const r of ["dissatisfaction", "competitor", "other", "종강", null]) expect(isExcludedExit(r)).toBe(false);
  });
});

describe("한 달 열", () => {
  const exits: OverlayExitInput[] = [
    exit({ key: "a", teacher: "오세린", date: "2026-10-01", memo: "수업 따라가기 힘들어함" }),
    exit({ key: "b", teacher: "박도윤", date: "2026-10-02" }),
    exit({ key: "c", teacher: "박도윤", date: "2026-10-02", kind: "subject-ended", reasonRaw: "종강", keepSubjects: ["영어"] }),
    exit({ key: "d", teacher: "한지수", date: "2026-10-06", reasonRaw: "relocation", memo: "대전으로" }),
    exit({ key: "e", teacher: null, date: "2026-10-07" }),
    exit({ key: "g", teacher: "오세린", date: "2026-10-09", teacherNote: "마지막 보고서 작성자 10/8" }),
    exit({ key: "f", teacher: "오세린", date: "2026-09-30" }), // 지난달 — 이 열에 안 선다
  ];
  const month = buildOverlayMonth({
    month: "2026-10",
    today: "2026-10-14",
    exits,
    homeroomTeachers: ["오세린", "박도윤", "한지수", "윤하람", "윤하람"],
    holds: [{ key: "h", name: "최지안", schoolGrade: "달성초4", teacher: "최가온", className: "초4 기본" }],
  });

  it("묶음 = 센 건수 많은 순 · 같으면 가나다 · 담임 미상은 맨 뒤", () => {
    expect(month.groups.map((g) => [g.teacher, g.count])).toEqual([
      ["박도윤", 2],
      ["오세린", 2],
      ["한지수", 0],
      [null, 1],
    ]);
  });
  it("건수 = 제외 줄을 뺀 퇴원·수강종료 · 다른 달 줄은 안 선다", () => {
    expect(month.counts).toEqual({ withdrawn: 4, subjectEnded: 1, excluded: 1 });
    expect(month.groups.flatMap((g) => g.rows).map((r) => r.key)).not.toContain("f");
  });
  it("퇴원 0 = 그 달 담임 중 센 건수가 0 — 제외 줄만 있는 선생님도 들어간다(중복 없음, 가나다)", () => {
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
  it("추정한 선생님 = 묶음 머리에 줄 수 · 줄 툴팁 끝에 근거(기록으로 확인한 줄은 없음)", () => {
    const se = month.groups.find((g) => g.teacher === "오세린")!;
    expect(se.inferred).toBe(1);
    expect(se.rows.find((r) => r.key === "g")!.reasonTitle).toContain("선생님 추정 — 마지막 보고서 작성자 10/8");
    expect(se.rows.find((r) => r.key === "a")!.teacherNote).toBeNull();
    expect(month.groups.find((g) => g.teacher === "박도윤")!.inferred).toBe(0);
  });
  it("🔴 '퇴원 0'을 가릴 수 없는 달(null)은 null 그대로 — 빈 명단으로 바꾸지 않는다", () => {
    const m = buildOverlayMonth({ month: "2026-10", today: "2026-10-14", exits, homeroomTeachers: null, holds: null });
    expect(m.zero).toBeNull();
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
