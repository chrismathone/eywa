import { describe, expect, it, vi } from "vitest";

// 받는 달의 이월 판정(`loadMoneyCarryIns`) — **연쇄 이월**(원장 2026-11-09): 보내는 달 행의 더 받은 몫에는 그 행이 그 앞 달에서
// 받은 이월도 든다. 회차 확정 화면(보내는 달)이 '이월' 버튼을 세운 금액을 받는 달도 유효로 봐야 돈이 사라지지 않는다.
vi.mock("server-only", () => ({}));
vi.mock("./month-roster", () => ({ loadMonthRoster: vi.fn() }));

import { loadMoneyCarryIns } from "./money-carryover-queries";
import { carryOutValid } from "../money-carryover";

type Inv = { id: string; student_id: string; period: string; status: string; line_items: unknown[] };
type Term = {
  id: string; invoice_id: string; class_id: string | null; amount: number | null; confirmed_sessions: number | null;
  allocation_line_index: number | null; allocation_amount: number | null; allocation_source: unknown; allocation_base_amount: number | null;
  allocation_carry_out: number; allocation_carry_class_id: string | null; allocation_carry_note: string | null; allocation_carry_at: string | null;
};

/** PostgREST 빌더 흉내 — 이 모듈이 쓰는 조회 셋(이월 행 · 청구서별 회차 행 · 학생의 그 달 청구서)만. */
function fakeDb(invoices: Inv[], terms: Term[], log: string[] = []) {
  const from = (table: string) => {
    const eq: Record<string, unknown> = {};
    const neq: Record<string, unknown> = {};
    let gt: [string, number] | null = null;
    let inn: [string, string[]] | null = null;
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.order = () => b;
    b.range = () => b;
    b.eq = (c: string, v: unknown) => { eq[c] = v; return b; };
    b.neq = (c: string, v: unknown) => { neq[c] = v; return b; };
    b.gt = (c: string, v: number) => { gt = [c, v]; return b; };
    b.in = (c: string, v: string[]) => { inn = [c, v]; return b; };
    b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve().then(() => {
      const withClass = (t: Term) => ({ ...t, class: { class_name: t.class_id === "c-sky" ? "중등E_중1 SKY" : "다른 반" } });
      if (table === "invoice_session_terms" && gt) {
        log.push(`carried ${String(eq["invoice.period"])}`);
        return { data: terms.filter((t) => t.allocation_carry_out > 0).flatMap((t) => {
          const inv = invoices.find((i) => i.id === t.invoice_id);
          return inv && inv.period === eq["invoice.period"] ? [{ ...withClass(t), invoice: inv }] : [];
        }), error: null };
      }
      if (table === "invoice_session_terms" && inn?.[0] === "invoice_id") {
        const ids = inn[1];
        return { data: terms.filter((t) => ids.includes(t.invoice_id)).map(withClass), error: null };
      }
      if (table === "invoices" && inn?.[0] === "student_id") {
        const ids = inn[1];
        log.push(`invoices ${String(eq.period)}`);
        return { data: invoices.filter((i) => i.period === eq.period && i.status !== neq.status && ids.includes(i.student_id)), error: null };
      }
      throw new Error(`예상 밖 조회: ${table}`);
    }).then(resolve, reject);
    return b;
  };
  return { from } as never;
}

const S = "s-jo";
const line = (amount: number) => ({ kind: "수업", description: "중등E_중1 SKY Jane 화수금 18:20-20:10", amount });
const inv = (id: string, period: string, amount: number): Inv => ({ id, student_id: S, period, status: "paid", line_items: [line(amount)] });
/** 수납 항목 하나를 이 반 혼자 받는 회차 행(배분 = 청구 항목 전액 — 유효 배분). */
const term = (id: string, invoiceId: string, o: { billed: number; amount: number; sessions: number; carry?: number }): Term => ({
  id, invoice_id: invoiceId, class_id: "c-sky", amount: o.amount, confirmed_sessions: o.sessions,
  allocation_line_index: 0, allocation_amount: o.billed, allocation_source: line(o.billed), allocation_base_amount: o.amount,
  allocation_carry_out: o.carry ?? 0, allocation_carry_class_id: o.carry ? "c-sky" : null, allocation_carry_note: null, allocation_carry_at: null,
});

// 조은준 실데이터 모양 — 8월: 배분 288,000 · 확정 22시수 264,000 → 24,000을 9월로.
//                      9월: 배분 312,000 + 받은 24,000 = 336,000 · 확정 27시수 324,000 → 남은 12,000을 10월로.
const invoices = [inv("i-aug", "2026-08", 288000), inv("i-sep", "2026-09", 312000)];
const aug = term("t-aug", "i-aug", { billed: 288000, amount: 264000, sessions: 22, carry: 24000 });
const sep = (carry: number) => term("t-sep", "i-sep", { billed: 312000, amount: 324000, sessions: 27, carry });

