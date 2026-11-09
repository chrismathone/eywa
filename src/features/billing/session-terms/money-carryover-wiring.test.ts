import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AUDIT_ACTIONS } from "@/features/audit/server/log";

// 금액 이월(0278a, 원장 2026-09-21) 배선 가드 — 보내는 달 '−'와 받는 달 '+'가 같은 판정·같은 실납을 지나는지.
const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");
const Q = "src/features/billing/session-terms/server/";

describe("금액 이월 배선", () => {
  it("분배 입력(시수 검증 뷰)은 이월을 반영한 실납을 쓴다 — 분배 저장·교사 합계가 모두 이 뷰를 지난다", () => {
    expect(read(`${Q}verification-queries.ts`)).toMatch(/allocatedAmount:\s*netAllocatedAmount\(r\)/);
  });

  it("회차 확정 실납 칸은 같은 실납을 보이고 이월 표식·버튼을 단다", () => {
    const table = read("src/app/(shell)/billing/_components/session-term-table.tsx");
    expect(table).toContain("netAllocatedAmount(r)");
    expect(table).toContain("<MoneyCarryTags r={r} />");
    expect(table).toContain("<MoneyCarryButton r={r} />");
  });

  it("출석부 금액 열도 같은 이월을 싣는다(보낸·받은 이월을 함께 넘긴다)", () => {
    const server = read("src/features/attendance/server/class-billing.ts");
    // 2026-10-06부터 본체 `attendanceClassBilledDetail`을 부른다(청구액 + 이월 표식을 같은 한 번의 계산에서) — 넘기는 이월은 같다.
    expect(server).toMatch(/attendanceClassBilledDetail\(classes, invoices, terms, carry\)/);
    expect(server).toContain("billed: detail.billed");
    // 🔴 이월 표식도 그 계산이 낸 값만 쓴다 — 표식이 따로 판정하면 '칠해졌는데 금액은 그대로'가 된다.
    expect(server).toMatch(/attendanceCarryMarks\(classes, carry, detail, confirmedPrices\)/);
    expect(server).toContain("loadMoneyCarryOuts(admin");
    expect(server).toContain("loadMoneyCarryIns(admin");
  });

  it("🔴 0278a 컬럼은 본 조회에 섞지 않는다 — 적용 전 배포에서 회차 확정 면·출석부가 죽지 않게([[#95]])", () => {
    const queries = read(`${Q}queries.ts`);
    const mainSelect = queries.match(/\.from\("invoice_session_terms"\)\s*\.select\(\s*"([^"]+)"/)?.[1] ?? "";
    expect(mainSelect).toContain("allocation_amount");
    expect(mainSelect).not.toContain("allocation_carry");
    const attendance = read("src/features/attendance/server/class-billing.ts");
    const attSelect = attendance.match(/\.from\("invoice_session_terms"\)[\s\S]*?\.select\("([^"]+)"\)/)?.[1] ?? "";
    expect(attSelect).toContain("allocation_amount");
    expect(attSelect).not.toContain("allocation_carry");
  });

  it("이월 조회는 fail-soft — 실패해도 throw하지 않고 빈 결과 + failed(0278a 미적용은 failed 아님)", () => {
    const loaders = read(`${Q}money-carryover-queries.ts`);
    for (const fn of ["loadMoneyCarryOuts", "loadMoneyCarryIns", "loadMoneyCarryLanding"]) {
      const body = loaders.slice(loaders.indexOf(`export async function ${fn}`));
      const next = body.indexOf("export async function", 10);
      const own = next > 0 ? body.slice(0, next) : body;
      expect(own).toMatch(/try \{/);
      expect(own).toMatch(/catch \(e\) \{\s*return \{ map: new Map\(\), failed: classify\(e\) \};/);
    }
  });

  it("🔴 분배 저장은 이월 조회 실패·받을 줄 없는 이월이 있으면 거절한다(두 달 스냅샷에 두 번/0번 방지)", () => {
    const splits = read(`${Q}splits-actions.ts`);
    expect(splits).toContain("if (view.carryFailed)");
    expect(splits).toContain("view.carryBlockedStudents?.length");
    const verification = read(`${Q}verification-queries.ts`);
    expect(verification).toContain("carryFailed: view.carryFailed");
    expect(verification).toContain("carryBlocksSplits(r)");
    // 회차 확정 조회가 실패 표식을 뷰에 싣는다.
    expect(read(`${Q}queries.ts`)).toMatch(/const carryFailed = carryOuts\.failed \|\| carryIns\.failed \|\| landing\.failed;/);
  });

  it("배분 창(invoiceId 모드)은 이월을 안 읽는다 — 배분 원본을 편집하는 창이라 실납을 섞으면 항목 합계가 틀어진다", () => {
    expect(read(`${Q}queries.ts`)).toMatch(/const carryPromise = invoiceId\s*\?\s*Promise\.resolve/);
  });

  it("저장·취소는 감사로그를 남기고 한글 라벨이 등록돼 있다", () => {
    const actions = read(`${Q}money-carryover-actions.ts`);
    expect(actions).toContain('"session_term_money_carryover"');
    expect(actions).toContain('"session_term_money_carryover_cancel"');
    expect(actions).toContain("await logAction(");
    const registry = AUDIT_ACTIONS as Record<string, string>;
    expect(registry.session_term_money_carryover).toBeTruthy();
    expect(registry.session_term_money_carryover_cancel).toBeTruthy();
  });

  it("🔴 연쇄 이월(2026-11-09) — 더 받은 몫을 다시 구하는 세 곳이 모두 받은 이월을 붙인 줄로 판정한다(한쪽만 빠지면 돈이 사라진다)", () => {
    const actions = read(`${Q}money-carryover-actions.ts`);
    // 이월 창·저장 = 학생 줄 + 이월 붙이기(화면과 같은 경로). 배분 창 모드 조회는 이월 조회가 실패했을 때의 취소 전용 경로에서만(새 이월은 저장에서 다시 막힌다).
    expect(actions).toContain("loadStudentCarryRows(db, inv.period, inv.student_id)");
    expect(actions.indexOf("getSessionTermsView(inv.period")).toBeGreaterThan(actions.indexOf("if (degraded) {"));
    // 받는 달 = 보내는 줄에 그 줄의 (학생, 반)으로 온 이월을 붙여 `carryOutValid`.
    expect(read(`${Q}money-carryover-queries.ts`)).toMatch(/carryIns: t\.class_id \? prior\.get\(monthRosterKey\(inv\.student_id, t\.class_id\)\)/);
    // 출석부 금액 열 = 이 줄이 받는 이월을 넣고 보낸 이월 유효성을 본다.
    expect(read("src/features/attendance/class-billing.ts")).toContain("carryOutValid({ ...source, carryIns: takesIn ? carry.ins.get(inKey) : undefined }, sent)");
  });

  it("서버 액션이 더 받은 몫·다음 달 반을 다시 구한다(#77) — 화면 값을 믿지 않는다", () => {
    const actions = read(`${Q}money-carryover-actions.ts`);
    expect(actions).toContain("carrySurplus(row)");
    expect(actions).toContain("loadMonthRoster(db, nextPeriod");
    expect(actions).toContain("validateMoneyCarry(");
  });
});
