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

const exit = (p: Partial<OverlayExitInput> & Pick<OverlayExitInput, "key" | "teachers" | "date">): OverlayExitInput => ({
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
