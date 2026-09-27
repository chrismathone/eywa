import { describe, expect, it } from "vitest";
import { toUsageRows, usagePayloadSchema } from "./ingest";

describe("usagePayloadSchema — 비콘 본문 관문", () => {
  it("정상 본문은 통과", () => {
    const ok = usagePayloadSchema.safeParse({ v: 1, items: [{ route: "/students", visits: 1, openSec: 30, activeSec: 20 }] });
    expect(ok.success).toBe(true);
  });

  it("음수·소수·상한 초과·항목 과다·버전 다름은 거절", () => {
    const bad = [
      { v: 1, items: [{ route: "/a", visits: -1, openSec: 1, activeSec: 1 }] },
      { v: 1, items: [{ route: "/a", visits: 1, openSec: 1.5, activeSec: 1 }] },
      { v: 1, items: [{ route: "/a", visits: 1, openSec: 99_999, activeSec: 1 }] },
      { v: 1, items: Array.from({ length: 41 }, () => ({ route: "/a", visits: 1, openSec: 1, activeSec: 1 })) },
      { v: 2, items: [] },
    ];
    for (const b of bad) expect(usagePayloadSchema.safeParse(b).success).toBe(false);
  });
});

describe("toUsageRows — DB 행으로", () => {
  it("정규형이 아닌 주소는 버리고, 메뉴를 서버가 붙인다", () => {
    const rows = toUsageRows([
      { route: "/billing?tab=sessions", visits: 1, openSec: 60, activeSec: 40 },
      { route: "/students/홍길동", visits: 1, openSec: 60, activeSec: 40 },
    ]);
    expect(rows).toEqual([
      { route_key: "/billing?tab=sessions", menu_key: "billing", visits: 1, open_seconds: 60, active_seconds: 40 },
    ]);
  });

  it("셸에 없는 주소는 정규형이어도 버린다 — 지어낸 주소로 행을 늘리지 못하게", () => {
    const rows = toUsageRows([
      { route: "/zzz", visits: 1, openSec: 10, activeSec: 5 },
      { route: "/zzz/aaa", visits: 1, openSec: 10, activeSec: 5 },
      { route: "/", visits: 1, openSec: 10, activeSec: 5 },
    ]);
    expect(rows.map((r) => r.route_key)).toEqual(["/"]);
  });

  it("같은 주소는 합친다(ON CONFLICT가 한 문장에서 같은 행을 두 번 못 고친다)", () => {
    const rows = toUsageRows([
      { route: "/students", visits: 1, openSec: 10, activeSec: 5 },
      { route: "/students", visits: 2, openSec: 20, activeSec: 10 },
    ]);
    expect(rows).toEqual([{ route_key: "/students", menu_key: "students", visits: 3, open_seconds: 30, active_seconds: 15 }]);
  });

  it("활동은 화면 시간을 넘지 않게 자르고, 빈 항목은 뺀다", () => {
    const rows = toUsageRows([
      { route: "/me", visits: 0, openSec: 10, activeSec: 50 },
      { route: "/students", visits: 0, openSec: 0, activeSec: 0 },
    ]);
    expect(rows).toEqual([{ route_key: "/me", menu_key: "other", visits: 0, open_seconds: 10, active_seconds: 10 }]);
  });
});
