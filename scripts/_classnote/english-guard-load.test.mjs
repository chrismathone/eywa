// 영어 반 방 원아 신분 가드의 재료 조회(english-guard-load.mjs) — 적대적 리뷰 2026-11-05 시험 공백(그 모듈은 모든 시험에서 흉내라 한 번도 안 돌았다).
// 학생·명부는 10분 다시 쓰고 · 확인 기록·원장 확인 연결은 매번 읽고 · 확인 기록을 못 읽으면 throw · fresh면 1분 지난 캐시를 다시 읽는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = { students: 0, admissions: 0, verified: 0, confirmed: 0 };
let verifiedValue = new Map();
vi.mock("./math-class-boards-load.mjs", () => ({
  loadBoardStudents: vi.fn(async () => {
    calls.students++;
    return new Map([
      ["a", { id: "a", name: "김하", grade: "초4", phones: ["010-1111-1111"], status: "enrolled" }],
      ["b", { id: "b", name: "김하늘", grade: "초3", phones: ["010-2222-2222"], status: "enrolled" }],
      ["w", { id: "w", name: "퇴원생", grade: "초6", phones: [], status: "withdrawn" }],
      ["h", { id: "h", name: "휴원생", grade: "초6", phones: [], status: "on_hold" }],
    ]);
  }),
  fetchAdmissions: vi.fn(async () => {
    calls.admissions++;
    return new Map([[7, { name: "김하늘", phones: ["010-1111-1111"] }]]);
  }),
  loadVerifiedChildren: vi.fn(async () => {
    calls.verified++;
    return verifiedValue;
  }),
  loadConfirmedChildPairs: vi.fn(async () => {
    calls.confirmed++;
    return new Set(["a:7"]);
  }),
}));

const { loadEnglishGuardInputs, resetEnglishGuardCacheForTest, ENGLISH_GUARD_CACHE_MS, ENGLISH_GUARD_FRESH_MIN_MS } = await import("./english-guard-load.mjs");
const opts = (over = {}) => ({ tenant: "t1", centerId: 1, now: 1_000_000, ...over });

beforeEach(() => {
  resetEnglishGuardCacheForTest();
  for (const k of Object.keys(calls)) calls[k] = 0;
  verifiedValue = new Map();
});

describe("loadEnglishGuardInputs", () => {
  it("학생·명부는 10분 안이면 다시 쓰고, 확인 기록·원장 확인 연결은 매번 읽는다", async () => {
    await loadEnglishGuardInputs({}, {}, opts());
    await loadEnglishGuardInputs({}, {}, opts({ now: 1_000_000 + ENGLISH_GUARD_CACHE_MS - 1 }));
    expect(calls).toEqual({ students: 1, admissions: 1, verified: 2, confirmed: 2 });
  });
  it("10분이 지나면 학생·명부를 다시 읽는다", async () => {
    await loadEnglishGuardInputs({}, {}, opts());
    await loadEnglishGuardInputs({}, {}, opts({ now: 1_000_000 + ENGLISH_GUARD_CACHE_MS }));
    expect(calls.students).toBe(2);
    expect(calls.admissions).toBe(2);
  });
  it("fresh면 10분 안이어도 다시 읽는다(판정이 막혔을 때 한 번 더 — 바로잡은 직후 재발송)", async () => {
    await loadEnglishGuardInputs({}, {}, opts());
    await loadEnglishGuardInputs({}, {}, opts({ now: 1_000_000 + ENGLISH_GUARD_FRESH_MIN_MS, fresh: true }));
    expect(calls.students).toBe(2);
    expect(calls.admissions).toBe(2);
  });
  it("🔴 fresh라도 1분 안에 읽은 값은 다시 읽지 않는다(전원이 막히는 날 보고서마다 무거운 조회가 몰리지 않게 — 재리뷰 2026-11-05)", async () => {
    await loadEnglishGuardInputs({}, {}, opts());
    await loadEnglishGuardInputs({}, {}, opts({ fresh: true }));
    await loadEnglishGuardInputs({}, {}, opts({ now: 1_000_000 + ENGLISH_GUARD_FRESH_MIN_MS - 1, fresh: true }));
    expect(calls.students).toBe(1);
    expect(calls.admissions).toBe(1);
    expect(calls.verified).toBe(3); // 확인 기록·원장 확인 연결은 여전히 매번
    expect(calls.confirmed).toBe(3);
  });
  it("지점(센터)이 바뀌면 캐시를 쓰지 않는다", async () => {
    await loadEnglishGuardInputs({}, {}, opts());
    await loadEnglishGuardInputs({}, {}, opts({ tenant: "t2", centerId: 2 }));
    expect(calls.students).toBe(2);
    expect(calls.admissions).toBe(2);
  });
  it("🔴 확인 기록을 못 읽으면(null) throw — 모르는 채 보내지 않는다", async () => {
    verifiedValue = null;
    await expect(loadEnglishGuardInputs({}, {}, opts())).rejects.toThrow("반 보드 확인 기록을 읽지 못했습니다");
  });
  it("확인 기록의 비교 상대 = 재원·휴원 학생만(퇴원생의 옛 기록은 비교 상대가 아니다)", async () => {
    verifiedValue = new Map([
      ["w", [{ id: 9, name: "옛 원아", boardIds: [1] }]],
      ["h", [{ id: 8, name: "휴원 원아", boardIds: [1] }]],
    ]);
    const r = await loadEnglishGuardInputs({}, {}, opts());
    expect([...(r.verifiedOwners.get(9) ?? [])]).toEqual([]);
    expect([...(r.verifiedOwners.get(8) ?? [])]).toEqual(["h"]);
  });
  it("loadedAt = 학생·명부 중 더 오래된 쪽을 읽은 때(캐시 나이 — 호출부가 오래된 값으로 막혔는지 가른다)", async () => {
    expect((await loadEnglishGuardInputs({}, {}, opts())).loadedAt).toBe(1_000_000);
    const later = 1_000_000 + 5 * 60_000;
    expect((await loadEnglishGuardInputs({}, {}, opts({ now: later }))).loadedAt).toBe(1_000_000); // 캐시 그대로
    expect((await loadEnglishGuardInputs({}, {}, opts({ now: later, fresh: true }))).loadedAt).toBe(later); // 1분 넘어 다시 읽음
  });
  it("같은 집·지점 전체 이름 찾기와 원장 확인 연결을 함께 돌려준다", async () => {
    const r = await loadEnglishGuardInputs({}, {}, opts());
    expect(r.confirmedPairs.has("a:7")).toBe(true);
    expect(r.namesakesFor(["김하늘"]).map((s) => s.id)).toEqual(["b"]);
    expect(r.familyFor(r.students.get("a"), r.admissions.get(7)).map((s) => s.id)).toEqual(["a"]);
  });
});
