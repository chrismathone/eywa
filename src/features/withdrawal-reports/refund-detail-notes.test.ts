import { describe, expect, it } from "vitest";
import { approveConfirmText, cancelConfirmText, decisionWaitingOf, detailRefundNotes, nextJudgementText, REFUND_DECISION_SUBMIT_NOTE, REFUND_DECISION_WAIT_PLAIN, type DetailRefundInput } from "./refund-detail-notes";
import { REFUND_DECISION_WAIT_NOTE, refundHoldGap } from "./refund-decision";

/**
 * 리뷰 r2 (b) — 상세 안내 한 벌. 칩·결재란은 DB 표시 · '결정 전'·결정 단추는 지금 계산 · 다르면 사실대로 한 줄 · 결정할 줄이 다른 보고서면 그 보고서로 바로.
 * 시험 축: 1과목 · 2과목(결정 보고서 = 다른 보고서 / 이 보고서) × 두 방향(지금 계산은 결정 전 · DB는 아님 / DB는 대기 · 지금 계산은 없음).
 */
const KEY = "40000000-0000-4000-8000-000000000001#a1";
const base = (over: Partial<DetailRefundInput> = {}): DetailRefundInput => ({
  report: { id: "r1", status: "approved", effective_date: "2026-11-01" }, director: true, approver: false, later: "ok", undecided: [], hold: null,
  holdReport: null, others: "done", deskWaiting: false, hadDesk: false, gap: null, orphanDesk: null, today: "2026-11-09", ...over,
});
const texts = (i: DetailRefundInput) => detailRefundNotes(i).map((n) => `${n.key}:${n.text}${n.href ? ` [${n.linkText} → ${n.href}]` : ""}${n.recheck ? " [지금 다시 판정]" : ""}`);
/** 서버와 같은 순서로 판정 — 지금 계산(undecided) · DB 표시(hold) · 결정 보고서 → gap · 다른 보고서 링크. */
const scenario = (shape: "1과목" | "2과목·결정은 다른 보고서" | "2과목·결정은 이 보고서", dir: "app" | "db", director = true) => {
  const holdReportId = shape === "2과목·결정은 다른 보고서" ? "r2" : "r1";
  const undecided = dir === "app" ? [KEY] : [];
  const state = dir === "app" ? { hold: false, report: null, undecided: 0, checkedAt: "2026-11-08T00:00:00Z" } : { hold: true, report: holdReportId, undecided: 2, checkedAt: "2026-11-08T00:00:00Z" };
  const gap = refundHoldGap({ id: "r1", status: "approved", group_leader: true }, state, undecided);
  return texts(base({ director, undecided, hold: state, gap, others: shape === "1과목" ? "done" : "done",
    holdReport: state.hold && holdReportId !== "r1" ? { id: holdReportId, label: "영어", readable: true } : null }));
};

