import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { loadLabSeparateIds, lookupLabSeparateIds } from "./lab-separate";

/** 체인을 흉내 내는 가짜 클라이언트 — 마지막 range가 준 결과를 돌려준다. */
function fakeDb(pages: { data: { id: string }[] | null; error: { code?: string } | null }[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "lte", "or", "order"]) builder[m] = () => builder;
  builder.range = () => Promise.resolve(pages[Math.min(call++, pages.length - 1)]);
  return { from: () => builder } as never;
}

describe("'따로 수업(*LAB)' 표식 조회 — 칸 없음과 실패를 가른다 (적대적 리뷰 2026-09-17)", () => {
  const scope = { kind: "class", classId: "c1" } as const;

  it("칸 있음 → 켜진 id", async () => {
    expect(await lookupLabSeparateIds(fakeDb([{ data: [{ id: "a" }, { id: "b" }], error: null }]), scope)).toEqual({ ids: new Set(["a", "b"]) });
  });

  it("칸 없음(42703·PGRST204) → missing — 쓰기는 키를 뺀다", async () => {
    expect(await lookupLabSeparateIds(fakeDb([{ data: null, error: { code: "42703" } }]), scope)).toBe("missing");
    expect(await lookupLabSeparateIds(fakeDb([{ data: null, error: { code: "PGRST204" } }]), scope)).toBe("missing");
  });

  it("🔴 그 밖의 실패 → error — 쓰기는 멈춘다(\"칸 없음\"으로 읽으면 저장이 표식을 조용히 끈다)", async () => {
    expect(await lookupLabSeparateIds(fakeDb([{ data: null, error: { code: "57014" } }]), scope)).toBe("error");
    expect(await lookupLabSeparateIds(fakeDb([{ data: null, error: {} }]), scope)).toBe("error");
  });

  it("표시 경로는 둘 다 모름(null)", async () => {
    expect(await loadLabSeparateIds(fakeDb([{ data: null, error: { code: "57014" } }]), scope)).toBeNull();
    expect(await loadLabSeparateIds(fakeDb([{ data: null, error: { code: "42703" } }]), scope)).toBeNull();
  });

  it("1,000행이 꽉 차면 다음 페이지를 읽는다", async () => {
    const full = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}` }));
    const r = await lookupLabSeparateIds(fakeDb([{ data: full, error: null }, { data: [{ id: "last" }], error: null }]), scope);
    expect(typeof r === "object" && r.ids.size).toBe(1001);
  });
});
