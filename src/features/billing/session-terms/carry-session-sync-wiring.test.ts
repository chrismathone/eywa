import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 금액 이월 → 확정 시수 자동 반영(원장 2026-10-07) — 계기(이월 저장 · 확정 셋 · 배분 저장)마다 같은 함수를 부르는지 잠근다.
// 한 계기라도 빠지면 그 경로로 들어온 이월만 사람이 '해제 → 시수 고침 → 다시 확정'해야 한다(조용한 누락).
const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), "src", ...p), "utf8");
const server = (file: string) => read("features", "billing", "session-terms", "server", file);

describe("금액 이월 → 확정 시수 자동 반영 — 배선", () => {
  it("확정 셋(단건 · 반 일괄 · 선택 일괄)은 배분 자동 재확정 **뒤에** 부르고, 응답의 행 값을 고친 값으로 싣는다", () => {
    const actions = server("actions.ts");
    for (const trigger of ["confirm", "confirm_class"]) {
      const realloc = actions.indexOf(`autoReallocateAfterConfirm(supabase, ${trigger === "confirm" ? "[id]" : "terms.map((t) => t.id)"}, "${trigger}")`);
      expect(realloc, trigger).toBeGreaterThan(-1);
      const window = actions.slice(realloc, realloc + 700);
      expect(window, trigger).toContain(`syncCarrySessionsAfter(supabase, { termIds: ${trigger === "confirm" ? "[id]" : "terms.map((t) => t.id)"} }, user.id, "${trigger}")`);
      expect(window, trigger).toContain("applyCarrySync(");
    }
    expect(actions).toContain("terms: synced");
    const selected = server("selected-confirm-actions.ts");
    const at = selected.indexOf(`autoReallocateAfterConfirm(supabase, terms.map((t) => t.id), "confirm_selected")`);
    expect(at).toBeGreaterThan(-1);
    expect(selected.slice(at, at + 400)).toContain(`patched = applyCarrySync(terms, await syncCarrySessionsAfter(supabase, { termIds: terms.map((t) => t.id) }, user.id, "confirm_selected"))`);
    expect(selected).toContain("terms: patched");
  });

  it("이월 저장·취소는 저장 **뒤에** 받는 달 줄을 본다 — 옛 이월(반·금액)과 새 이월을 넘겨, 올릴 줄은 올리고 덜 받게 된 줄은 알린다", () => {
    const carry = server("money-carryover-actions.ts");
    const rpc = carry.indexOf(`db.rpc("save_session_term_money_carryover"`);
    const sync = carry.indexOf("syncCarrySessionsAfterCarry(db, {");
    expect(rpc).toBeGreaterThan(-1);
    expect(sync).toBeGreaterThan(rpc);
    const call = carry.slice(sync, sync + 400);
    expect(call).toContain("period: c.nextPeriod, studentId: c.studentId");
    expect(call).toContain("previous: c.current ? { classId: c.current.toClassId, amount: c.current.amount } : null");
    expect(call).toContain("next: amount > 0 ? { classId: input.classId, amount } : null");
    expect(carry).toContain("carrySyncNotice(synced.changes)");
    // 🔴 자동으로 내리지 않는다 — 덜 받게 된 줄은 경고로만 나간다.
    expect(carry).toContain("carryShortNotice(synced.shorts)");
    expect(carry).toContain("...(notice ? { notice } : {})");
  });

  it("배분 저장은 저장 뒤 그 청구서로 부른다(지난 달 이월이 이 저장으로 실린다)", () => {
    const alloc = server("receipt-allocation-actions.ts");
    const rpc = alloc.indexOf(`db.rpc("save_session_receipt_allocations", { p_invoice_id: invoiceId, p_expected_lines: source, p_rows: rows })`);
    expect(rpc).toBeGreaterThan(-1);
    expect(alloc.slice(rpc, rpc + 500)).toContain(`syncCarrySessionsAfter(db, { invoiceId }, user.id, "allocate")`);
  });

  it("고치기 전에 그 청구서가 자동 재확정되는지 같은 판정으로 미리 보고, 고친 뒤 재확정이 실패하면 되돌린다", () => {
    const sync = server("carry-session-sync.ts");
    expect(sync).toContain(`planAutoReallocation(entry.inv, hypothetical).kind !== "save"`);
    expect(sync).toContain("autoReallocateAfterConfirm(db, saved.map((p) => p.row.id)");
    // 읽은 값 그대로일 때만 저장(조건부 update) — 그 사이 사람이 확정을 풀거나 고친 줄을 덮지 않는다.
    expect(sync).toContain(`.eq("id", p.row.id).eq("confirmed_sessions", p.row.confirmedSessions as number).eq("amount", p.row.amount as number)`);
    // 🔴 재확정이 실패하면 고친 값을 되돌린다 — 내가 고친 값 그대로일 때만.
    expect(sync).toContain("if (realloc.saved === 0)");
    expect(sync).toContain(`.eq("id", p.row.id).eq("confirmed_sessions", p.plan.sessions).eq("amount", p.plan.amount)`);
    expect(sync).toContain(`action: "session_term_carry_sync"`);
  });

  it("받을 줄 고르기는 회차 확정 화면과 같은 순수 함수 한 벌 — 화면이 더한 줄과 시수를 올린 줄이 갈리지 않는다", () => {
    expect(server("carry-session-sync.ts")).toContain(`import { attachMoneyCarry } from "../money-carry-attach"`);
    expect(server("queries.ts")).toContain(`import { attachMoneyCarry } from "../money-carry-attach"`);
    expect(server("queries.ts")).not.toContain("function attachMoneyCarry(");
  });

  it("🔴 올리기만 한다 — 판정 함수는 덜 받은 줄을 내리지 않는다", () => {
    const pure = read("features", "billing", "session-terms", "carry-session-sync.ts");
    expect(pure).toContain("if (gap < 0 || (gap !== landed && !byAdded))");
    // 이월을 방금 더 실은 계기의 '늘어난 몫'도 **올리는 쪽**으로만 쓴다(양수 · 이 줄에 실린 합계 이하).
    expect(pure).toContain("const byAdded = added > 0 && added <= landed && gap === added;");
    expect(pure).not.toContain("delta");
  });

  it("화면은 자동으로 맞춘 줄을 한 번 알린다 — 확정 응답 · 이월 창 · 배분 창", () => {
    const dir = ["app", "(shell)", "billing", "_components"] as const;
    expect(read(...dir, "session-terms-state.tsx")).toContain("term.carryNotice");
    expect(read(...dir, "money-carry-cell.tsx")).toContain("if (result.notice) toast.success(result.notice)");
    expect(read(...dir, "receipt-allocation-dialog.tsx")).toContain("if (result.notice) toast.success(result.notice)");
  });
});