describe("상세 안내 — 1과목 · 2과목(결정 보고서 = 다른 / 이 보고서) × 두 방향(리뷰 r2 (b))", () => {
  it("🔴 방향 ① 지금 계산은 결정 전 · DB는 대기 아님 → 모든 모양에서 '목록 표시와 다릅니다'(건수 · 다음 판정 때) · 링크 없음", () => {
    for (const shape of ["1과목", "2과목·결정은 다른 보고서", "2과목·결정은 이 보고서"] as const) {
      const got = scenario(shape, "app");
      // 결재란도 말한다(리뷰 r3 R2-m4) · 기술 용어 없이(R2-m1)
      expect(got, shape).toContain("gap:목록 표시와 다릅니다 — 목록·위 칩·결재란의 '환불 결정' 칸은 마지막 판정 기준이라 '환불 결정 대기'가 아니지만, 지금 계산으로는 원장이 정하지 않은 환불 가능 건이 1건 있습니다(다시 결정 필요). 매일 00:05 확인 때 시스템이 다시 확인하고, 그때도 남아 있으면 처리하지 않습니다.");
      expect(got.join("\n"), shape).not.toMatch(/DB/);
      expect(got.some((t) => t.startsWith("elsewhere:")), shape).toBe(false);
    }
  });
  it("🔴 방향 ② DB는 대기 · 지금 계산은 이 보고서에 없음 — 결정 보고서가 다른 보고서면 그 보고서로 바로(링크 · 건수) · 이 보고서면 '목록 표시와 다릅니다' + 원장 '지금 다시 판정'", () => {
    expect(scenario("2과목·결정은 다른 보고서", "db")).toEqual([
      "status:관리자 승인이 끝났습니다. 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음)까지 끝나면 처리합니다.",
      "elsewhere:원장 환불 결정 대기 — 결정할 건 2건은 다른 보고서(영어)에 있습니다. 그 보고서의 '환불 확인'에서 정하세요. [그 보고서 열기 → /withdrawal-reports/r2#refund]",
    ]);
    for (const shape of ["1과목", "2과목·결정은 이 보고서"] as const)
      expect(scenario(shape, "db"), shape).toEqual([
        "status:관리자 승인이 끝났습니다. 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음)까지 끝나면 처리합니다.",
        "gap-pointer:목록 표시와 다릅니다 — 아래 '환불 확인'에 까닭을 적었습니다. [환불 확인으로 가기 → #refund]",
        "gap:목록 표시와 다릅니다 — 목록·위 칩·결재란은 '환불 결정 대기'(마지막 판정 기준)지만, 지금 계산으로는 이 보고서에 정할 환불 가능 건이 없습니다. 매일 00:05 확인 때 시스템이 다시 확인합니다. 지금 다시 판정하려면 아래 단추를 누르세요. [지금 다시 판정]",
      ]);
    // 🔴 리뷰 r3 R2-I1 — 본문·'지금 다시 판정'은 '환불 확인' 칸 안(목록 '내 환불 결정 필요' 링크가 떨어지는 자리) · 위에는 가리키는 한 줄만
    const notes = detailRefundNotes(base({ undecided: [], hold: { hold: true, report: "r1", undecided: 1, checkedAt: null }, gap: "db" }));
    expect(notes.filter((n) => n.place === "refund").map((n) => [n.key, !!n.recheck])).toEqual([["gap", true]]);
    expect(notes.find((n) => n.key === "gap-pointer")).toMatchObject({ href: "#refund", linkText: "환불 확인으로 가기" });
    expect(notes.find((n) => n.key === "gap-pointer")!.place).toBeUndefined();
    // 🔴 1과목에 '함께 요청한 다른 보고서' 같은 거짓 안내가 없다(리뷰 r1 b2 — 막다른 고리)
    expect(scenario("1과목", "db").join("\n")).not.toMatch(/다른 보고서/);
  });
  it("원장이 아닌 사람 — 같은 사실 · '정하세요'·다시 판정 단추 없이 · 결정 대기 안내는 '승인해도' 없이(m4)", () => {
    expect(scenario("2과목·결정은 다른 보고서", "db", false)).toEqual([
      "status:관리자 승인이 끝났습니다. 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음)까지 끝나면 처리합니다.",
      `wait:${REFUND_DECISION_WAIT_PLAIN}`,
      "elsewhere:원장 환불 결정 대기 — 결정할 건 2건은 다른 보고서(영어)에 있습니다. [그 보고서 열기 → /withdrawal-reports/r2#refund]",
    ]);
    expect(scenario("1과목", "db", false).find((t) => t.startsWith("gap:"))).not.toMatch(/단추/);
  });
  it("🔴 지금 계산이 없으면(청구 조회 실패 · 수납 열람권 없음) 결정 위치·어긋남 안내를 띄우지 않는다(I3) · 처리 안내와 대기 안내는 DB 표시대로", () => {
    for (const later of ["failed", "hidden"] as const) {
      const got = texts(base({ later, director: false, hold: { hold: true, report: "r2", undecided: 2, checkedAt: null }, holdReport: { id: "r2", label: "영어", readable: true } }));
      expect(got, later).toEqual([
        "status:관리자 승인이 끝났습니다. 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음)까지 끝나면 처리합니다.",
        `wait:${REFUND_DECISION_WAIT_PLAIN}`,
      ]);
    }
  });
});

