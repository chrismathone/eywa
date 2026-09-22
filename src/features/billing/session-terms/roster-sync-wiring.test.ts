import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 회차 확정 줄 = 월별 출석부 줄(원장 2026-09-18 *"출석부에 존재하는 행 개수와, 회차 확정의 행 개수가 서로 유기적으로 일치해야해"*)
 * — 배선 가드. 두 화면이 **같은 판정**을 부르는지, 화면에서 온 회차 id로 쓰는 서버 액션이 가상 id(`v:학생:반`)를 **풀거나 거르는지**를
 * 소스로 잠근다(동작 테스트는 pricing·term-materialize·month-roster·matrix-table에 있다).
 */
const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8").replace(/\r\n/g, "\n");
const SERVER = "src/features/billing/session-terms/server";

/** `export async function name(` 부터 다음 `export `까지 — 함수 본문 근사. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`${name} 없음`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

describe("줄 집합 한 벌 — 두 화면이 같은 규칙", () => {
  it("줄 집합의 '수강행 없는 방문자' 판정은 출석부와 같은 함수(makeupStudentIds)를 부른다", () => {
    const roster = read("src/features/billing/session-terms/month-roster.ts");
    expect(roster).toMatch(/import \{ makeupStudentIds \} from "@\/features\/attendance\/input-roster"/);
    expect(roster).toMatch(/makeupStudentIds\(visitorIds/);
    // 출석부 월별 명단도 같은 함수를 거친다(monthly-makeup-roster → input-roster).
    expect(read("src/features/attendance/monthly-makeup-roster.ts")).toMatch(/return makeupStudentIds\(/);
    expect(read("src/features/attendance/server/queries.ts")).toMatch(/recordedOnlyStudentIds\(/);
  });

  it("회차 확정 화면·계획 갱신이 loadMonthRoster로 줄을 세운다", () => {
    const queries = read(`${SERVER}/queries.ts`);
    expect(bodyOf(queries, "getSessionTermsView")).toMatch(/loadMonthRoster\(supabase, period/);
    expect(bodyOf(queries, "getSessionTermsView")).toMatch(/virtualTermId\(pair\.studentId, pair\.classId\)/);
    const refresh = bodyOf(read(`${SERVER}/actions.ts`), "refreshPlannedTerms");
    expect(refresh).toMatch(/loadMonthRoster\(supabase, period\)/);
    // 줄 집합 안의 행은 지우지 않는다 — 삭제 조건에 줄 집합 판정이 들어 있어야 한다.
    expect(refresh).toMatch(/!rosterPairOf\(t\) && t\.confirmed_sessions === null/);
  });

  it("출석부는 청구서 상태로 '—' 줄을 가른다(회차 확정 화면의 '청구서 없음·취소'와 같은 집합)", () => {
    expect(read("src/features/attendance/server/class-billing.ts")).toMatch(/invoiceStateByStudent/);
    const page = read("src/app/(shell)/attendance/page.tsx");
    expect(page).toMatch(/attendanceNoInvoiceRows\(billingRoster, classBilledAmounts\.invoiceStateByStudent\)/);
    expect(page).toMatch(/noInvoiceRows=\{noInvoiceRows\}/);
  });
});

describe("가상 id — 저장하는 순간에만 행을 만들고, 서버가 다시 판정한다(#77)", () => {
  it("확정 3경로·배분 저장이 materializeVirtualTerms를 거친다 — 반 일괄은 예정 없는 줄을 만들지 않는다", () => {
    const actions = read(`${SERVER}/actions.ts`);
    expect(bodyOf(actions, "confirmSessionTerm")).toMatch(/materializeVirtualTerms\(/);
    const cls = bodyOf(actions, "confirmClassTerms");
    expect(cls).toMatch(/materializeVirtualTerms\([^)]*plannedOnly: true/);
    // 반 일괄 대상 = 이번 달 예정(live plan)이 있는 행만 — 화면 `batchEligible`과 같은 축(저장된 planned_sessions 아님).
    expect(cls).toMatch(/const livePlans = await loadLivePlans\(/);
    expect(cls).toMatch(/const targets = inView\.filter\(\(r\) => planOf\(r\) > 0\)/);
    // 취소 청구서의 행은 대상 밖.
    expect(cls).toMatch(/\.neq\("invoice\.status", "void"\)/);
    // 반 일괄은 그 반만 읽는다(테넌트 전체를 긁지 않는다).
    expect(cls).toMatch(/loadMonthRoster\(supabase, period, \{ classIds: \[classId\] \}\)/);
    expect(bodyOf(read(`${SERVER}/selected-confirm-actions.ts`), "confirmSelectedTerms")).toMatch(/materializeVirtualTerms\(/);
    const save = bodyOf(read(`${SERVER}/receipt-allocation-actions.ts`), "saveReceiptAllocation");
    // 행을 먼저 만들고 실 id로 바꾼 뒤에 배분 RPC.
    expect(save.indexOf("materializeVirtualTerms(")).toBeGreaterThan(0);
    expect(save.indexOf("materializeVirtualTerms(")).toBeLessThan(save.indexOf("save_session_receipt_allocations"));
  });

  it("🔴 화면에서 받은 id로 invoice_session_terms를 쓰는 서버 액션은 전부 가상 id를 풀거나 거른다(전수)", () => {
    /** 가상 id가 올 수 없는 이유가 구조로 보장되는 액션만 — 이유 필수. */
    const EXEMPT: Record<string, string> = {
      refreshPlannedTerms: "청구월만 받는다 — id는 DB에서 읽는다",
      updateMonthlyTermSessions: "확정된 행(confirmed_at 필수)만 고친다 — 가상 줄은 확정된 적이 없다",
      saveTeacherSplits: "청구월만 받는다 — 확정 행만 분배 표에 쓴다",
      getReceiptAllocation: "읽기",
      mergeReceiptItems: "청구서 수납 항목만 고친다(회차 행 id 없음)",
    };
    const files = readdirSync(join(ROOT, SERVER)).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    const offenders: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      const src = read(`${SERVER}/${f}`);
      if (!src.startsWith('"use server"')) continue;
      for (const m of src.matchAll(/export async function (\w+)\(/g)) {
        const name = m[1]!;
        seen.add(name);
        if (EXEMPT[name]) continue;
        const body = bodyOf(src, name);
        const writesTerms = /from\("invoice_session_terms"\)[\s\S]*?\.(update|delete)\(/.test(body) || /save_session_receipt_allocations/.test(body);
        // 삭제의 미리보기·실행은 deletionContext가 가상 id·권한을 함께 검사한다(동작은 delete-actions.test).
        if (writesTerms && !/isVirtualTermId\(|materializeVirtualTerms\(|deletionContext\(/.test(body)) offenders.push(`${f}:${name}`);
      }
    }
    expect(offenders).toEqual([]);
    // 죽은 면제 금지 — 이름이 바뀌면 면제도 함께 고친다.
    expect(Object.keys(EXEMPT).filter((name) => !seen.has(name))).toEqual([]);
  });

  it("행 생성은 계획 필드만 싣고(확정·배분·메모 없음) 이미 있는 행은 건드리지 않는다 · 감사로그 키가 등록돼 있다", () => {
    const src = read(`${SERVER}/term-materialize.ts`);
    const rows = src.slice(src.indexOf("const rows = creatable.map"), src.indexOf("}));", src.indexOf("const rows = creatable.map")));
    expect(rows).toMatch(/tenant_id[\s\S]*invoice_id[\s\S]*subject[\s\S]*class_id[\s\S]*planned_sessions/);
    expect(rows).not.toMatch(/confirmed|allocation|note|unit_price|amount/);
    expect(src).toMatch(/onConflict: "tenant_id,invoice_id,class_id", ignoreDuplicates: true/);
    expect(src).toMatch(/action: "session_term_create"/);
    expect(read("src/features/audit/server/log.ts")).toMatch(/session_term_create: "/);
    expect(read("src/features/audit/describe.ts")).toMatch(/case "session_term_create":/);
  });
});
