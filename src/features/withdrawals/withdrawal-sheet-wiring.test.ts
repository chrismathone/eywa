import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 수학 퇴원 → 시트 기입(원장 2026-10-07)은 **퇴원이 일어나는 문마다** 불려야 한다 — 한 곳이 빠지면 그 길로 처리한 퇴원만
 * 시트에서 조용히 사라진다. 새 퇴원·수강 종료 경로를 만들면 여기에도 추가할 것.
 */
const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf-8");

describe("수학 퇴원 시트 기입 — 퇴원·수강 종료가 일어나는 문마다", () => {
  it("수강 종료(고른 것 · 한 건) — 학생 퇴원은 퇴원보고서 처리 몫이다(원장 2026-10-23 · 상태 전환 창·수정 폼의 퇴원 갈래는 걷었다)", () => {
    const src = read("features", "students", "server", "actions.ts");
    expect((src.match(/after\(\(\) =>\s*recordMathWithdrawalToSheet\(/g) ?? []).length).toBe(2);
  });
  it("퇴원보고서 처리 — 승인 · 관리자 바로 처리(같은 마무리 함수) · 처리일 cron", () => {
    const actions = read("features", "withdrawal-reports", "server", "actions.ts");
    expect(actions).toContain("await recordMathWithdrawalToSheet(");
    // 바로 처리 — 처리일이 지났으면 같은 요청에서 환불 확인 값과 apply(원장 2026-11-06 · s2_0032) 뒤 같은 마무리 함수.
    expect(actions).toContain('await finish(done.report, "direct", done.extra);');
    expect(read("features", "withdrawal-reports", "server", "scheduled.ts")).toContain("await recordMathWithdrawalToSheet(");
    // 데스크 환불 완료 뒤 처리(원장 2026-11-03 · s2_0025 release) — 수납 환불완료 저장·요청서 삭제·cron 안전망이 같은 마무리를 지난다.
    expect(read("features", "withdrawal-reports", "server", "release.ts")).toContain("await recordMathWithdrawalToSheet(");
    expect(read("features", "billing", "server", "refund-actions.ts")).toContain("await releaseWithdrawalRefunds({ tenantId: gate.user.tenantId, documentId: id, actorId: gate.user.id });");
    expect(read("features", "withdrawal-reports", "server", "scheduled.ts")).toContain("await releaseWithdrawalRefunds({ tenantId: null, documentId: null, actorId: null });");
  });
  it("예약 퇴원 cron", () => {
    expect(read("app", "api", "cron", "apply-due-withdrawals", "route.ts")).toContain("await recordMathWithdrawalToSheet(");
  });
});
