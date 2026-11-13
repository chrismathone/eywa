import { describe, expect, it } from "vitest";
import { pickRouteClass } from "../../../scripts/_classnote/class-route-decide.mjs";
import {
  acceptMakeupAnchor,
  makeupAnchorLockedReason,
  makeupInvariantViolations,
  makeupSendClassOf,
  planMakeupCellMove,
  substituteTaughtBy,
  type AnchorCandidate,
  type MoveCellRow,
} from "./makeup-anchor";
import { decideSendClass, sendClassGateRow } from "./send-class";

const D = "2026-09-30";
const cand = (over: Partial<AnchorCandidate> & { id: string }): AnchorCandidate => ({
  className: over.id,
  subject: "math",
  closedAt: null,
  mine: false,
  enrolled: false,
  ...over,
});

describe("acceptMakeupAnchor — 원장 결정 2: 담당 반 ∪ 학생이 다니는 반 · 같은 과목 · 종강 전", () => {
  const list = [
    cand({ id: "mine", mine: true }),
    cand({ id: "B", enrolled: true }), // 위임 없이 남의 반 — 학생의 원래 반
    cand({ id: "other" }), // 담당도 수강도 아님
    cand({ id: "eng", subject: "english", enrolled: true }),
    cand({ id: "closed", mine: true, closedAt: "2026-09-29" }),
  ];
  it("담당 반·학생 수강 반은 받는다", () => {
    expect(acceptMakeupAnchor(list, "mine", "math", D)?.id).toBe("mine");
    expect(acceptMakeupAnchor(list, "B", "math", D)?.id).toBe("B");
  });
  it("🔴 접점 없는 반·다른 과목·종강 반·빈 값은 받지 않는다(저장 오류 — 조용히 옛 값으로 두지 않는다)", () => {
    expect(acceptMakeupAnchor(list, "other", "math", D)).toBeNull();
    expect(acceptMakeupAnchor(list, "eng", "math", D)).toBeNull();
    expect(acceptMakeupAnchor(list, "closed", "math", D)).toBeNull();
    expect(acceptMakeupAnchor(list, null, "math", D)).toBeNull();
    expect(acceptMakeupAnchor(list, "mine", null, D)).toBeNull();
  });
  it("종강일 당일까지는 받는다(시간표 경계와 같다)", () => {
    expect(acceptMakeupAnchor([cand({ id: "x", mine: true, closedAt: D })], "x", "math", D)?.id).toBe("x");
  });
});

describe("substituteTaughtBy — 원장 결정 3: 대신 보강 칸만 보강한 강사 몫", () => {
  it("보강한 강사가 그 반을 담당하지 않으면 그 강사", () => expect(substituteTaughtBy("A", false)).toBe("A"));
  it("담당 반이면 비운다(종전 축)", () => expect(substituteTaughtBy("A", true)).toBeNull());
  it("소유자를 모르면 비운다(지어내지 않는다)", () => expect(substituteTaughtBy(null, false)).toBeNull());
});

describe("makeupSendClassOf — 보강 보고서의 발송 반 = 보강 반", () => {
  it("반 없는 보강만 보강 반, 정규는 null(보고서 반 그대로)", () => {
    expect(makeupSendClassOf({ makeup: true, classId: null, makeupClassId: "m" })).toBe("m");
    expect(makeupSendClassOf({ makeup: true, classId: "c", makeupClassId: "m" })).toBeNull();
    expect(makeupSendClassOf({ makeup: false, classId: null, makeupClassId: "m" })).toBeNull();
  });
});

describe("makeupInvariantViolations — 🔴 보강 보고서 반 = 보강 출결 행 반 = 발송 반", () => {
  const r = (over = {}) => ({ makeup: true, classId: null, makeupClassId: "B", classnoteClassId: "B", ...over });
  it("앵커 반에 칸이 있고 발송 반이 같으면 위반 없음", () =>
    expect(makeupInvariantViolations({ report: r(), cells: [{ classId: "B", status: "makeup" }], requireAnchor: true })).toEqual([]));
  it("정규 보고서는 대상이 아니다", () =>
    expect(makeupInvariantViolations({ report: r({ classId: "c" }), cells: [], requireAnchor: true })).toEqual([]));
  it("반 미정 = 반별 발송 대상일 때만 위반", () => {
    expect(makeupInvariantViolations({ report: r({ makeupClassId: null, classnoteClassId: null }), cells: [], requireAnchor: true })).toEqual(["no_anchor"]);
    expect(makeupInvariantViolations({ report: r({ makeupClassId: null, classnoteClassId: null }), cells: [], requireAnchor: false })).toEqual([]);
  });
  it("앵커 반에 칸이 없고 다른 반(보이지 않는 보강 반 등)에 보강 칸이 있으면 둘 다 위반", () =>
    expect(makeupInvariantViolations({ report: r(), cells: [{ classId: "pool", status: "makeup" }], requireAnchor: true })).toEqual([
      "no_cell_in_anchor",
      "cell_outside_anchor",
    ]));
  it("보고서 전달 반이 달라도 보강 출결 반은 보존한다", () => {
    expect(makeupInvariantViolations({ report: r({ classnoteClassId: "X" }), cells: [{ classId: "B", status: "present" }], requireAnchor: true })).toEqual([]);
    expect(makeupSendClassOf(r({ classnoteClassId: "X" }))).toBe("X");
  });
});

