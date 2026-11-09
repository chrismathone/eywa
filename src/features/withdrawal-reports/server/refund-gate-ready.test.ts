import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 관문 DB 준비(리뷰 r2 D-7) — 판정은 s2_0036이 만들고 되돌리기가 **지우는** 표식 함수 `withdrawal_refund_gate_ready()`로 한다.
 * 함수가 참일 때만 준비 · 함수가 없으면(적용 전 · 되돌림) 거짓(관문 경로를 막는다) · 그 밖의 오류는 던진다(부르는 쪽이 처리하지 않는다).
 */
const m = vi.hoisted(() => ({ result: { data: true as unknown, error: null as null | { code?: string; message: string } }, names: [] as string[] }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: async (name: string) => { m.names.push(name); return m.result; } }) }));
vi.mock("./refund", () => ({ laterInvoicesFor: vi.fn(), loadLaterInvoices: vi.fn(), refundScopeOf: vi.fn() }));
import { refundGateReady } from "./refund-check";

beforeEach(() => { m.names = []; vi.spyOn(console, "error").mockImplementation(() => {}); });

describe("refundGateReady", () => {
  it("표식 함수가 참일 때만 준비", async () => {
    m.result = { data: true, error: null };
    expect(await refundGateReady()).toBe(true);
    expect(m.names).toEqual(["withdrawal_refund_gate_ready"]);
    for (const data of [false, null, "true", 1]) {
      m.result = { data, error: null };
      expect(await refundGateReady(), String(data)).toBe(false);
    }
  });
  it("🔴 함수가 없으면(적용 전 · 되돌린 DB) 거짓 — 확인 값을 옛 처리 함수에 넘기지 않는다", async () => {
    m.result = { data: null, error: { code: "PGRST202", message: "Could not find the function public.withdrawal_refund_gate_ready" } };
    expect(await refundGateReady()).toBe(false);
  });
  it("그 밖의 오류는 던진다(모르면 처리하지 않는 쪽)", async () => {
    m.result = { data: null, error: { code: "57014", message: "timeout" } };
    await expect(refundGateReady()).rejects.toThrow("퇴원보고서 환불 관문 확인 실패: timeout");
  });
});