describe("처리 안내 — 기다리는 까닭을 모두 · 조사 · 모르면 모른다(m1 · m5 · m6)", () => {
  it("처리 예약 + 결정 대기 → '결정까지'(m1 '결정가' 고침) · 결정+데스크 둘 다 · 대기 없음", () => {
    const sched = (over: Partial<DetailRefundInput>) => texts(base({ report: { id: "r1", status: "scheduled", effective_date: "2026-12-20" }, ...over }))[0];
    expect(sched({ undecided: [KEY] })).toBe("status:승인이 완료되었습니다. 2026-12-20 이후 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음)까지 끝나면 처리하며, 그 전까지는 기존 수강 상태를 유지합니다.");
    expect(sched({ undecided: [KEY], deskWaiting: true })).toBe("status:승인이 완료되었습니다. 2026-12-20 이후 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음) · 데스크 환불 처리(환불 요청서의 환불완료일자)까지 끝나면 처리하며, 그 전까지는 기존 수강 상태를 유지합니다.");
    expect(sched({})).toBe("status:승인이 완료되었습니다. 2026-12-20에 처리하며, 그 전까지는 기존 수강 상태를 유지합니다.");
    expect(texts(base({ report: { id: "r1", status: "scheduled", effective_date: "2026-12-20", direct: true } }))[0]).toBe("status:처리 예약입니다. 2026-12-20에 처리하며, 그 전까지는 기존 수강 상태를 유지합니다.");
  });
  it("승인 완료 — 다른 과목 승인 · 결정 · 데스크를 모두 이어 쓴다(m5) · 대기가 없으면 '처리 확인 대기'(m6) · 형제 조회 실패면 모른다", () => {
    const st = (over: Partial<DetailRefundInput>) => texts(base(over))[0];
    expect(st({ others: "pending", undecided: [KEY], deskWaiting: true })).toBe("status:관리자 승인이 끝났습니다. 함께 요청한 다른 과목 보고서의 승인 · 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음) · 데스크 환불 처리(환불 요청서의 환불완료일자)까지 끝나면 처리합니다.");
    expect(st({ others: "pending" })).toBe("status:관리자 승인이 끝났습니다. 함께 요청한 다른 과목 보고서의 승인까지 끝나면 처리합니다.");
    // 🔴 1과목 · 대기 없음(DB가 확인 값을 '모름'으로 보류) — '다른 강사의 보고서 승인'이라는 거짓 대신
    expect(st({})).toBe("status:관리자 승인이 끝났습니다. 처리 확인 대기 — 다음 확인(매일 00:05) 때 처리합니다.");
    expect(st({ hadDesk: true })).toBe("status:관리자 승인과 데스크 환불이 끝났습니다. 처리 확인 대기 — 다음 확인(매일 00:05) 때 처리합니다.");
    expect(st({ others: "unknown" })).toBe("status:관리자 승인이 끝났습니다. 함께 요청한 다른 과목 보고서의 승인 여부를 확인하지 못했습니다(새로고침). 모두 승인됐으면 매일 00:05 확인 때 처리합니다.");
  });
  it("결정 대기 안내 — 지금 제출·승인할 사람(승인 전 단계)에겐 원장이 정한 글 그대로 · 그 밖엔 '승인해도' 없이(m4) · 원장은 안내 대신 '환불 확인' 칸", () => {
    const wait = (over: Partial<DetailRefundInput>) => detailRefundNotes(base({ director: false, undecided: [KEY], ...over })).find((n) => n.key === "wait")?.text;
    expect(wait({ report: { id: "r1", status: "manager_pending", effective_date: "2026-11-01" }, approver: true })).toBe(REFUND_DECISION_WAIT_NOTE);
    expect(wait({ report: { id: "r1", status: "requested", effective_date: "2026-11-01" }, approver: true })).toBe(REFUND_DECISION_WAIT_NOTE);
    expect(wait({ report: { id: "r1", status: "manager_pending", effective_date: "2026-11-01" }, approver: false })).toBe(REFUND_DECISION_WAIT_PLAIN);
    expect(wait({ report: { id: "r1", status: "approved", effective_date: "2026-11-01" }, approver: true })).toBe(REFUND_DECISION_WAIT_PLAIN);
    expect(wait({ director: true })).toBeUndefined();
    for (const status of ["completed", "canceled", "blocked"] as const) expect(wait({ report: { id: "r1", status, effective_date: "2026-11-01" } }), status).toBeUndefined();
  });
  it("🔴 퇴사한(또는 없는) 데스크의 미완료 요청서 — 할 일 받는 사람이 없다 · 원장이 할 일 · 요청서 링크(m19) · 끝난 보고서엔 없음", () => {
    expect(detailRefundNotes(base({ orphanDesk: { documentId: "d9" } })).find((n) => n.key === "orphan-desk")).toEqual({ key: "orphan-desk", tone: "alert", href: "/billing/refunds/d9", linkText: "요청서 열기",
      text: "데스크 담당자가 퇴사해 이 환불 요청서의 할 일을 받는 사람이 없습니다 — 원장이 환불완료일자를 넣거나, 요청서를 지우고 다시 환불 승인하세요." });
    expect(detailRefundNotes(base({ report: { id: "r1", status: "completed", effective_date: "2026-11-01" }, orphanDesk: { documentId: "d9" } })).some((n) => n.key === "orphan-desk")).toBe(false);
  });
});

