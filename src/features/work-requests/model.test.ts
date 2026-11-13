import { describe, expect, it } from "vitest";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "@/features/dashboard/instruments/testing/fixture";
import { requestPrefill } from "@/features/dashboard/instruments/check-requests";
import { closeBasis, dueLabel, effectiveStudents, filterWork, isLate, linksByAssignee, matchesWork, myTurn, receivedBy, receivedCounts, stageOf, statusText, studentCount, urgentFirst, workCounts, type WorkItem } from "./model";
import { FIXTURE_WORK } from "./testing/fixture";

const at = (id: string) => FIXTURE_WORK.items.find((i) => i.id === id)!;

describe("업무 요청 — 단계 · 내 차례", () => {
  it("상태 글자와 단계 막대", () => {
    expect(statusText(at("w1"))).toBe("처리 중 1/2");
    expect(statusText(at("w2"))).toBe("검토 대기");
    expect(statusText(at("w3"))).toBe("확인 전");
    expect(statusText(at("w4"))).toBe("마감");
    expect([at("w1"), at("w2"), at("w4")].map((i) => stageOf(i.status))).toEqual([0, 1, 2]);
    const returned: WorkItem = { ...at("w1"), steps: [{ ...at("w1").steps[0]!, state: "acked", returnedNote: "근거 첨부", returned: true }, at("w1").steps[1]!] };
    expect(statusText(returned)).toBe("보완 중");
  });
  it("내 차례 — 담당자는 보고 · 검토자(없으면 요청자)는 검토", () => {
    expect(myTurn(at("w3"), "u0")).toBe("report");
    expect(myTurn(at("w2"), "u0")).toBe("review");
    expect(myTurn(at("w1"), "u0")).toBeNull();
    expect(myTurn(at("w1"), "u2")).toBe("report");
    expect(myTurn(at("w1"), "u1")).toBeNull();
    expect(myTurn(at("w2"), null)).toBeNull();
  });
  it("탭 · 현황 · 기한", () => {
    expect(filterWork(FIXTURE_WORK.items, "mine", "u0").map((i) => i.id)).toEqual(["w2", "w3"]);
    expect(filterWork(FIXTURE_WORK.items, "requested", "u0").map((i) => i.id)).toEqual(["w1", "w2"]);
    expect(filterWork(FIXTURE_WORK.items, "past", "u0").map((i) => i.id)).toEqual(["w4"]);
    expect(workCounts(FIXTURE_WORK.items, "2026-11-04")).toEqual({ ready: 1, working: 1, returned: 0, review: 1, late: 1, closedWeek: 1 });
    expect(isLate(at("w4"), "2026-11-04")).toBe(false);
  });
  it("마감 근거는 보고와 승인한 사람으로 — 지어내지 않는다", () => {
    expect(closeBasis(at("w4"))).toBe("강사 가 처리함 → 관리자 나 승인");
    expect(closeBasis(at("w1"))).toBeNull();
  });
});

describe("확인할 일 → 업무 요청 초안 — 학생마다 그 반 담임", () => {
  const ctx = { snapshot: FIXTURE_SNAPSHOT, extras: FIXTURE_EXTRAS };
  const pairs = (d: ReturnType<typeof requestPrefill>) => d!.students!.map((s) => `${s.name}→${s.assigneeId ?? "미정"}`);
  it("반복 결석 — 결석이 난 반마다 그 반 담임(두 반에서 빠진 학생은 두 담임에게)", () => {
    const d = requestPrefill("absence", ctx)!;
    expect(d.assigneeIds).toEqual(["t0", "t1"]);
    expect(pairs(d)).toEqual(["학생 아→t0", "학생 사→t0", "학생 사→t1"]);
    expect(d.body).toContain("2명");
    expect(d.dueOn).toBe("2026-11-05");
  });
  it("담임 상담 — 지난달부터 없는 학생만 그 담임에게", () => {
    expect(pairs(requestPrefill("homeroom", ctx))).toEqual(["학생 마→t0", "학생 라→t1"]);
  });
  it("숙제 — 숙제가 나온 반의 담임을 반 id로(이름으로 찾지 않는다) · 못 찾으면 담당 미정", () => {
    const d = requestPrefill("homework", ctx)!;
    expect(d.assigneeIds).toEqual(["t0", "t1"]);
    expect(pairs(d)).toEqual(["학생 마→t0", "학생 사→t0", "학생 라→t1"]);
    const noRoster = requestPrefill("homework", { ...ctx, extras: { ...FIXTURE_EXTRAS, roster: null } })!;
    expect(noRoster.assigneeIds).toEqual([]);
    expect(pairs(noRoster).every((x) => x.endsWith("미정"))).toBe(true);
  });
  it("근거 없는 줄은 요청 없음", () => {
    expect(requestPrefill("billing", ctx)).toBeNull();
    expect(requestPrefill("absence", { ...ctx, extras: { ...FIXTURE_EXTRAS, absenceLines: [] } })).toBeNull();
  });
});

