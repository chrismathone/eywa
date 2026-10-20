import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/http/secret-compare";
import { kstToday } from "@/lib/date-kst";
import { reportError } from "@/lib/observability/report-error";
import { recordStudentDailyStats } from "@/features/students/stats/server/daily-snapshot";

/**
 * **원생 매일 기록** cron(매일 23:55 KST) — 지점마다 그날 재원생 구성을 `student_daily_stats`(0381a)에 남긴다.
 * 원장 2026-10-20 *"오늘부터 기록 시작"* — 학년·학교·휴원은 지금 값만 저장돼 지난 흐름을 되살릴 수 없으니, 오늘부터 쌓는다.
 * 하루의 **마지막 상태**를 남기려고 자정 직전에 돈다(00:05 퇴원 예약 처리 전 · 그날 날짜로). 같은 날 다시 돌면 덮어쓴다.
 * ⚠️ 0381a 미적용이면 지점마다 실패로 남는다(화면은 안 죽는다 — 이 표는 cron만 쓴다).
 * 같은 길에 원생 통계 '지난 기록'의 에이와 쪽 월별 값(0385a `student_history_monthly`, source = 'aywa')도 다시 센다(원장 2026-10-20).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !bearerMatches(auth, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await recordStudentDailyStats(kstToday());
    if (result.failed.length > 0) {
      reportError(new Error(`원생 매일 기록 실패 지점 ${result.failed.length}곳`), { where: "student-daily-stats", failed: result.failed });
    }
    if (result.historyFailed.length > 0) {
      reportError(new Error(`지난 기록(에이와) 집계 실패 지점 ${result.historyFailed.length}곳`), { where: "student-daily-stats", historyFailed: result.historyFailed });
    }
    return NextResponse.json({ ok: result.failed.length === 0, ...result }, { status: result.failed.length && !result.written ? 500 : 200 });
  } catch (error) {
    reportError(error, { where: "student-daily-stats" });
    return NextResponse.json({ ok: false, error: "원생 매일 기록에 실패했습니다" }, { status: 500 });
  }
}
