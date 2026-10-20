import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ratio, reportTrend } from "./report-trend";
import { parseStatsPeriod } from "@/features/stats/period";
import { SENT_STATUS_SUCCESS, UNREAD_GRACE_HOURS } from "@/features/report-admin/unread-filter";

const TODAY = "2026-10-21";
const row = (bucket: string, homework_score: string | null, reports: number, o: Partial<{ subject: string | null; sent: number; read48: number; unread: number }> = {}) => ({
  bucket,
  subject: "math",
  homework_score,
  reports,
  sent: 0,
  read48: 0,
  unread: 0,
  ...o,
});

describe("reportTrend — 학습·학부모 보고 추이", () => {
  it("숙제 판정은 parseHomeworkRate 하나 — 60% 미만이 낮음 · 미제출·0%를 가른다 · 없음·빈칸은 분모에서 빠진다", () => {
    const t = reportTrend({
      rows: [row("2026-10", "100%", 10), row("2026-10", "50%", 2), row("2026-10", "미제출", 1), row("2026-10", "0%", 1), row("2026-10", "없음", 3), row("2026-10", null, 4)],
      period: parseStatsPeriod({}, TODAY),
      tracked: ["math"],
    });
    const i = t.keys.length - 1;
    expect([t.reports[i], t.parsed[i], t.low[i], t.notSubmitted[i], t.zero[i], t.unparsed[i]]).toEqual([21, 14, 4, 1, 1, 7]);
    expect(ratio(t.low[i]!, t.parsed[i]!)).toBe(28.6);
    expect(ratio(1, 0)).toBeNull();
  });

  it("보고서를 쓰는 과목만(비면 좁히지 않음) · 과목 관리자는 그 과목만 · 학부모 확인 칸을 더한다", () => {
    const rows = [row("2026-10-20", "100%", 5, { sent: 5, read48: 3, unread: 1 }), row("2026-10-20", "100%", 4, { subject: "english", sent: 4, read48: 4 })];
    const period = parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY);
    const i = 19;
    expect(reportTrend({ rows, period, tracked: ["math"] }).sent[i]).toBe(5);
    expect(reportTrend({ rows, period, tracked: [] }).sent[i]).toBe(9);
    expect(reportTrend({ rows, period, tracked: [], inScope: (s) => s === "english" }).read48[i]).toBe(4);
  });

  it("🔴 RPC(0388a)의 발송·유예 조건 = 운영실 미확인 판정(unread-filter.ts)", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0388a_lesson_report_buckets.sql"), "utf8");
    expect(sql).toContain(`classnote_status = '${SENT_STATUS_SUCCESS}'`);
    expect(sql).toContain(`interval '${UNREAD_GRACE_HOURS} hours'`);
    expect(sql).toContain("edutrix_share_token is not null or source is null or source <> 'edutrix_import'");
  });
});
