import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportStatusChips, reportStatusLabel, type ReportListRow } from "./model";
import { buildListItems } from "./list-items";
import {
  buildRefundCheck, canEditLinkedCompletion, decisionBlocksProcessing, declinedKeys, lineRefundable, linkedCompletionLock, reapprovable, refundableKeys, undecidedKeys,
  REFUND_DECISION_CHIP, REFUND_DECISION_WAIT_NOTE, DESK_NOT_DESIGNATED, unpickedNotice,
} from "./refund-decision";

/**
 * 원장 환불 결정(원장 2026-11-06 · DB s2_0032) — 순수 판정. DB `withdrawal_report_refund_note`와 같은 규칙:
 * 결정 안 됨 = 환불 가능 줄 중 '환불하지 않음'도, 아직 남은 요청서의 '환불'도 없는 줄. 결정 뒤 새로 생긴 줄 · 요청서가 지워진 줄은 다시 결정 안 됨.
 */
const INV = "40000000-0000-4000-8000-000000000001";
const k = (s: string) => `${INV}#${s}`;
const l = (key: string, patch: Partial<{ paidNet: number; billingRefund: boolean; refund: unknown }> = {}) => ({ key, paidNet: 1000, billingRefund: false, refund: null, ...patch });
const inv = (lines: ReturnType<typeof l>[], status = "paid") => ({ status, lines });

describe("환불 가능 줄 · 확인 값", () => {
  it("낸 돈 있음 · 환불된 청구 아님 · 수납 환불 기록 없음 · 남은 요청서 없음일 때만", () => {
    expect(lineRefundable({ status: "paid" }, l(k("a")))).toBe(true);
    expect(lineRefundable({ status: "paid" }, l(k("a"), { paidNet: 0 }))).toBe(false);
    expect(lineRefundable({ status: "refunded" }, l(k("a")))).toBe(false);
    expect(lineRefundable({ status: "paid" }, l(k("a"), { billingRefund: true }))).toBe(false);
    expect(lineRefundable({ status: "paid" }, l(k("a"), { refund: { documentId: "d" } }))).toBe(false);
  });
  it("한 화면의 환불 가능 줄 키 — 보이는 차례 · 겹침 없음", () => {
    expect(refundableKeys([inv([l(k("a")), l(k("b"), { paidNet: 0 })]), inv([l(k("c")), l(k("a"))])])).toEqual([k("a"), k("c")]);
  });
  it("묶음 확인 값 — 보고서마다 · 같은 줄은 먼저 본(대표) 보고서 몫", () => {
    expect(buildRefundCheck([
      { reportId: "R1", later: [inv([l(k("a")), l(k("b"))])] },
      { reportId: "R2", later: [inv([l(k("b")), l(k("c"))])] },
    ])).toEqual({ refundable: [{ key: k("a"), report: "R1" }, { key: k("b"), report: "R1" }, { key: k("c"), report: "R2" }] });
    expect(buildRefundCheck([{ reportId: "R1", later: [] }])).toEqual({ refundable: [] });
  });
});

describe("결정 안 된 줄(DB와 같은 규칙)", () => {
  const keys = [k("a"), k("b"), k("c"), k("d")];
  const decisions = new Map([
    [k("a"), { decision: "none" as const, live: false }],      // 환불하지 않음
    [k("b"), { decision: "refund" as const, live: true }],     // 요청서가 남아 있음(보통은 환불 가능 줄이 아니다 — 늦게 읽힌 확인 값 대비)
    [k("c"), { decision: "refund" as const, live: false }],    // 요청서를 지움 → 다시 결정 안 됨
  ]);
  it("'환불하지 않음' · 남은 요청서의 '환불'은 결정됨 · 지운 요청서 줄과 새 줄은 결정 안 됨", () => {
    expect(undecidedKeys(keys, decisions)).toEqual([k("c"), k("d")]);
    expect(declinedKeys(keys, decisions)).toEqual([k("a")]);
  });
  it("결정이 없으면 전부 결정 안 됨 · 줄이 없으면 결정할 것 없음", () => {
    expect(undecidedKeys(keys, new Map())).toEqual(keys);
    expect(undecidedKeys([], decisions)).toEqual([]);
  });
  it("처리를 막는 단계 — 처리 완료·취소·재검토 밖", () => {
    for (const s of ["requested", "revision", "manager_pending", "director_pending", "approved", "scheduled"]) expect(decisionBlocksProcessing(s)).toBe(true);
    for (const s of ["completed", "canceled", "blocked"]) expect(decisionBlocksProcessing(s)).toBe(false);
  });
});

