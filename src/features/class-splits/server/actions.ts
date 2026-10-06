"use server";

/**
 * 수업 나누기 서버 액션 — 미리보기(고를 수 있는 요일·시각) · 저장(경고 → 확인 → 저장) · 해제.
 * 규칙은 순수부 [`rules.ts`](../rules.ts)·[`period.ts`](../period.ts), 판단 재료는 [`context.ts`](./context.ts).
 *
 * 🔴 게이트 = `canSplitClassNow()` 하나(특수 권한 명단 + super_admin, 열람 전용 뷰 차단) — 팝업과 같은 문([[#77]]).
 * 🔴 고른 시각은 서버가 **같은 재료로 다시 만든** 선택지 안에 있어야 한다(화면을 믿지 않는다).
 * 🔴 경고는 막지 않는다 — `confirm`이 없으면 경고 목록만 돌려주고, 사람이 확인하면 같은 요청을 `confirm: true`로 다시 보낸다.
 */
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { getPeriodWindow } from "@/features/periods/server/queries";
import { CLASS_SPLIT_DENIED_MSG } from "../access";
import { durationLabel, isSplitDay, maxUnitsFrom, SPLIT_DAY_KO, startOptions, toHm, toMin, type SplitDay } from "../rules";
import { dowOf, hasDayInRange, periodText, resolvePeriod, splitsCollide, type PeriodInput } from "../period";
import { canSplitClassNow } from "./gate";
import { loadSplitContext } from "./context";
import { collectSplitWarnings } from "./conflicts";
import { getSplitsTouchingClasses, isMissingSplitTable, toSplit } from "./queries";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const NOT_APPLIED = "수업 나누기 표(0351a)가 아직 적용되지 않았습니다 — 관리자에게 SQL 적용을 요청하세요";

type Target = { studentId: string; sourceClassId: string; targetClassId: string; refDate: string };

export type SplitPreview =
  | {
      ok: true;
      studentName: string;
      source: { name: string; teacherName: string | null };
      target: { name: string; teacherName: string | null };
      unit: number;
      /** 나눌 수 있는 요일과 그날의 시작 시각 선택지("HH:MM") + 시작마다 최대 단위 수. */
      days: { day: SplitDay; starts: { time: string; maxUnits: number }[] }[];
      /** 원래 반 등원 요일([] = 전 요일). */
      attendanceDays: string[];
      today: string;
    }
  | { ok: false; error: string };

function badTarget(t: Target): string | null {
  if (!t.studentId || !t.sourceClassId || !t.targetClassId || !YMD.test(t.refDate)) return "요청이 올바르지 않습니다.";
  if (t.sourceClassId === t.targetClassId) return "같은 반 안에서는 나눌 수 없습니다.";
  return null;
}

export async function previewClassSplit(t: Target): Promise<SplitPreview> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!(await canSplitClassNow())) return { ok: false, error: CLASS_SPLIT_DENIED_MSG };
  const bad = badTarget(t);
  if (bad) return { ok: false, error: bad };
  const today = kstToday();
  const ctx = await loadSplitContext(createAdminClient(), user.tenantId, { ...t, onDate: t.refDate < today ? today : t.refDate });
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!ctx.enrollment) return { ok: false, error: `${ctx.student.name} 학생의 ${ctx.source.name} 수강이 열려 있지 않습니다.` };
  const days = (Object.keys(ctx.windows) as SplitDay[])
    .filter(isSplitDay)
    .map((day) => {
      const w = ctx.windows[day] ?? [];
      return { day, starts: startOptions(w, ctx.unit).map((s) => ({ time: toHm(s), maxUnits: maxUnitsFrom(w, s, ctx.unit) })) };
    })
    .filter((d) => d.starts.length > 0)
    .sort((a, b) => "mon tue wed thu fri sat sun".indexOf(a.day) - "mon tue wed thu fri sat sun".indexOf(b.day));
  if (days.length === 0) {
    return { ok: false, error: `${ctx.source.name}와(과) ${ctx.target.name}이(가) 같은 시간에 도는 요일이 없어 나눌 수 없습니다 — 반 이동을 쓰세요.` };
  }
  return {
    ok: true,
    studentName: ctx.student.name,
    source: { name: ctx.source.name, teacherName: ctx.source.teacherName },
    target: { name: ctx.target.name, teacherName: ctx.target.teacherName },
    unit: ctx.unit,
    days,
    attendanceDays: ctx.enrollment.attendanceDays,
    today,
  };
}