describe("다음 DB 판정 때(코드 확인 — 제출·승인 · cron 00:05 apply·release 안전망)", () => {
  it("단계·형제·처리일로", () => {
    for (const s of ["requested", "revision", "manager_pending", "director_pending"]) expect(nextJudgementText(s, "done", "2026-11-01", "2026-11-09"), s).toBe("다음 제출·승인 때");
    expect(nextJudgementText("approved", "pending", "2026-11-01", "2026-11-09")).toBe("다른 과목 보고서의 제출·승인 때");
    expect(nextJudgementText("approved", "unknown", "2026-11-01", "2026-11-09")).toBe("다른 과목 보고서의 승인 때 또는 매일 00:05 확인 때");
    expect(nextJudgementText("approved", "done", "2026-11-01", "2026-11-09")).toBe("매일 00:05 확인 때");
    expect(nextJudgementText("scheduled", "done", "2026-12-20", "2026-11-09")).toBe("처리일(2026-12-20) 00:05 확인 때");
    expect(nextJudgementText("scheduled", "done", "2026-11-09", "2026-11-09")).toBe("매일 00:05 확인 때");
  });
  it("결정 대기 = DB 표시 또는 지금 계산 · 처리 전 단계만", () => {
    expect(decisionWaitingOf("approved", true, [])).toBe(true);
    expect(decisionWaitingOf("approved", false, [KEY])).toBe(true);
    expect(decisionWaitingOf("approved", false, [])).toBe(false);
    for (const s of ["completed", "canceled", "blocked"]) expect(decisionWaitingOf(s, true, [KEY]), s).toBe(false);
  });
});

