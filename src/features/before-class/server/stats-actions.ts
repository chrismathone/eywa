"use server";

/**
 * 비포클래스체크리스트 — 학생 한 명의 지난 기록(학생 통계 보기, 원장 2026-10-28 *"학생별 통계 … 주간, 월간"*).
 * 게이트 = 메뉴 권한 `before_class_checklist`가 '없음'이 아닌 계정(보기만 해도 된다) · 대상 반만.
 * 범위 = 추적 시작(이 반 첫 체크) ~ 오늘, 최대 6개월. 그 안의 수업일 중 학생이 오던 날만 — 체크가 없는 날은 시트처럼 '모두 해 옴'.
 * 읽기만 한다(감사로그 대상 아님). ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { kstToday, shiftMonth } from "@/lib/date-kst";
import { classDatesInMonth } from "../dates";
import { checkFromRow } from "../items";
import { attendsClassOn } from "../roster";
import { DONE_CHECK, isRecordedDay, type DayRecord } from "../stats";
import { CHECK_COLUMNS, CHECK_COLUMNS_V1, loadTrackingStart } from "./queries";
import { loadAutoExcusedKeys } from "./prev-absence";

const inputSchema = z.object({ classId: z.uuid(), studentId: z.uuid() });
const MAX_MONTHS = 6;

export async function getBeforeClassStudentHistory(
  input: z.input<typeof inputSchema>,
): Promise<{ ok: true; days: DayRecord[]; since: string | null } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if ((await accessLevelTenant(user.systemRole, "before_class_checklist")) === "none") return { ok: false, error: "볼 권한이 없습니다" };
  const { classId, studentId } = parsed.data;
  const today = kstToday();
  const admin = createAdminClient();
  try {
    const [target, trackingStart] = await Promise.all([
      admin.from("before_class_targets").select("class_id").eq("tenant_id", user.tenantId).eq("class_id", classId).maybeSingle(),
      loadTrackingStart(user.tenantId, classId),
    ]);
    if (target.error) throw new Error(target.error.message);
    if (!target.data) return { ok: false, error: "체크리스트 대상 반이 아닙니다" };
    if (!trackingStart) return { ok: true, days: [], since: null };
    const floor = `${shiftMonth(today.slice(0, 7), -(MAX_MONTHS - 1))}-01`;
    const from = trackingStart > floor ? trackingStart : floor;

    const readChecks = (cols: string) => fetchAllPaged((a, b) => admin.from("before_class_checks").select(`check_date, ${cols}`)
      .eq("tenant_id", user.tenantId).eq("class_id", classId).eq("student_id", studentId)
      .gte("check_date", from).lte("check_date", today).order("check_date").range(a, b));
    const [sched, enr, checks, autoKeys] = await Promise.all([
      admin.from("class_schedules").select("day_of_week, valid_from, valid_to").eq("tenant_id", user.tenantId).eq("class_id", classId),
      admin.from("enrollments").select("start_date, end_date, is_transferred, attendance_days")
        .eq("tenant_id", user.tenantId).eq("class_id", classId).eq("student_id", studentId),
      // 제외 칸(s2_0016)이 아직 없으면 옛 칸으로 다시 읽는다([[#95]]).
      // fetchAllPaged는 오류 코드를 글로만 넘긴다 — 옛 칸으로 한 번 더 읽고, 그것도 실패하면 그 오류를 던진다.
      readChecks(CHECK_COLUMNS).catch(() => readChecks(CHECK_COLUMNS_V1)),
      loadAutoExcusedKeys(user.tenantId, [classId], from, today, studentId),
    ]);
    if (sched.error) throw new Error(sched.error.message);
    if (enr.error) throw new Error(enr.error.message);

    const byDate = new Map((checks as unknown as ({ check_date: string } & Parameters<typeof checkFromRow>[0])[])
      .map((c) => [c.check_date, checkFromRow(c)]));
    const days: DayRecord[] = [];
    for (let month = from.slice(0, 7); month <= today.slice(0, 7); month = shiftMonth(month, 1)) {
      for (const date of classDatesInMonth(month, sched.data ?? [])) {
        if (date < from || !isRecordedDay(date, today, trackingStart) || !attendsClassOn(enr.data ?? [], date)) continue;
        const check = byDate.get(date) ?? DONE_CHECK;
        // '지난 수업 결석' 자동 제외는 저장하지 않은 판정이라 여기서 붙인다(화면과 같은 판정).
        days.push({ date, check: autoKeys.has(`${classId}|${studentId}|${date}`) ? { ...check, autoExcused: true } : check });
      }
    }
    // since = 실제로 센 첫날(6개월 상한에 잘렸으면 그 날) — 화면의 "~부터의 기록".
    return { ok: true, days, since: from };
  } catch (e) {
    console.error("[before-class] 학생 기록 조회 실패", e);
    return { ok: false, error: "기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
}
