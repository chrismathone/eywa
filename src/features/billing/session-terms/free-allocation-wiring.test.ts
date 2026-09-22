import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// 자유 배분(0279a, 원장 2026-09-21) 배선 가드 — 관리자 이상 게이트·상한 판정이 화면·서버·DB에 같이 있는지.
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("자유 배분 배선", () => {
  it("🔴 서버 액션이 관리자 이상(+ super_admin)과 상한을 다시 본다(#77) — 화면 전환만 숨기면 뒷문이다", () => {
    const actions = read("src/features/billing/session-terms/server/receipt-allocation-actions.ts");
    const fn = actions.slice(actions.indexOf("export async function saveFreeReceiptAllocation"));
    expect(fn).toContain("canUseFreeAllocation(user.systemRole)");
    expect(fn).toContain("isCurrentUserSuperAdmin()");
    expect(fn).toContain("validateFreeAllocation(");
    expect(fn).toContain('"save_session_receipt_allocations_free"');
    // 화면 전환의 근거도 같은 판정이다.
    expect(actions).toMatch(/const canFree = canUseFreeAllocation\(user\.systemRole\) \|\| \(await isCurrentUserSuperAdmin\(\)\);/);
  });

  it("🔴 DB 함수도 관리자 이상·상한·확정 반 포함을 다시 본다 — 항목별 함수(0269a)는 손대지 않는다", () => {
    const sql = read("supabase/migrations/0279a_receipt_allocation_free.sql");
    expect(sql).toMatch(/auth_system_role\(\), ''\) in \('master', 'admin'\)/);
    // super_admin은 0021a의 기존 함수로(새 함수를 만들어 두 벌이 되지 않게).
    expect(sql).toContain("public.is_super_admin(auth.uid())");
    expect(sql).not.toContain("auth_is_super_admin");
    expect(sql).toMatch(/if allocated > total then/);
    expect(sql).toContain("확정한 반은 모두 넣어 주세요");
    expect(sql).not.toContain("function public.save_session_receipt_allocations(");
  });

  it("🔴 수납 쓰기 권한만으로 회차 행을 직접 고쳐 자유 배분 모양을 만드는 길을 트리거가 막는다(0165a update 정책은 역할을 안 본다)", () => {
    const sql = read("supabase/migrations/0279a_receipt_allocation_free.sql");
    expect(sql).toMatch(/create trigger session_free_allocation_guard before insert or update of allocation_line_index, allocation_amount, allocation_base_amount, allocation_source/);
    // 기준액·스냅샷을 지금 값에 맞춰 쓰면 무효가 된 자유 배분이 관리자 없이 되살아난다.
    expect(sql).toMatch(/old\.allocation_base_amount is distinct from new\.allocation_base_amount or old\.allocation_source is distinct from new\.allocation_source/);
    expect(sql).toMatch(/new\.allocation_line_index is null and coalesce\(new\.allocation_amount, 0\) > 0/);
  });

  it("🔴 미확정 반의 자유 배분도 첫 확정에 기준액을 이어받는다(0267b 트리거를 넓힘) — 안 그러면 확정하는 순간 청구서 전체가 '재확인'", () => {
    const sql = read("supabase/migrations/0279a_receipt_allocation_free.sql");
    const fn = sql.slice(sql.indexOf("function public.adopt_session_receipt_allocation_basis"));
    expect(fn).toMatch(/old\.allocation_line_index is not null or coalesce\(old\.allocation_amount, 0\) > 0/);
    expect(fn).toContain("0시수로 확정할 수 없습니다");
  });

  it("🔴 계획 갱신은 자유 배분 금액이 있는 미확정 행을 지우지 않는다(항목 칸만 보면 지운다)", () => {
    const src = read("src/features/billing/session-terms/server/actions.ts");
    expect(src).toMatch(/t\.allocation_line_index == null && Number\(t\.allocation_amount \?\? 0\) === 0\) staleUnconfirmed\.push/);
    expect(src).toContain('.is("allocation_line_index", null).or("allocation_amount.is.null,allocation_amount.eq.0")');
  });

  it("🔴 자유 배분 청구서의 재확인은 관리자만 풀 수 있다고 분배 저장·시수 검증이 가른다(잠금이 모양만 보기 때문)", () => {
    expect(read("src/features/billing/session-terms/server/verification-queries.ts")).toContain("freeAllocationSaved: freeInvoices.has(r.invoiceId)");
    expect(read("src/features/billing/session-terms/server/splits-actions.ts")).toMatch(/row\.freeAllocationSaved[\s\S]*관리자만 고칠 수 있습니다/);
    expect(read("src/app/(shell)/billing/_components/session-verification-face.tsx")).toContain("관리자만 고칠 수 있습니다");
  });

  it("🔴 회차 확정 면도 유효한 자유 배분 청구서의 금액 없는 반을 이름 매칭 참고값으로 채우지 않는다(출석부 freeActive와 같은 판정)", () => {
    const src = read("src/features/billing/session-terms/server/queries.ts");
    expect(src).toContain("freeActiveInvoices.has(t.invoice_id) ? null");
    expect(src).toContain("freeActiveInvoices.has(inv.id) ? null");
  });

  it("🔴 관리자가 아닌 사람은 자유 배분 청구서를 항목별 저장·합산으로 덮지 못한다(서버)", () => {
    const actions = read("src/features/billing/session-terms/server/receipt-allocation-actions.ts");
    for (const name of ["mergeReceiptItems", "saveReceiptAllocation"]) {
      const at = actions.indexOf(`export async function ${name}(`);
      const next = actions.indexOf("export async function", at + 10);
      expect(actions.slice(at, next === -1 ? undefined : next), name).toContain("freeAllocationLock(");
    }
  });

  it("🔴 출석부 금액 열은 유효한 자유 배분이 있으면 반 이름 매칭으로 채우지 않는다(합계가 청구액을 넘는다)", () => {
    const src = read("src/features/attendance/class-billing.ts");
    expect(src).toMatch(/base \?\? \(freeActive \? 0 : classInvoiceAmount\(/);
  });

  it("유효성(effectiveAllocations)은 연결 행이 없는 청구서만 자유 배분으로 읽고 상한을 건다", () => {
    const src = read("src/features/billing/session-terms/receipt-allocation.ts");
    expect(src).toMatch(/if \(!terms\.some\(\(term\) => term\.lineIndex !== null\)\)/);
    expect(src).toMatch(/<= tuitionTotal\(lines\)/);
  });

  it("감사로그 라벨이 등록돼 있다", () => {
    expect(read("src/features/audit/server/log.ts")).toContain('session_term_receipt_allocate_free: "수납 자유 배분(관리자)"');
  });
});