describe("상태 칩 '환불 결정 대기'(기존 reportStatusChips에 더함)", () => {
  const waiting = [{ documentId: "d", deskId: null, deskName: "데스크", completedDate: null }];
  const done = [{ ...waiting[0]!, completedDate: "2026-11-06" }];
  it("원래 단계 바로 뒤 · 데스크 단계보다 앞", () => {
    expect(reportStatusChips({ status: "manager_pending" }, [], true)).toEqual(["관리자 요청", REFUND_DECISION_CHIP]); // 원장 2026-11-06 '관리자 승인 요청' → '관리자 요청'(main)
    expect(reportStatusChips({ status: "approved" }, [], true)).toEqual(["관리자 승인 완료", "환불 결정 대기"]);
    expect(reportStatusChips({ status: "scheduled" }, [], true)).toEqual(["처리 예약", "환불 결정 대기"]);
    expect(reportStatusChips({ status: "approved" }, waiting, true)).toEqual(["관리자 승인 완료", "환불 결정 대기", "데스크 환불 요청"]);
    expect(reportStatusChips({ status: "approved" }, done, true)).toEqual(["관리자 승인 완료", "환불 결정 대기", "데스크 환불 완료"]);
    expect(reportStatusLabel({ status: "requested" }, [], true)).toBe("작성 요청 · 환불 결정 대기");
  });
  it("처리 완료·취소·재검토엔 붙이지 않는다 · 대기가 아니면 종전 그대로", () => {
    for (const status of ["completed", "canceled", "blocked"] as const) expect(reportStatusChips({ status }, [], true)).not.toContain("환불 결정 대기");
    expect(reportStatusChips({ status: "approved" })).toEqual(["승인 완료 · 다른 보고서 대기"]);
    expect(reportStatusChips({ status: "approved" }, waiting)).toEqual(["관리자 승인 완료", "데스크 환불 요청"]);
  });
});

describe("이어진 요청서의 환불완료일자 권한 — 그 데스크 담당과 원장급만", () => {
  it("이어지지 않은 요청서는 종전대로(수납 쓰기 권한이면)", () => {
    expect(canEditLinkedCompletion(null, { id: "x", directorLevel: false })).toBe(true);
  });
  it("담당 데스크 · 원장급은 된다 · 그 밖은 안 된다 · 담당이 비면 원장급만", () => {
    expect(canEditLinkedCompletion({ deskId: "desk" }, { id: "desk", directorLevel: false })).toBe(true);
    expect(canEditLinkedCompletion({ deskId: "desk" }, { id: "boss", directorLevel: true })).toBe(true);
    expect(canEditLinkedCompletion({ deskId: "desk" }, { id: "acct", directorLevel: false })).toBe(false);
    expect(canEditLinkedCompletion({ deskId: null }, { id: "acct", directorLevel: false })).toBe(false);
    expect(canEditLinkedCompletion({ deskId: null }, { id: "boss", directorLevel: true })).toBe(true);
  });
  it("화면 문구는 원장 결정(2026-11-06) 글자 그대로", () => {
    expect(REFUND_DECISION_WAIT_NOTE).toBe("원장 환불 결정 전 — 승인해도 환불 결정 뒤에 처리됩니다");
    expect(DESK_NOT_DESIGNATED).toBe("학원 설정에서 데스크 담당자를 먼저 지정해 주세요");
    expect(unpickedNotice(2)).toBe("고르지 않은 2건은 환불하지 않음으로 기록됩니다");
  });
});

