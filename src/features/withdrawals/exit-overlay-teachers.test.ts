import { describe, expect, it } from "vitest";
import { currentHomeroomIds, HOMEROOM_LOG_START, teacherNoteOf, zeroCandidateIds, type OverlayClass } from "./exit-overlay-teachers";

const cls = (p: Partial<OverlayClass> & Pick<OverlayClass, "id" | "teacherId">): OverlayClass => ({
  openedOn: "2026-03-01",
  closedOn: null,
  active: true,
  special: false,
  ...p,
});

const SEP = { from: "2026-09-01", to: "2026-09-30" };
const classes = [cls({ id: "A", teacherId: "park" }), cls({ id: "B", teacherId: "oh" }), cls({ id: "C", teacherId: "yoon" })];
const none = new Map();

describe("'퇴원 0' 후보 — 묶음과 같은 반·날짜 판정", () => {
  it("🔴 퇴원 줄의 반 담임은 '퇴원 0'에 서지 않는다 — 묶음이 담임 미상·대리 작성자로 묶었어도(적대 리뷰 #1)", () => {
    const ids = zeroCandidateIds({
      window: SEP, classes, history: none, historyFailed: false,
      exits: [{ reasonRaw: "dissatisfaction", classId: "A", lastDate: "2026-09-10" }],
    });
    expect([...ids!].sort()).toEqual(["oh", "yoon"]);
  });

  it("제외 사유(이사 등)만 있는 반의 담임은 0으로 선다 · 그 달 담임은 이력대로(달 말 기준)", () => {
    // B: 9/20에 오 → 한 인계(지금 담임 = 한). 9월 말 담임은 한, 8월 말 담임은 오.
    const history = new Map([["B", [{ teacherId: "oh", from: null, to: "2026-09-20" }, { teacherId: "han", from: "2026-09-20", to: null }]]]);
    const handed = classes.map((c) => (c.id === "B" ? { ...c, teacherId: "han" } : c));
    const aug = zeroCandidateIds({ window: { from: "2026-08-01", to: "2026-08-31" }, classes: handed, history, historyFailed: false, exits: [] });
    expect([...aug!].sort()).toEqual(["oh", "park", "yoon"]);
    const ids = zeroCandidateIds({
      window: SEP, classes: handed, history, historyFailed: false,
      exits: [{ reasonRaw: "relocation", classId: "A", lastDate: "2026-09-10" }],
    });
    expect([...ids!].sort()).toEqual(["han", "park", "yoon"]);
  });

  it("🔴 가릴 수 없으면 null — 기록 이전 퇴원 · 반 모름 · 이력 읽기 실패", () => {
    const base = { window: SEP, classes, history: none, historyFailed: false };
    expect(zeroCandidateIds({ ...base, exits: [{ reasonRaw: null, classId: "A", lastDate: "2026-08-01" }] })).toBeNull();
    expect(zeroCandidateIds({ ...base, exits: [{ reasonRaw: null, classId: null, lastDate: "2026-09-10" }] })).toBeNull();
    expect(zeroCandidateIds({ ...base, exits: [{ reasonRaw: null, classId: "Z", lastDate: "2026-09-10" }] })).toBeNull();
    expect(zeroCandidateIds({ ...base, historyFailed: true, exits: [] })).toBeNull();
    expect(HOMEROOM_LOG_START).toBe("2026-08-04");
  });

  it("🔴 기록이 그 날짜를 덮지 못하면 null — 9/22 전 인계는 바뀐 날부터만 남았다(재리뷰 2026-10-14)", () => {
    // A: 9/10에 박 → 한(이전 담임 구간 없음). 9/5 퇴원의 담임을 모르니 박을 0에 세울 수 없다.
    const history = new Map([["A", [{ teacherId: "han", from: "2026-09-10", to: null }]]]);
    const handed = classes.map((c) => (c.id === "A" ? { ...c, teacherId: "han" } : c));
    const base = { window: SEP, classes: handed, history, historyFailed: false };
    expect(zeroCandidateIds({ ...base, exits: [{ reasonRaw: "dissatisfaction", classId: "A", lastDate: "2026-09-05" }] })).toBeNull();
    // 덮는 날짜면 그대로 가린다.
    expect([...zeroCandidateIds({ ...base, exits: [{ reasonRaw: "dissatisfaction", classId: "A", lastDate: "2026-09-12" }] })!].sort()).toEqual(["oh", "yoon"]);
    // 기록도 지금 담임도 없는 반 = 담임이 없던 반 — 모르는 것이 아니다.
    const open = [...classes, cls({ id: "N", teacherId: null })];
    const ids = zeroCandidateIds({ window: SEP, classes: open, history: none, historyFailed: false, exits: [{ reasonRaw: null, classId: "N", lastDate: "2026-09-10" }] });
    expect([...ids!].sort()).toEqual(["oh", "park", "yoon"]);
  });

  it("기록 이전 달의 반 · 폐지(날짜 모름) · 특강 · 그 달 밖에 연/닫은 반은 후보가 아니다(빼는 쪽은 틀린 0을 만들지 않는다)", () => {
    const list = [
      cls({ id: "old", teacherId: "t1", closedOn: "2026-07-20" }),
      cls({ id: "arch", teacherId: "t2", active: false }),
      cls({ id: "sp", teacherId: "t3", special: true }),
      cls({ id: "late", teacherId: "t4", openedOn: "2026-10-02" }),
      cls({ id: "closedArch", teacherId: "t5", active: false, closedOn: "2026-09-15" }),
    ];
    expect([...zeroCandidateIds({ window: SEP, classes: list, history: none, historyFailed: false, exits: [] })!]).toEqual(["t5"]);
    const july = { from: "2026-07-01", to: "2026-07-31" };
    expect([...zeroCandidateIds({ window: july, classes: list, history: none, historyFailed: false, exits: [] })!]).toEqual([]);
  });
});

describe("오늘 담임 · 추정 근거", () => {
  it("색 기준 = 오늘 담임(종강·폐지·특강 제외) — 석 달 묶음의 기준 달과 무관", () => {
    const list = [...classes, cls({ id: "done", teacherId: "gone", closedOn: "2026-09-01" }), cls({ id: "sp", teacherId: "sp", special: true })];
    expect(currentHomeroomIds(list, none, "2026-10-14").sort()).toEqual(["oh", "park", "yoon"]);
  });

  it("기록으로 확인한 담임은 근거 없음 · 추정은 무엇으로 추정했는지", () => {
    expect(teacherNoteOf({ name: "박도윤", inferred: false, source: "assignment", date: "2026-09-10" })).toBeNull();
    expect(teacherNoteOf({ name: "박도윤", inferred: true, source: "report", date: "2026-09-30" })).toBe("마지막 보고서 작성자 9/30");
    expect(teacherNoteOf({ name: "박도윤", inferred: true, source: "attendance", date: "2026-09-08" })).toBe("마지막 출결 입력 9/8");
    expect(teacherNoteOf(undefined)).toBeNull();
  });
});