describe("loadMoneyCarryIns — 연쇄 이월", () => {
  it("9월이 8월에서 받은 이월로 남긴 12,000을 10월이 유효로 받는다", async () => {
    const log: string[] = [];
    const r = await loadMoneyCarryIns(fakeDb(invoices, [aug, sep(12000)], log), "2026-10", null);
    expect(r.failed).toBe(false);
    expect(r.map.get(`${S}|c-sky`)).toEqual([expect.objectContaining({ amount: 12000, fromPeriod: "2026-09", valid: true })]);
    // 9월 줄은 제 몫(0원)으로 12,000이 안 덮여 그 (학생, 반)으로 온 8월 이월을 거슬러 읽는다. 8월 줄은 제 몫(24,000)으로 덮여 거기서 멈춘다.
    expect(log).toEqual(["carried 2026-09", "carried 2026-08"]);
  });

  it("받은 몫을 넘는 이월은 무효 — 12,001원", async () => {
    const r = await loadMoneyCarryIns(fakeDb(invoices, [aug, sep(12001)]), "2026-10", null);
    expect(r.map.get(`${S}|c-sky`)?.[0]?.valid).toBe(false);
  });

  it("앞 달 이월이 무효가 되면(8월 확정을 24시수로 올림) 9월이 넘긴 12,000도 무효 — 받은 돈이 없어진 만큼 사슬이 끊긴다", async () => {
    const augFull = term("t-aug", "i-aug", { billed: 288000, amount: 288000, sessions: 24, carry: 24000 });
    const r = await loadMoneyCarryIns(fakeDb(invoices, [augFull, sep(12000)]), "2026-10", null);
    expect(r.map.get(`${S}|c-sky`)?.[0]?.valid).toBe(false);
  });

  it("다른 반으로 온 이월은 이 줄의 더 받은 몫에 안 든다 — 거슬러 읽기도 (학생, 보내는 반)으로만 이어진다", async () => {
    // 8월이 같은 학생의 다른 반('c-other')으로 24,000을 넘겼다 — 9월 'c-sky' 줄이 받은 돈이 아니다.
    const augOther = { ...aug, allocation_carry_class_id: "c-other" };
    const log: string[] = [];
    const r = await loadMoneyCarryIns(fakeDb(invoices, [augOther, sep(12000)], log), "2026-10", null);
    expect(r.map.get(`${S}|c-sky`)?.[0]?.valid).toBe(false);
    // 8월 이월 행은 'c-sky'로 오지 않아 걸러지고, 그 앞 달(7월)은 읽지 않는다.
    expect(log).toEqual(["carried 2026-09", "carried 2026-08"]);
  });

  it("받은 이월 없이 제 몫만으로 넘긴 이월은 종전 그대로 유효 — 앞 달을 읽지 않는다(왕복 증가 없음)", async () => {
    const log: string[] = [];
    const own = term("t-sep", "i-sep", { billed: 336000, amount: 324000, sessions: 27, carry: 12000 });
    const r = await loadMoneyCarryIns(fakeDb([inv("i-sep", "2026-09", 336000)], [own], log), "2026-10", null);
    expect(r.map.get(`${S}|c-sky`)?.[0]?.valid).toBe(true);
    expect(log).toEqual(["carried 2026-09"]);
  });

  it("학생을 좁히면 그 학생 것만", async () => {
    const r = await loadMoneyCarryIns(fakeDb(invoices, [aug, sep(12000)]), "2026-10", new Set(["someone-else"]));
    expect(r.map.size).toBe(0);
  });

  it("🔴 보내는 달 화면(받은 이월을 붙여 `carrySurplus`)과 받는 달 판정이 같은 답 — 경계 금액 셋", async () => {
    // 보내는 달(9월) 화면: 9월이 받은 이월(`loadMoneyCarryIns(9월)`)을 줄에 붙여 더 받은 몫을 센다(회차 확정 `attachMoneyCarry` 경로).
    const intoSep = await loadMoneyCarryIns(fakeDb(invoices, [aug, sep(0)]), "2026-09", null);
    const sepRow = { allocatedAmount: 312000, allocationStale: false, amount: 324000, confirmedSessions: 27, carryIns: intoSep.map.get(`${S}|c-sky`) };
    for (const amount of [11999, 12000, 12001]) {
      const intoOct = await loadMoneyCarryIns(fakeDb(invoices, [aug, sep(amount)]), "2026-10", null);
      expect(intoOct.map.get(`${S}|c-sky`)?.[0]?.valid).toBe(carryOutValid(sepRow, amount));
    }
  });

  it("🔴 사슬이 상한(120달)을 넘으면 조용히 끊지 않고 조회 실패로 올린다 — 끊어 읽으면 두 달의 답이 갈린다", async () => {
    // 매달 받은 24,000을 그대로 같은 반 다음 달로 넘긴 130달짜리 사슬(제 몫은 0원 — 달마다 앞 달을 거슬러 읽어야 한다).
    const invs: Inv[] = [];
    const terms: Term[] = [];
    let p = "2026-09";
    for (let i = 0; i < 130; i++) {
      invs.push(inv(`i-${p}`, p, 264000));
      terms.push(term(`t-${p}`, `i-${p}`, { billed: 264000, amount: 264000, sessions: 22, carry: 24000 }));
      const [y, m] = p.split("-").map(Number);
      p = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    }
    const r = await loadMoneyCarryIns(fakeDb(invs, terms), "2026-10", null);
    expect(r.failed).toBe(true);
    expect(r.map.size).toBe(0);
  });
});
