import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rateTrend } from "./rate-trend";
import { parseStatsPeriod } from "@/features/stats/period";
import { ATTENDED_STATUSES } from "@/lib/calc/attendance";

const TODAY = "2026-10-20";
const groupOf = (s: string | null) => (s === "math" || s === "subject_1" ? "math" : s === "english" ? "english" : null);

describe("rateTrend — 등원율 추이", () => {
  it("칸마다 (출석+지각) ÷ 기록 칸 · 기록 없는 칸은 null · 과목 묶음 선 · 과목 관리자는 그 반 과목만(모름은 든다)", () => {
    const rows = [
      { bucket: "2026-10-19", subject: "math", total: 10, attended: 9 },
      { bucket: "2026-10-19", subject: "subject_1", total: 10, attended: 7 },
      { bucket: "2026-10-19", subject: "english", total: 20, attended: 20 },
      { bucket: "2026-10-19", subject: null, total: 4, attended: 2 },
      { bucket: "2026-09-30", subject: "math", total: 5, attended: 5 }, // 기간 밖
    ];
    const t = rateTrend({ rows, period: parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY), groupOf });
    const i = t.keys.indexOf("2026-10-19");
    expect([t.rate[i], t.total[i]]).toEqual([86.4, 44]);
    expect(t.groups.map((g) => [g.group, g.rate[i]])).toEqual([["english", 100], ["math", 80]]);
    expect(t.rate[0]).toBeNull();
    const math = rateTrend({ rows, period: parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY), groupOf, inScope: (s) => !s || groupOf(s) === "math" });
    expect([math.rate[i], math.total[i]]).toEqual([75, 24]);
  });

  it("🔴 RPC(0387a)의 분자 상태 = ATTENDED_STATUSES(출석 + 지각) — 한쪽만 바뀌면 카드와 통계가 갈린다", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0387a_attendance_rate_buckets.sql"), "utf8");
    const listed = [...sql.matchAll(/e\.status in \(([^)]*)\)/g)][0]?.[1]?.match(/'([a-z_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
    expect(new Set(listed)).toEqual(new Set(ATTENDED_STATUSES));
  });
});
