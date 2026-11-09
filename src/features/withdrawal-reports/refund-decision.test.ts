import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reportStatusChips, reportStatusLabel, type ReportListRow } from "./model";
import { buildListItems } from "./list-items";
import {
  approvable, buildRefundCheck, canEditLinkedCompletion, decisionTargets, lineDeductions, openClaims, refundDeduction, decisionBlocksProcessing, declinedKeys, lineRefundable, linkedCompletionLock, reapprovable, refundableKeys, refundHoldGap, undecidedKeys,
  REFUND_DECISION_CHIP, REFUND_DECISION_WAIT_NOTE, DESK_NOT_DESIGNATED, unpickedNotice,
} from "./refund-decision";

/**
 * 원장 환불 결정(원장 2026-11-06 · DB s2_0036) — 순수 판정. DB `withdrawal_report_refund_note`와 같은 규칙:
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
  it("묶음 확인 값 — 보고서마다 · 같은 줄은 먼저 본(대표) 보고서 몫 · 낸 돈 · 이 묶음 요청서가 잡은 줄(claimed) · asOf · scope", () => {
    const meta = { asOf: "2026-11-06T01:02:03.456789+00:00", scope: "withdrawal" as const };
    expect(buildRefundCheck([
      { reportId: "R1", later: [inv([l(k("a")), l(k("b"), { paidNet: 7000 }), l(k("d"), { refund: { documentId: "doc1" } })])] },
      { reportId: "R2", later: [inv([l(k("b")), l(k("c")), l(k("d"), { refund: { documentId: "doc1" } }), l(k("e"), { paidNet: 0 })])] },
    ], meta)).toEqual({
      refundable: [{ key: k("a"), report: "R1", paid: 1000 }, { key: k("b"), report: "R1", paid: 7000 }, { key: k("c"), report: "R2", paid: 1000 }],
      // 잡힌 줄 = 요청서 · 지금 낸 돈(결정 뒤 늘면 다시 묻는다 — 리뷰 r2 D-4) · 그 줄을 보이는 보고서(결정 대기 링크). 낸 돈이 없는 줄(e)은 잡힌 줄도 아니다.
      claimed: [{ key: k("d"), doc: "doc1", paid: 1000, report: "R1" }],
      asOf: meta.asOf, scope: "withdrawal",
    });
    expect(buildRefundCheck([{ reportId: "R1", later: [] }], { asOf: null, scope: "subject_end" })).toEqual({ refundable: [], claimed: [], asOf: null, scope: "subject_end" });
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
  it("결정 뒤 그 줄의 낸 돈이 늘면 다시 결정 안 됨(리뷰 #12 · DB paid_net) · 줄거나 같으면 그대로 · 결정 때 값을 모르면 그대로", () => {
    const ds = new Map([[k("a"), { decision: "none" as const, live: false, paidNet: 1000 }], [k("b"), { decision: "none" as const, live: false, paidNet: null }]]);
    expect(undecidedKeys([k("a"), k("b")], ds, new Map([[k("a"), 1500], [k("b"), 9999]]))).toEqual([k("a")]);
    expect(undecidedKeys([k("a")], ds, new Map([[k("a"), 1000]]))).toEqual([]);
    expect(undecidedKeys([k("a")], ds, new Map([[k("a"), 800]]))).toEqual([]);
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
    // 리뷰 r3 R2-m2 — 형제 승인을 알면: 승인 전 형제 있음 = 종전 · 없음(1과목 포함) = '처리 확인 대기' · 모름 = '확인 못 함'
    expect(reportStatusChips({ status: "approved" }, [], false, "pending")).toEqual(["승인 완료 · 다른 보고서 대기"]);
    expect(reportStatusChips({ status: "approved" }, [], false, "done")).toEqual(["관리자 승인 완료", "처리 확인 대기"]);
    expect(reportStatusChips({ status: "approved" }, [], false, "unknown")).toEqual(["관리자 승인 완료", "다른 과목 승인 확인 못 함"]);
    expect(reportStatusChips({ status: "approved" }, [], false, "failed")).toEqual(["관리자 승인 완료", "환불 단계 확인 못 함"]);   // 상세 — 결정 대기·데스크 단계를 못 읽음
    expect(reportStatusChips({ status: "approved" }, [], true, "done")).toEqual(["관리자 승인 완료", "환불 결정 대기"]);
    expect(reportStatusChips({ status: "scheduled" }, [], false, "done")).toEqual(["처리 예약"]);
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
    // 형제 상태를 모르면(묶음 상태 조회 없음 · 보이는 형제는 모두 승인) '다른 보고서 대기'라고 단정하지 않는다(리뷰 r3 R2-m2 · 아래 진행 줄과 같은 말)
    expect(build(true, new Map()).map((i) => i.statusLabel)).toEqual(["관리자 승인 완료 · 다른 과목 승인 확인 못 함", "관리자 승인 완료 · 다른 과목 승인 확인 못 함"]);
    expect(build(true, new Map()).map((i) => i.refundStage)).toEqual([null, null]);
  });
  it("형제 모두 승인(묶음 상태를 읽음) — '처리 확인 대기' · 환불 단계 조회 실패면 '환불 단계 확인 못 함'(리뷰 r3 R2-m2·R2-m10)", () => {
    const seen = new Map([["G1", [{ id: "R1", status: "approved" as const }, { id: "R2", status: "approved" as const }]]]);
    const base = { reports: [row("R1"), row("R2", { teacher_id: "t2" })], archives: [], staff: [], labelOf: (s: string) => s, userId: "boss", writable: true, holds: new Map<string, string | null>(), groupStatuses: seen };
    expect(buildListItems(base).map((i) => i.statusLabel)).toEqual(["관리자 승인 완료 · 처리 확인 대기", "관리자 승인 완료 · 처리 확인 대기"]);
    expect(buildListItems({ ...base, refundsFailed: true }).map((i) => i.statusLabel)).toEqual(["관리자 승인 완료 · 환불 단계 확인 못 함", "관리자 승인 완료 · 환불 단계 확인 못 함"]);
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
  it("🔴 원장 결정 C.3 — 같은 청구 줄에 새 요청서가 있는 옛 요청서(취소된 요청)는 누구도 못 넣는다(DB 트리거와 같은 문구)", () => {
    expect(linkedCompletionLock({ ...link, superseded: true }, who("desk"), who("boss", true))).toBe("같은 청구에 새 퇴원 요청의 요청서가 있습니다 — 새 요청서로 처리하세요.");
    expect(linkedCompletionLock({ ...link, superseded: false }, who("desk"), who("desk"))).toBeNull();
  });
  it("🔴 행위자가 데스크여도 실제 계정이 아니면 잠그고 사유 · 행위자가 아니면 종전 사유", () => {
    expect(linkedCompletionLock(link, who("desk"), who("office"))).toBe("'다른 강사 뷰'로 보고 있습니다. 퇴원보고서에서 이어진 환불 요청서의 환불완료일자는 실제 로그인한 계정이 담당 데스크(데스크)이거나 원장일 때만 넣을 수 있고, 비우는 것은 원장만 할 수 있습니다.");
    // 원장이 '다른 강사 뷰'로 담당 아닌 사람 화면을 보면 — 왜 막혔는지 그 사실을(리뷰 r3 R2-m7 · 종전엔 일반 문구)
    expect(linkedCompletionLock(link, who("acct"), who("boss", true))).toContain("'다른 강사 뷰'로 보고 있습니다 — 환불완료일자 입력은 본인 화면에서만");
    expect(linkedCompletionLock(link, who("acct"), who("acct"))).toContain("담당 데스크(데스크)와 원장만 넣을 수 있고, 비우는 것은 원장만");
  });
  it("수납 화면은 실제 계정(user)을 함께 넘긴다 — 저장 액션과 같은 함수", () => {
    const page = readFileSync(join(process.cwd(), "src/app/(shell)/billing/refunds/[id]/page.tsx"), "utf8");
    expect(page).toContain("const who = { id: actor.id, directorLevel: actor.systemRole === \"master\" && !(await viewAsTeacher()) };");
    expect(page).toContain("const account = { id: user.id, directorLevel: user.systemRole === \"master\" };");
    // 완료일자 · 고치기 · 지우기 잠금이 모두 같은 두 사람(화면 행위자 · 실제 계정)으로(리뷰 r2 I6·B1)
    expect(page).toContain("linkedCompletionLock(link, who, account)");
    expect(page).toContain("linkedEditLock(link, who, account)");
    expect(page).toMatch(/linkedDeleteLock\(link, .+?, who, account\)/);
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
  it("🔴 이 묶음 요청서가 잡은 줄도 다시 정할 때가 있다(리뷰 r2 D-2·D-4) — 표식에 정확히 없음(결정 행 없음) · 결정 뒤 낸 돈 증가('환불' 결정도)", () => {
    const R = (documentId: string, exact: boolean) => ({ documentId, deskName: null, completed: false, exact });
    const later = [{ status: "paid", lines: [
      { key: "i#a", paidNet: 1000, billingRefund: false, refund: R("D1", true) },     // 정확히 담음 · 결정 행 있음 · 그대로
      { key: "i#b", paidNet: 2000, billingRefund: false, refund: R("D1", false) },    // 형제·낡은 표식으로 넓혀 담음 · 결정 행 없음 → 다시
      { key: "i#c", paidNet: 3000, billingRefund: false, refund: R("D1", true) },     // '환불' 결정 뒤 낸 돈 증가 → 다시
      { key: "i#d", paidNet: 4000, billingRefund: false, refund: R("D1", true) },     // 정확히 담음 · 결정 행 없음(옛 연결) → 그대로
      { key: "i#e", paidNet: 500, billingRefund: false, refund: null },               // 환불 가능 줄
    ] }];
    const decisions = new Map([
      ["i#a", { decision: "refund" as const, live: true, paidNet: 1000, paidSeen: 1000, documentId: "D1" }],
      ["i#c", { decision: "refund" as const, live: true, paidNet: 2500, paidSeen: null, documentId: "D1" }],
    ]);
    expect(openClaims(later, decisions)).toEqual([
      { key: "i#b", reason: "inexact", before: null, now: 2000, documentId: "D1", separable: false },
      { key: "i#c", reason: "increase", before: 2500, now: 3000, documentId: "D1", separable: false },   // 요청서가 환불 전 — 따로 환불 아님
    ]);
    // 본 낸 돈(paid_seen)이 있으면 그것으로 본다 — 다시 정한 뒤(본 낸 돈 = 지금)엔 열리지 않는다
    expect(openClaims(later, new Map([...decisions, ["i#c", { decision: "refund" as const, live: true, paidNet: 2500, paidSeen: 3000, documentId: "D1" }]]))).toEqual([
      { key: "i#b", reason: "inexact", before: null, now: 2000, documentId: "D1", separable: false },
    ]);
    // 🔴 원장 결정 2026-11-09 — 환불을 마친 이 요청서의 '환불' 줄에 그 뒤 낸 돈이 늘면 '따로 환불'을 고를 수 있다(DB decide p_separate와 같은 조건)
    const done = [{ status: "paid", lines: [{ key: "i#c", paidNet: 3000, billingRefund: false, refund: { ...R("D1", true), completed: true } }] }];
    expect(openClaims(done, decisions)).toEqual([{ key: "i#c", reason: "increase", before: 2500, now: 3000, documentId: "D1", separable: true }]);
    // 결정 행이 다른 요청서를 가리키면(대체 등) 아니다 · '환불하지 않음' 결정도 아니다
    expect(openClaims(done, new Map([["i#c", { decision: "refund" as const, live: true, paidNet: 2500, paidSeen: 2500, documentId: "D2" }]]))[0]!.separable).toBe(false);
    expect(openClaims(done, new Map([["i#c", { decision: "none" as const, live: false, paidNet: 2500, paidSeen: 2500, documentId: "D1" }]]))[0]!.separable).toBe(false);
    // 원장이 지금 정할 줄 = 환불 가능 줄 + 다시 정할 줄(서버 대조·'환불 없음'·고르지 않은 줄이 같은 값)
    expect(decisionTargets(later, decisions)).toEqual(["i#e", "i#b", "i#c"]);
  });
  it("🔴 다시 승인할 때 빼는 몫 = 따로 환불한 금액 + 환불 완료 기록(DB attach 상한과 같은 식 · 리뷰 r3 R2-I2 · 함정 ⅰ)", () => {
    expect(refundDeduction(undefined)).toBe(0);
    expect(refundDeduction({ decision: "refund", live: false })).toBe(0);
    expect(refundDeduction({ decision: "refund", live: false, refundedTotal: 315000, separateAmount: 50000 })).toBe(365000);
    expect(refundDeduction({ decision: "refund", live: false, refundedTotal: -1, separateAmount: null })).toBe(0);
    const later = [{ status: "paid", lines: [
      { key: "i#a", paidNet: 365000, billingRefund: false, refund: null },
      { key: "i#b", paidNet: 1000, billingRefund: false, refund: null },
    ] }];
    expect(lineDeductions(later, new Map([
      ["i#a", { decision: "refund" as const, live: false, refundedTotal: 315000, separateAmount: 50000, separateAt: "2026-11-09T01:00:00Z", separateBy: "boss" }],
      ["i#b", { decision: "none" as const, live: false }],
    ]))).toEqual([{ key: "i#a", refunded: 315000, separate: 50000, separateAt: "2026-11-09T01:00:00Z", separateBy: "boss" }]);
  });
  it("🔴 금액 모름 미배분 줄(과목 몫을 셀 수 없음 · 리뷰 r2 I5) — 결정 대상(확인 값에 든다)이지만 환불 승인은 못 고른다(환불하지 않음만)", () => {
    const line = { paidNet: 300000, billingRefund: false, refund: null, amountUnknown: true };
    expect(lineRefundable({ status: "paid" }, line)).toBe(true);
    expect(approvable({ status: "paid" }, line)).toBe(false);
    expect(approvable({ status: "paid" }, { ...line, amountUnknown: false })).toBe(true);
    expect(approvable({ status: "paid" }, { ...line, otherRefund: { canceled: false, completed: false } })).toBe(false);
  });
});

describe("목록 표시(DB refund_hold)와 상세의 지금 계산이 어긋나면 한 줄(리뷰 r2 (b) · refundHoldGap)", () => {
  const me = { id: "r1", status: "approved", group_leader: true };
  const key = "40000000-0000-4000-8000-000000000001#a1";
  const judged = "2026-11-08T03:00:00Z";
  it("🔴 방향 ① 지금 계산은 결정 전인데 DB는 대기 아님 → 'app'(DB가 판정했어야 할 때만)", () => {
    expect(refundHoldGap(me, { hold: false, report: null, undecided: 0, checkedAt: judged }, [key])).toBe("app");
    // 판정 시각이 없어도 이 보고서가 제출됐으면(승인 대기·승인 완료·처리 예약) DB가 판정했어야 한다 — 그 판정이 확인 값 없음·낡음으로 보류됐어도 목록엔 대기가 없다.
    for (const status of ["manager_pending", "director_pending", "approved", "scheduled"])
      expect(refundHoldGap({ ...me, status }, { hold: false, report: null, undecided: 0, checkedAt: null }, [key]), status).toBe("app");
    // 제출 전 작성 중이고 판정한 적 없음 → 아직 판정 전(목록은 판정 뒤에 대기를 보인다) — 어긋남이 아니다
    for (const status of ["requested", "revision"]) {
      expect(refundHoldGap({ ...me, status }, { hold: false, report: null, undecided: 0, checkedAt: null }, [key]), status).toBeNull();
      // 다른 과목 보고서가 제출돼 판정한 적이 있으면 작성 중이어도 어긋남이다
      expect(refundHoldGap({ ...me, status }, { hold: false, report: null, undecided: 0, checkedAt: judged }, [key]), status).toBe("app");
    }
    // 결정 전인 줄이 없으면 둘 다 대기 아님 — 같다
    expect(refundHoldGap(me, { hold: false, report: null, undecided: 0, checkedAt: judged }, [])).toBeNull();
  });
  it("🔴 방향 ② DB는 대기인데 지금 계산은 이 보고서에 정할 건 없음 → 'db'(결정 보고서가 이 보고서일 때만)", () => {
    expect(refundHoldGap(me, { hold: true, report: "r1", undecided: 1, checkedAt: judged }, [])).toBe("db");
    // 결정 보고서를 모르면(옛 표시) 대표 보고서가 맡는다
    expect(refundHoldGap(me, { hold: true, report: null, undecided: 1, checkedAt: judged }, [])).toBe("db");
    expect(refundHoldGap({ ...me, group_leader: false }, { hold: true, report: null, undecided: 1, checkedAt: judged }, [])).toBeNull();
    // 결정 보고서가 다른 보고서 → 어긋남 아님(원장에겐 '함께 요청한 다른 보고서' 안내)
    expect(refundHoldGap(me, { hold: true, report: "r2", undecided: 1, checkedAt: judged }, [])).toBeNull();
    // 이 화면에도 결정 전인 줄이 있으면 같다
    expect(refundHoldGap(me, { hold: true, report: "r1", undecided: 1, checkedAt: judged }, [key])).toBeNull();
    expect(refundHoldGap(me, { hold: true, report: "r2", undecided: 1, checkedAt: judged }, [key])).toBeNull();
  });
  it("모르면 말하지 않는다 — DB 표시를 못 읽음 · 지금 계산을 못 함 · 처리 전 단계가 아님", () => {
    expect(refundHoldGap(me, null, [key])).toBeNull();
    expect(refundHoldGap(me, { hold: false, report: null, undecided: 0, checkedAt: judged }, [key], false)).toBeNull();
    expect(refundHoldGap(me, { hold: true, report: "r1", undecided: 1, checkedAt: judged }, [], false)).toBeNull();
    for (const status of ["completed", "canceled", "blocked"]) {
      expect(refundHoldGap({ ...me, status }, { hold: false, report: null, undecided: 0, checkedAt: judged }, [key]), status).toBeNull();
      expect(refundHoldGap({ ...me, status }, { hold: true, report: "r1", undecided: 1, checkedAt: judged }, []), status).toBeNull();
    }
  });
});
