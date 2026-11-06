import { beforeEach, describe, expect, it, vi } from "vitest";

// 밤 배치 후보는 지점 단위 조회 여섯 번(학생 · 분석 · 상담 · 메모 · 성적 · 수강)을 `fetchAllPaged`로 한다 — 그 결과만 차례로 돌려준다.
const pages = vi.hoisted(() => [] as unknown[][]);
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/supabase/batch", () => ({ fetchAllPaged: vi.fn(async () => pages.shift() ?? []) }));
vi.mock("@/lib/date-kst", async (orig) => ({ ...(await orig<typeof import("@/lib/date-kst")>()), kstToday: () => "2026-11-06" }));

import { timelineRefreshCandidates } from "./flow-records";

/** 원장 2026-11-06 흐름 분석 수리 — 예정 수강은 새 기록이 아니다 · 반영 시점이 앞날인 옛 분석은 남는 자리에서 다시 분석. */
describe("밤 배치 후보(타임라인 흐름)", () => {
  beforeEach(() => {
    pages.length = 0;
    pages.push(
      // 재원생
      [{ id: "s1" }, { id: "s2" }, { id: "s3" }, { id: "s4" }, { id: "s5" }],
      // 저장된 분석: s2 = 반영 시점이 앞날(예정 수강을 셌던 옛 분석) · s3·s4 = 10-01까지
      [
        { student_id: "s2", covered_through: "2026-12-01T00:00:00+00:00" },
        { student_id: "s3", covered_through: "2026-10-01T00:00:00+00:00" },
        { student_id: "s4", covered_through: "2026-10-01T00:00:00+00:00" },
      ],
      // 상담: s3 = 11-01(새 기록) · s4 = 11-20(앞날 — 새 기록 아님)
      [
        { student_id: "s3", consulted_at: "2026-11-01T01:00:00+00:00" },
        { student_id: "s4", consulted_at: "2026-11-20T01:00:00+00:00" },
      ],
      [],
      [],
      // 수강: s4 = 12-01 시작 예정(새 기록 아님)
      [{ student_id: "s4", start_date: "2026-12-01", end_date: null }],
    );
  });
  it("새 기록 있는 학생 → 분석 없는 학생 → 앞날 반영 시점 수리(맨 뒤) · 앞날 기록만 있는 학생은 뽑지 않는다", async () => {
    expect(await timelineRefreshCandidates("t1", 10)).toEqual(["s3", "s1", "s5", "s2"]);
  });
  it("자리가 모자라면 수리 대상이 먼저 빠진다(오늘까지 기록이 없어 매일 다시 뽑힐 수 있는 학생이 앞자리를 먹지 않게)", async () => {
    expect(await timelineRefreshCandidates("t1", 3)).toEqual(["s3", "s1", "s5"]);
  });
});