const row = (id: string, classId: string, status: string, recordedAt = "2026-09-30T10:00:00Z", slotStart: string | null = null): MoveCellRow => ({
  id,
  classId,
  status,
  slotStart,
  recordedAt,
});

describe("planMakeupCellMove — 반을 바꾸면 칸을 **함께** 옮긴다(시수·메모·이력 보존 = 행 반만 바꾼다)", () => {
  it("옮길 게 없으면 none(새 반엔 저장 훅이 칸을 세운다)", () =>
    expect(planMakeupCellMove({ fromRows: [], toRows: [], fromIsPool: false })).toEqual({ kind: "none" }));
  it("옛 앵커의 보강 칸(정정 이력 포함) 전부를 옮긴다", () =>
    expect(
      planMakeupCellMove({
        fromRows: [row("1", "A", "present", "2026-09-30T09:00:00Z"), row("2", "A", "makeup", "2026-09-30T10:00:00Z")],
        toRows: [],
        fromIsPool: false,
      }),
    ).toEqual({ kind: "move", ids: ["1", "2"] }));
  it("🔴 옛 반의 **유효** 칸이 보강이 아니면(정규 칸에 시수를 얹은 보강) 막는다 — 정규 출석을 통째로 옮기지 않는다", () =>
    expect(planMakeupCellMove({ fromRows: [row("1", "A", "present")], toRows: [], fromIsPool: false })).toEqual({
      kind: "blocked",
      reason: "regular_cell_in_old_class",
    }));
  it("보이지 않는 보강 반은 상태를 따지지 않는다(그 반엔 보강만 산다)", () =>
    expect(planMakeupCellMove({ fromRows: [row("1", "P", "absent")], toRows: [], fromIsPool: true })).toEqual({ kind: "move", ids: ["1"] }));
  it("🔴 새 반에 그날 칸이 이미 있으면 막는다(두 칸이 겹치면 최신 한 행만 유효 — 시수가 조용히 사라진다)", () =>
    expect(planMakeupCellMove({ fromRows: [row("1", "A", "makeup")], toRows: [row("9", "B", "present")], fromIsPool: false })).toEqual({
      kind: "blocked",
      reason: "target_has_cell",
    }));
});

describe("makeupAnchorLockedReason — 게시된·게시 중·회수 중 보강은 반을 못 바꾼다", () => {
  it("게시 기록·success·processing·회수 중은 사유, 그 밖은 null", () => {
    expect(makeupAnchorLockedReason({ classnoteStatus: null, classnoteSentAt: "2026-09-30" })).toMatch(/발송/);
    expect(makeupAnchorLockedReason({ classnoteStatus: "success", classnoteSentAt: null })).toMatch(/발송/);
    expect(makeupAnchorLockedReason({ classnoteStatus: "processing", classnoteSentAt: null })).toMatch(/발송 중/);
    expect(makeupAnchorLockedReason({ classnoteStatus: "recall_requested", classnoteSentAt: null })).toMatch(/회수/);
    expect(makeupAnchorLockedReason({ classnoteStatus: "queued", classnoteSentAt: null })).toBeNull();
    expect(makeupAnchorLockedReason({ classnoteStatus: null, classnoteSentAt: null })).toBeNull();
  });
});

/**
 * 🔴 **경로별 불변식 잠금** — 반을 정하거나 바꾸는 모든 쓰기 경로가 끝난 상태에서 불변식이 성립하는지, 경로가 쓰는 **같은 순수 조각**으로
 * 시뮬레이션한다(서버 문은 이 조각을 조합한다 — 배선은 `makeup-anchor-wiring.test.ts`가 잠근다).
 * 상태 = 보고서(보강 반·보낼 반) + 그날 칸들(반·상태). 경로 = ① 첫 저장 ② 반 바꾸기(저장·액션·발송 다이얼로그·관리자 고르기 공통)
 * ③ 앵커 없던 옛 보강에 반 지정 ④ 발송(앱 판정 → 워커).
 */