describe("리뷰 r3 경미 — 작성 강사 '제출해도'(m3) · 형제 모름 + 다른 대기(m5) · 퇴사 데스크 링크(m14) · 조회 실패(m10)", () => {
  it("작성 차례면 '제출해도' · 승인 차례면 '승인해도' · 그 밖은 PLAIN", () => {
    const wait = (over: Partial<DetailRefundInput>) => detailRefundNotes(base({ report: { id: "r1", status: "requested", effective_date: "2026-11-01" }, director: false, undecided: [KEY], ...over })).find((n) => n.key === "wait")?.text;
    expect(wait({ approver: true, author: true })).toBe(REFUND_DECISION_SUBMIT_NOTE);
    expect(wait({ approver: true })).toBe(REFUND_DECISION_WAIT_NOTE);
    expect(wait({ approver: false })).toBe(REFUND_DECISION_WAIT_PLAIN);
  });
  it("🔴 형제 조회 실패 + 결정·데스크 대기 — 대기 까닭 앞에 '확인하지 못했습니다'를 잇는다(목록과 같은 말)", () => {
    const got = texts(base({ others: "unknown", deskWaiting: true, hold: { hold: true, report: "r1", undecided: 1, checkedAt: null }, undecided: [KEY] }));
    expect(got[0]).toBe("status:관리자 승인이 끝났습니다. 함께 요청한 다른 과목 보고서의 승인 여부를 확인하지 못했습니다(새로고침). 원장 환불 결정(퇴원월 뒤 청구의 환불 승인 또는 환불 없음) · 데스크 환불 처리(환불 요청서의 환불완료일자)까지 끝나면 처리합니다.");
  });
  it("퇴사 데스크 — 원장에게만 요청서 링크와 처리 길 · 나머지는 '원장 확인 대기'", () => {
    expect(texts(base({ orphanDesk: { documentId: "d1" } })).find((t) => t.startsWith("orphan-desk:"))).toContain("[요청서 열기 → /billing/refunds/d1]");
    const plain = detailRefundNotes(base({ director: false, orphanDesk: { documentId: "d1" } })).find((n) => n.key === "orphan-desk")!;
    expect(plain).toEqual({ key: "orphan-desk", tone: "plain", text: "데스크 담당자가 퇴사해 이 환불 요청서는 원장 확인 대기입니다." });
  });
  it("🔴 조회 실패를 '없음'으로 접지 않는다 — 무엇을 못 읽었는지 · 결정 기록·대기 표시면 결정 단추를 막았다고 · '처리 확인 대기'라고 단정하지 않는다", () => {
    const got = texts(base({ failed: { decisions: true, steps: true } }));
    expect(got).toEqual([
      "failed:환불 결정 기록 · 데스크 환불 단계를 불러오지 못했습니다(새로고침) — 아래 처리 안내가 맞지 않을 수 있습니다. 환불 결정 단추를 막았습니다.",
      "status:관리자 승인이 끝났습니다. 남은 처리 단계를 확인하지 못했습니다(새로고침).",
    ]);
    expect(texts(base({ failed: { hold: true } }))[0]).toBe("failed:환불 결정 대기 표시를 불러오지 못했습니다(새로고침) — 아래 처리 안내가 맞지 않을 수 있습니다. 환불 결정 단추를 막았습니다.");
    expect(texts(base({ failed: { steps: true } }))[0]).toBe("failed:데스크 환불 단계를 불러오지 못했습니다(새로고침) — 아래 처리 안내가 맞지 않을 수 있습니다.");
    expect(texts(base({ report: { id: "r1", status: "completed", effective_date: "2026-11-01" }, failed: { decisions: true } }))).toEqual([]);
  });
});

