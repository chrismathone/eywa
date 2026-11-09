import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
/** 비서 DB 열기 흉내 — 부른 횟수(opened)와 돌려줄 것(openWith). */
let opened = 0;
let openWith: () => Promise<unknown> = async () => {
  throw new Error("not set");
};
// 지점 AI 라이선스는 켜져 있다고 본다(꺼진 지점은 세지 않는다 — 아래 시험 하나가 따로 본다).
let licensed = true;
vi.mock("@/lib/ai/generate", () => ({
  requireAiLicense: async () => {
    if (!licensed) throw new Error("이 지점은 AI를 쓸 수 없습니다");
  },
}));
vi.mock("./executor", () => ({
  openAssistantDb: () => {
    opened += 1;
    return openWith();
  },
}));

import { FALLBACK_SUGGESTIONS, haveKey } from "../suggestions";
import type { Row } from "./agent";
import { suggestionScope, suggestionsFor } from "./suggestions-service";

const TODAY = "2026-11-06";
const fakeDb = (unpaid: number) => ({
  views: async () => new Set(["students", "invoices", "onto_students", "onto_attendance", "onto_enrollments", "classes", "student_consultations", "enrollment_consultations", "school_exam_periods"]),
  run: async (sql: string) => {
    const row: Row | null = sql.includes("invoices") ? { count: unpaid, won: 30_000, old: 0 } : null;
    return { columns: [] as string[], rows: row ? [row] : [], rowCount: row ? 1 : 0, truncated: false, ms: 1 };
  },
  describe: async () => [],
  close: async () => undefined,
});

beforeEach(() => {
  opened = 0;
  licensed = true;
});

describe("추천 질문 서버 몫", () => {
  it("화면이 오늘 묶음을 가졌으면(have) 세지 않고 그대로", async () => {
    const owner = { tenantId: "T-have", userId: "U1" };
    const res = await suggestionsFor(owner, TODAY, { have: haveKey(suggestionScope(owner), TODAY) });
    expect(res).toEqual({ scope: suggestionScope(owner), day: TODAY });
    expect(opened).toBe(0);
  });

  it("어제 묶음이면 오늘 것으로 센다 · 같은 지점은 30분 기억 · 새로 고침은 1분 지나면 다시 센다", async () => {
    const owner = { tenantId: "T-count", userId: "U1" };
    openWith = async () => fakeDb(4);
    const first = await suggestionsFor(owner, TODAY, { have: haveKey(suggestionScope(owner), "2026-11-05"), now: 0 });
    expect(first.items?.[0]?.text).toMatch(/^미납 4건/);
    expect(opened).toBe(1);
    await suggestionsFor({ ...owner, userId: "U2" }, TODAY, { now: 10 * 60_000 });
    expect(opened).toBe(1);
    openWith = async () => fakeDb(5);
    await suggestionsFor(owner, TODAY, { refresh: true, now: 10 * 60_000 + 30_000 });
    expect(opened).toBe(2);
  });

  it("비서 DB를 못 열면 고정 문장(fallback)", async () => {
    openWith = async () => {
      throw new Error("학원 비서 DB 연결이 아직 설정되지 않았습니다");
    };
    const res = await suggestionsFor({ tenantId: "T-down", userId: "U1" }, TODAY, { now: 0 });
    expect(res.fallback).toBe(true);
    expect(res.items).toEqual([...FALLBACK_SUGGESTIONS]);
  });

  it("사람·지점 표는 사람마다 다르고 늘 같다", () => {
    expect(suggestionScope({ tenantId: "T", userId: "A" })).toBe(suggestionScope({ tenantId: "T", userId: "A" }));
    expect(suggestionScope({ tenantId: "T", userId: "A" })).not.toBe(suggestionScope({ tenantId: "T", userId: "B" }));
  });

  it("AI 라이선스가 꺼진 지점은 세지 않고 고정 문장(비서 DB를 열지 않는다)", async () => {
    licensed = false;
    openWith = async () => fakeDb(3);
    const res = await suggestionsFor({ tenantId: "t-off", userId: "u1" }, TODAY);
    expect(res.fallback).toBe(true);
    expect(opened).toBe(0);
  });

  it("같은 지점·날짜를 동시에 열면 한 번만 센다(연결 상한을 질문과 나눠 쓴다)", async () => {
    openWith = async () => fakeDb(3);
    const owner = (u: string) => ({ tenantId: "t-same", userId: u });
    const [a, b] = await Promise.all([suggestionsFor(owner("u1"), TODAY), suggestionsFor(owner("u2"), TODAY)]);
    expect(opened).toBe(1);
    expect(a.items).toEqual(b.items);
  });
});