describe("🔴 불변식 경로 시뮬레이션 — 같은 학생·날짜·과목: 보강 보고서 반 = 보강 출결 행 반 = 발송 반", () => {
  type Cell = MoveCellRow;
  type State = { report: { makeup: true; classId: null; makeupClassId: string | null; classnoteClassId: string | null }; cells: Cell[] };
  /** 서버 `syncAnchorCells`의 순수 모형 — 계획된 이동 + 없으면 세운다. `prepareMakeupAnchor`가 막히면 아무것도 안 바꾼다. */
  const changeAnchor = (s: State, to: string, poolId = "pool"): State | "blocked" => {
    const from = s.report.makeupClassId ?? poolId;
    const plan = planMakeupCellMove({
      fromRows: s.cells.filter((c) => c.classId === from),
      toRows: s.cells.filter((c) => c.classId === to),
      fromIsPool: !s.report.makeupClassId,
    });
    if (plan.kind === "blocked") return "blocked";
    let cells = s.cells.map((c) => (plan.kind === "move" && plan.ids.includes(c.id) ? { ...c, classId: to } : c));
    if (!cells.some((c) => c.classId === to)) cells = [...cells, row(`new-${to}`, to, "makeup")];
    return { report: { ...s.report, makeupClassId: to, classnoteClassId: to }, cells };
  };
  const ok = (s: State) =>
    expect(makeupInvariantViolations({ report: s.report, cells: s.cells.map((c) => ({ classId: c.classId, status: c.status })), requireAnchor: true })).toEqual([]);
  const empty: State = { report: { makeup: true, classId: null, makeupClassId: null, classnoteClassId: null }, cells: [] };

  it("① 첫 저장(보강 반 B) — 보고서·칸·보낼 반 모두 B", () => {
    const s = changeAnchor(empty, "B");
    expect(s).not.toBe("blocked");
    ok(s as State);
  });
  it("② 반 바꾸기 B→C — 칸이 함께 옮겨 가고 보낼 반도 C(발송 다이얼로그·관리자 고르기·출석부 쪽 이동이 모두 이 문)", () => {
    const b = changeAnchor(empty, "B") as State;
    const c = changeAnchor(b, "C") as State;
    ok(c);
    expect(c.cells.filter((x) => x.classId === "B")).toEqual([]);
  });
  it("③ 앵커 없던 옛 보강(보이지 않는 보강 반의 칸)에 반 지정 — 그 칸이 새 반으로 옮겨 간다(시수 두 번 방지)", () => {
    const legacy: State = { ...empty, cells: [row("p1", "pool", "makeup")] };
    const s = changeAnchor(legacy, "B") as State;
    ok(s);
    expect(s.cells).toHaveLength(1);
  });
  it("🔴 막히는 경우(새 반에 칸이 이미 있음)는 보고서도 칸도 그대로 — 둘이 갈리지 않는다", () => {
    const b = changeAnchor(empty, "B") as State;
    const withC = { ...b, cells: [...b.cells, row("c1", "C", "present")] };
    expect(changeAnchor(withC, "C")).toBe("blocked");
    ok(b);
  });
  it("④ 발송 — 앱이 보낼 반과 워커가 올리는 반이 보강 반과 같다", () => {
    const s = changeAnchor(empty, "B") as State;
    const app = decideSendClass({ candidates: ["C"], makeupClassId: s.report.makeupClassId, makeupLive: true, main: "C" });
    expect(app).toEqual({ kind: "send", classId: "B", via: "makeup" });
    const gate = sendClassGateRow({
      classId: null,
      classLive: false,
      storedId: s.report.classnoteClassId,
      storedLive: true,
      makeupClassId: s.report.makeupClassId,
      makeupLive: true,
      sentAt: null,
    });
    expect(gate.pass).toBe(true);
    const worker = pickRouteClass({
      route: "needs_class",
      classId: null,
      classEligible: false,
      sendClassId: s.report.classnoteClassId,
      makeupClassId: s.report.makeupClassId,
      makeupEligible: true,
    });
    expect(worker.classId).toBe("B");
    expect(makeupSendClassOf(s.report)).toBe("B");
  });
});