describe("확인 칸 글 — 승인(m2) · 요청 취소(m13 · m18)", () => {
  it("🔴 결정 대기면 '처리일이 지났다면 즉시 반영됩니다'를 빼고 한 문장(앞뒤 모순 없음)", () => {
    const t = approveConfirmText({ effectiveDate: "2026-11-01", withdrawal: true, deskWaiting: false, decisionWaiting: true, directorStep: false });
    expect(t).not.toMatch(/즉시 반영/);
    expect(t).toBe("이 보고서를 승인합니다. 함께 요청한 보고서와 모든 승인자의 승인, 원장 환불 결정까지 끝나면 2026-11-01에(지났으면 끝나는 대로) 퇴원을 처리합니다(원장 환불 결정 전에는 처리하지 않습니다).");
    // 리뷰 r3 R2-m6 — 처리일이 미래면 그 날짜 · 지났으면 '바로' · 같은 뜻을 되풀이하지 않는다
    const future = approveConfirmText({ effectiveDate: "2026-12-20", withdrawal: true, deskWaiting: false, decisionWaiting: true, directorStep: false, today: "2026-11-09" });
    expect(future).toBe("이 보고서를 승인합니다. 함께 요청한 보고서와 모든 승인자의 승인, 원장 환불 결정까지 끝나면 2026-12-20에 퇴원을 처리합니다(원장 환불 결정 전에는 처리하지 않습니다).");
    expect(future).not.toContain(REFUND_DECISION_WAIT_NOTE);
    expect(approveConfirmText({ effectiveDate: "2026-11-01", withdrawal: true, deskWaiting: false, decisionWaiting: true, directorStep: false, today: "2026-11-09" })).toContain("끝나면 바로 퇴원을 처리합니다");
    expect(approveConfirmText({ effectiveDate: "2026-11-01", withdrawal: false, deskWaiting: true, decisionWaiting: true, directorStep: false })).toMatch(/원장 환불 결정과 데스크 환불 처리까지 끝나면 .+ 선택 과목 수강종료를 처리합니다/);
    expect(approveConfirmText({ effectiveDate: "2026-11-01", withdrawal: true, deskWaiting: false, decisionWaiting: false, directorStep: false }))
      .toBe("이 보고서를 승인합니다. 함께 요청한 보고서와 모든 승인자의 승인이 끝나면 2026-11-01에 퇴원을 처리합니다. 처리일이 지났다면 즉시 반영됩니다.");
    expect(approveConfirmText({ effectiveDate: "2026-11-01", withdrawal: true, deskWaiting: false, decisionWaiting: false, directorStep: true })).toBe("이 보고서를 승인합니다. 관리자 전원 승인 후 원장 검토로 넘어갑니다.");
  });
  it("🔴 취소 — 이어진 환불 요청서(환불 완료 건수)를 말한다 · 사유가 이력에 남는지는 관문 SQL 적용 여부로", () => {
    expect(cancelConfirmText([], true)).toBe("함께 요청한 모든 강사의 보고서를 취소합니다. 학생의 수강 상태는 유지됩니다. 취소 사유는 처리 이력에 남고 목록에서 확인할 수 있습니다.");
    const step = (completedDate: string | null) => ({ documentId: "d", deskId: "k", deskName: "데스크", completedDate });
    expect(cancelConfirmText([step(null), step("2026-11-08")], true)).toBe("함께 요청한 모든 강사의 보고서를 취소합니다. 학생의 수강 상태는 유지됩니다. 이 요청에 이어진 환불 요청서 2건(환불 완료 1건)은 남습니다 — 환불 전 요청서는 데스크 할 일이 취소되고 데스크 담당자에게 '환불 진행 전 확인' 알림이 갑니다. 환불을 마친 요청서는 처리한 사람에게 '환불 확인 필요' 알림이 갑니다(돌려준 돈은 저절로 되돌려지지 않습니다). 취소 사유는 처리 이력에 남고 목록에서 확인할 수 있습니다.");
    expect(cancelConfirmText([step("2026-11-08")], true)).not.toMatch(/환불 전 요청서/);
    expect(cancelConfirmText([step(null)], true)).not.toMatch(/환불을 마친/);
    expect(cancelConfirmText([], false)).toMatch(/시스템 준비 중이라 취소 사유는 이 화면의 처리 이력에 남지 않습니다\.$/);
  });
});