export type CreateSplitInput = Target & {
  days: string[];
  /** "HH:MM" */
  start: string;
  units: number;
  period: { kind: "day"; date: string } | { kind: "month"; month: string } | { kind: "forever"; from: string };
  confirm?: boolean;
};

export type CreateSplitResult =
  | { ok: true; count: number; summary: string }
  | { ok: false; error: string }
  | { ok: false; needsConfirm: true; warnings: string[] };

export async function createClassSplit(input: CreateSplitInput): Promise<CreateSplitResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!(await canSplitClassNow())) return { ok: false, error: CLASS_SPLIT_DENIED_MSG };
  const bad = badTarget(input);
  if (bad) return { ok: false, error: bad };
  const today = kstToday();
  const admin = createAdminClient();

  // 기간 — 월별은 원래 반(수강료 기준)의 세션 창으로 푼다(미정의면 달력월, resolvePeriodWindow 폴백).
  let periodInput: PeriodInput;
  if (input.period.kind === "month") {
    if (!/^\d{4}-\d{2}$/.test(input.period.month)) return { ok: false, error: "달을 골라 주세요." };
    const w = await getPeriodWindow({ period: input.period.month, classId: input.sourceClassId, todayIso: today });
    periodInput = { kind: "month", start: w.start, end: w.end };
  } else periodInput = input.period;
  const period = resolvePeriod(periodInput, today);
  if ("error" in period) return { ok: false, error: period.error };

  const ctx = await loadSplitContext(admin, user.tenantId, { ...input, onDate: period.validFrom });
  if ("error" in ctx) return { ok: false, error: ctx.error };
  if (!ctx.enrollment) return { ok: false, error: `${ctx.student.name} 학생의 ${ctx.source.name} 수강이 ${period.validFrom}에 열려 있지 않습니다.` };

  // 요일 — 일별은 그 날짜의 요일 하나뿐.
  const days = period.kind === "day" ? [dowOf(period.validFrom)] : [...new Set(input.days)];
  if (days.length === 0 || !days.every(isSplitDay)) return { ok: false, error: "요일을 골라 주세요." };
  const start = toMin(input.start);
  const units = Math.floor(Number(input.units));
  if (!Number.isFinite(start) || !(units >= 1)) return { ok: false, error: "시작 시각과 길이를 골라 주세요." };
  const end = start + units * ctx.unit;
  const attend = ctx.enrollment.attendanceDays;
  for (const day of days as SplitDay[]) {
    const w = ctx.windows[day] ?? [];
    if (!startOptions(w, ctx.unit).includes(start) || maxUnitsFrom(w, start, ctx.unit) < units) {
      return { ok: false, error: `${SPLIT_DAY_KO[day]}요일 ${toHm(start)}~${toHm(end)}은 두 반이 같이 도는 시간이 아닙니다.` };
    }
    if (attend.length > 0 && !attend.includes(day)) {
      return { ok: false, error: `${ctx.student.name} 학생은 ${SPLIT_DAY_KO[day]}요일에 ${ctx.source.name}에 오지 않습니다.` };
    }
    if (!hasDayInRange(day, period.validFrom, period.validTo)) {
      return { ok: false, error: `고른 기간 안에 ${SPLIT_DAY_KO[day]}요일이 없습니다.` };
    }
  }

  // 같은 학생·같은 시간을 두 번 나누는 것은 막는다(경고가 아니라 오류 — 출결이 두 반으로 갈린다).
  const { data: mine, error: mineErr } = await admin
    .from("class_splits")
    .select("id, student_id, source_class_id, target_class_id, day_of_week, start_time, end_time, valid_from, valid_to, period_kind, note")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", ctx.student.id);
  if (mineErr) return { ok: false, error: isMissingSplitTable(mineErr) ? NOT_APPLIED : "기존 나눔을 확인하지 못했습니다." };
  const plan = { days: days as SplitDay[], start, end, validFrom: period.validFrom, validTo: period.validTo };
  for (const day of plan.days) {
    const probe = { studentId: ctx.student.id, dayOfWeek: day, startTime: toHm(start), endTime: toHm(end), validFrom: plan.validFrom, validTo: plan.validTo };
    const hit = (mine ?? []).map(toSplit).find((s) => s && splitsCollide(s, probe));
    if (hit) return { ok: false, error: `${SPLIT_DAY_KO[day]}요일 그 시간은 이미 나눠져 있습니다(${periodText(hit)}). 먼저 해제해 주세요.` };
  }

  if (!input.confirm) {
    const incoming = await getSplitsTouchingClasses([ctx.target.id], plan.validFrom, plan.validTo ?? "9999-12-31");
    const warnings = await collectSplitWarnings(admin, user.tenantId, ctx, plan, input.refDate, incoming);
    if (warnings.length > 0) return { ok: false, needsConfirm: true, warnings };
  }

  const rows = plan.days.map((day) => ({
    tenant_id: user.tenantId,
    student_id: ctx.student.id,
    source_class_id: ctx.source.id,
    target_class_id: ctx.target.id,
    day_of_week: day,
    start_time: toHm(start),
    end_time: toHm(end),
    valid_from: plan.validFrom,
    valid_to: plan.validTo,
    period_kind: period.kind,
    created_by: user.id,
  }));
  const { error } = await admin.from("class_splits").insert(rows);
  if (error) {
    if (isMissingSplitTable(error)) return { ok: false, error: NOT_APPLIED };
    if (error.code === "23505") return { ok: false, error: "같은 시간이 이미 나눠져 있습니다." };
    console.error("[class-splits] 저장 실패", error.message);
    return { ok: false, error: "저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  const summary =
    `${ctx.student.name} · ${plan.days.map((d) => SPLIT_DAY_KO[d]).join("·")} ${toHm(start)}~${toHm(end)}(${durationLabel(end - start)}) ` +
    `${ctx.source.name} → ${ctx.target.name} · ${periodText(plan)}`;
  await logAction({
    action: "class_split_create",
    targetType: "student",
    targetLabel: summary,
    metadata: { studentId: ctx.student.id, sourceClassId: ctx.source.id, targetClassId: ctx.target.id, ...plan, start: toHm(start), end: toHm(end) },
  });
  revalidatePath("/timetable");
  return { ok: true, count: rows.length, summary };
}

/**
 * 해제 — 아직 시작 전이면 **지우고**, 이미 시작됐으면 **어제까지로 끝낸다**(지난 날 출결이 어느 반 몫이었는지가 남아야 한다).
 */
export async function endClassSplit(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다." };
  if (!(await canSplitClassNow())) return { ok: false, error: CLASS_SPLIT_DENIED_MSG };
  if (!id) return { ok: false, error: "요청이 올바르지 않습니다." };
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("class_splits")
    .select("id, student_id, source_class_id, target_class_id, day_of_week, start_time, end_time, valid_from, valid_to, period_kind, note")
    .eq("tenant_id", user.tenantId)
    .eq("id", id)
    .maybeSingle();
  if (error) return { ok: false, error: isMissingSplitTable(error) ? NOT_APPLIED : "나눔을 찾지 못했습니다." };
  const s = data ? toSplit(data) : null;
  if (!s) return { ok: false, error: "이미 해제된 나눔입니다." };
  const today = kstToday();
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  if (s.validTo !== null && s.validTo < today) return { ok: false, error: "이미 끝난 나눔입니다." };
  const write =
    s.validFrom < today
      ? admin.from("class_splits").update({ valid_to: yesterday }).eq("tenant_id", user.tenantId).eq("id", id)
      : admin.from("class_splits").delete().eq("tenant_id", user.tenantId).eq("id", id);
  const { error: wErr } = await write;
  if (wErr) {
    console.error("[class-splits] 해제 실패", wErr.message);
    return { ok: false, error: "해제하지 못했습니다. 잠시 뒤 다시 시도해 주세요." };
  }
  await logAction({ action: "class_split_end", targetType: "student", targetLabel: `${SPLIT_DAY_KO[s.dayOfWeek]} ${s.startTime}~${s.endTime} · ${periodText(s)}`, metadata: { ...s } });
  revalidatePath("/timetable");
  return { ok: true };
}