describe("목록 — 상태 글 · '내 환불 결정 필요'(원장급 · 결정할 줄을 보이는 보고서 줄만)", () => {
  const row = (id: string, patch: Partial<ReportListRow> = {}): ReportListRow => ({
    id, tenant_id: "t1", student_id: "s1", requested_by: "req", teacher_id: "teacher", manager_id: "mgr", director_id: null, manager_ids: ["mgr"], director_ids: [],
    group_id: "G1", group_leader: id === "R1", exit_kind: "withdrawal", subjects: ["math"], effective_date: "2026-11-01", request_note: "", snapshot: { name: "학생", school: null, grade: null, enrolledAt: null, status: "enrolled", withdrawnAt: null, courses: [] },
    status: "approved", revision: 1, manager_approved_at: null, director_approved_at: null, applied_at: null, last_comment: null, created_at: "2026-11-01T00:00:00Z", updated_at: "", ...patch,
  } as ReportListRow);
  const build = (directorLevel: boolean, holds: Map<string, string | null>) => buildListItems({ reports: [row("R1"), row("R2", { teacher_id: "t2" })], archives: [], staff: [], labelOf: (s) => s, userId: "boss", writable: true, holds, directorLevel });
  it("대기 묶음의 보고서마다 상태 글(검색) · 환불 단계 decision · 원장은 결정할 줄을 보이는 보고서에서만 '내 환불 결정 필요'", () => {
    const items = build(true, new Map([["G1", "R2"]]));
    expect(items.map((i) => i.statusLabel)).toEqual(["관리자 승인 완료 · 환불 결정 대기", "관리자 승인 완료 · 환불 결정 대기"]);
    expect(items.map((i) => i.refundStage)).toEqual(["decision", "decision"]);
    expect(items.map((i) => [i.mine, !!i.refundTurn])).toEqual([["view", false], ["approve", true]]);
  });
  it("결정할 보고서를 모르면 대표 보고서 · 원장급이 아니면 차례 없음 · 대기가 없으면 종전 상태 글", () => {
    expect(build(true, new Map([["G1", null]])).map((i) => !!i.refundTurn)).toEqual([true, false]);
    expect(build(false, new Map([["G1", "R1"]])).some((i) => i.refundTurn)).toBe(false);
    expect(build(true, new Map()).map((i) => i.statusLabel)).toEqual(["승인 완료 · 다른 보고서 대기", "승인 완료 · 다른 보고서 대기"]);
    expect(build(true, new Map()).map((i) => i.refundStage)).toEqual([null, null]);
  });
});

describe("강사뷰 완료일자 — 화면 행위자와 실제 로그인 계정 둘 다(팀장 결정 2026-11-06 · DB 트리거 = 실제 계정)", () => {
  const link = { deskId: "desk", deskName: "데스크" };
  const who = (id: string, directorLevel = false) => ({ id, directorLevel });
  it("둘 다 담당 데스크·원장급이면 연다 · 이어지지 않은 요청서는 종전대로", () => {
    expect(linkedCompletionLock(link, who("desk"), who("desk"))).toBeNull();
    expect(linkedCompletionLock(link, who("desk"), who("boss", true))).toBeNull(); // 원장이 강사뷰로 데스크 화면
    expect(linkedCompletionLock(null, who("x"), who("y"))).toBeNull();
  });
  it("🔴 행위자가 데스크여도 실제 계정이 아니면 잠그고 사유 · 행위자가 아니면 종전 사유", () => {
    expect(linkedCompletionLock(link, who("desk"), who("office"))).toBe("'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서의 환불완료일자는 실제 로그인한 계정이 담당 데스크(데스크)이거나 원장일 때만 넣거나 지울 수 있습니다.");
    expect(linkedCompletionLock(link, who("acct"), who("boss", true))).toContain("담당 데스크(데스크)와 원장만");
  });
  it("수납 화면은 실제 계정(user)을 함께 넘긴다 — 저장 액션과 같은 함수", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(shell)/billing/refunds/[id]/page.tsx"), "utf8");
    expect(page).toContain("linkedCompletionLock(link, { id: actor.id, directorLevel: actor.systemRole === \"master\" && !(await viewAsTeacher()) }, { id: user.id, directorLevel: user.systemRole === \"master\" })");
    const action = readFileSync(join(process.cwd(), "src/features/billing/server/refund-actions.ts"), "utf8");
    expect(action).toContain("const account = (await getCurrentUser()) ?? user;");
  });
});

describe("다른 묶음의 요청서가 담은 줄 — 다시 고를 수 있나(팀장 결정 2026-11-06)", () => {
  it("취소된 요청의 환불 전 요청서만 · 완료했거나 진행 중인 다른 요청이면 고를 수 없다(결정은 환불하지 않음으로)", () => {
    expect(reapprovable({})).toBe(true);
    expect(reapprovable({ otherRefund: { canceled: true, completed: false } })).toBe(true);
    expect(reapprovable({ otherRefund: { canceled: true, completed: true } })).toBe(false);
    expect(reapprovable({ otherRefund: { canceled: false, completed: false } })).toBe(false);
    // 그래도 그 줄은 이 묶음에서 결정 안 됨이다(확인 값에 든다)
    expect(lineRefundable({ status: "paid" }, { paidNet: 1000, billingRefund: false, refund: null })).toBe(true);
  });
});