describe("업무 흐름 목록 — 급한 순 · 찾기 · 기한 · 담당자별 학생", () => {
  it("내 차례 → 기한 지남 → 기한 가까운 순", () => {
    expect(urgentFirst(FIXTURE_WORK.items, "u0", "2026-11-04").map((i) => i.id)).toEqual(["w3", "w2", "w1", "w4"]);
  });
  it("제목 · 사람 · 근거 학생 이름으로 찾는다", () => {
    expect(FIXTURE_WORK.items.filter((i) => matchesWork(i, "학생 차")).map((i) => i.id)).toEqual(["w2"]);
    expect(FIXTURE_WORK.items.filter((i) => matchesWork(i, "매니저")).map((i) => i.id)).toEqual(["w1"]);
    expect(FIXTURE_WORK.items.filter((i) => matchesWork(i, " ")).length).toBe(4);
  });
  it("기한 글자", () => {
    expect(dueLabel(at("w1"), "2026-11-02")).toEqual({ text: "11.04 · 2일 남음", late: false });
    expect(dueLabel(at("w1"), "2026-11-04")).toEqual({ text: "11.04 · 오늘", late: false });
    expect(dueLabel(at("w1"), "2026-11-06")).toEqual({ text: "11.04 · 2일 지남", late: true });
    expect(dueLabel(at("w4"), "2026-11-06")).toEqual({ text: "10.31", late: false });
  });
  it("담당자별 학생 — 담당자에서 빠진 사람의 학생은 담당 미정", () => {
    const by = linksByAssignee(at("w2").links, ["t0", "t1"]);
    expect(by.get("t0")!.map((l) => l.label)).toEqual(["학생 아"]);
    expect(by.get(null)!.map((l) => l.label)).toEqual(["학생 차"]);
    expect(linksByAssignee(at("w2").links, ["t0"]).get(null)!.map((l) => l.label)).toEqual(["학생 사", "학생 차"]);
  });
});

describe("근거 학생 정리 — 저장 · 묶음 · 다시 짓기가 같은 규칙", () => {
  it("다른 담당자가 맡은 학생의 담당 미정 줄은 빼고, 같은 (학생, 담당자)는 하나만", () => {
    const students = [
      { id: "s1", name: "가", assigneeId: "t0" }, { id: "s1", name: "가", assigneeId: "t9" }, // t9는 담당자가 아니다 → 미정이지만 t0가 맡았다
      { id: "s2", name: "나", assigneeId: "t9" }, { id: "s2", name: "나", assigneeId: null }, // 둘 다 미정 → 하나만
      { id: "s3", name: "다", assigneeId: "t1" }, { id: "s3", name: "다", assigneeId: "t1" },
    ];
    expect(effectiveStudents(students, ["t0", "t1"]).map((s) => `${s.id}|${s.assigneeId ?? ""}`)).toEqual(["s1|t0", "s2|", "s3|t1"]);
  });
  it("학생 수 = 같은 학생은 한 명(목록 · 상세가 같은 수)", () => {
    expect(studentCount({ links: [{ type: "student", id: "s1", label: "가", assigneeId: "t0" }, { type: "student", id: "s1", label: "가", assigneeId: "t1" }] })).toBe(1);
  });
});

describe("받은 업무 요청(강사 홈) — 내가 담당자인 것만", () => {
  it("🔴 요청자 · 검토자로만 엮인 것은 안 센다 · 내 차례 = 내 확인 · 보고가 남은 것", () => {
    // 강사 가(t0): w2(검토 대기 · 이미 보고) + w4(마감) — 진행 중 1 · 내 차례 0(남이 검토 중이라고 내 몫이 남은 게 아니다)
    expect(receivedCounts(FIXTURE_WORK.items, "t0")).toEqual({ total: 2, open: 1, turn: 0 });
    // 매니저 다(u2): w1 확인만 함 → 보고가 남음
    expect(receivedCounts(FIXTURE_WORK.items, "u2")).toEqual({ total: 1, open: 1, turn: 1 });
    // 원장 가(u0)는 w1 · w2 · w4의 요청자지만 담당은 w3 하나뿐
    expect(receivedBy(FIXTURE_WORK.items, "u0").map((i) => i.id)).toEqual(["w3"]);
    expect(receivedCounts(FIXTURE_WORK.items, null)).toEqual({ total: 0, open: 0, turn: 0 });
  });
});
