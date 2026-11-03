"use server";

/**
 * 비포클래스체크리스트 — 칸 하나(학생 × 반 × 수업일) 저장.
 * 게이트 = 메뉴 권한 `before_class_checklist`가 **전체**(체크하는 사람)인 계정만 · 다른 강사 뷰·지점 보기는 열람 전용.
 * 대상 = 시험 반 표(`before_class_targets`)에 있는 반 · 그날 그 반 명단에 있는 학생만(클라 값을 믿지 않는다, [[#77]]).
 * 아무것도 체크하지 않은 칸이 되면 줄을 지운다(빈 칸 = 저장 안 한 칸).
 * ⚠️ 칸 자동저장이라 감사로그는 남기지 않는다(audit-coverage EXEMPT · 누가 체크했는지는 행의 checked_by·updated_at).
 * ⚠️ 이 파일은 async 함수만 export한다([[#119]]).
 */
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { readonlyTeacherViewError } from "@/lib/auth/view-as";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidYmd } from "@/lib/date-kst";
import { classDatesInMonth } from "../dates";
import { attendsClassOn } from "../roster";
import { BEFORE_CLASS_CARDS, BEFORE_CLASS_ITEMS, EXCUSE_NOTE_MAX, EXCUSE_REASONS, isBlankCheck, normalizeMissed, type ExcuseReason } from "../items";
import { isMissingColumn } from "./queries";

const inputSchema = z.object({
  classId: z.uuid(),
  studentId: z.uuid(),
  date: z.string().refine(isValidYmd),
  missed: z.array(z.enum(BEFORE_CLASS_ITEMS.map((i) => i.key) as [string, ...string[]])).max(BEFORE_CLASS_ITEMS.length),
  absent: z.boolean(),
  card: z.enum(BEFORE_CLASS_CARDS.map((c) => c.key) as [string, ...string[]]).nullable(),
  // 체크 제외(s2_0016, 원장 2026-11-02) — null = 자동(지난 수업 결석). 옛 화면은 안 보낸다.
  excused: z.boolean().nullable().optional(),
  excuseReason: z.enum(EXCUSE_REASONS.map((r) => r.key) as [string, ...string[]]).nullable().optional(),
  excuseNote: z.string().max(EXCUSE_NOTE_MAX).nullable().optional(),
});

export type SaveBeforeClassInput = z.input<typeof inputSchema>;

export async function saveBeforeClassCheck(input: SaveBeforeClassInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "입력값이 올바르지 않습니다" };
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const roError = await readonlyTeacherViewError();
  if (roError) return { ok: false, error: roError };
  if ((await accessLevelTenant(user.systemRole, "before_class_checklist")) !== "full") {
    return { ok: false, error: "체크할 권한이 없습니다" };
  }

  const { classId, studentId, date, absent } = parsed.data;
  const missed = normalizeMissed(parsed.data.missed);
  const card = parsed.data.card as (typeof BEFORE_CLASS_CARDS)[number]["key"] | null;
  const excused = parsed.data.excused ?? null;
  const excuseReason = (parsed.data.excuseReason ?? null) as ExcuseReason | null;
  // 글은 '기타'일 때만 남긴다(다른 사유로 바꾸면 지운다).
  const excuseNote = excuseReason === "other" ? parsed.data.excuseNote?.trim() || null : null;
  const hasExcuse = excused !== null || excuseReason !== null || excuseNote !== null;
  const admin = createAdminClient();
  const [target, enr, sched] = await Promise.all([
    admin.from("before_class_targets").select("class_id").eq("tenant_id", user.tenantId).eq("class_id", classId).maybeSingle(),
    admin.from("enrollments").select("start_date, end_date, is_transferred, attendance_days")
      .eq("tenant_id", user.tenantId).eq("class_id", classId).eq("student_id", studentId),
    admin.from("class_schedules").select("day_of_week, valid_from, valid_to").eq("tenant_id", user.tenantId).eq("class_id", classId),
  ]);
  if (target.error || enr.error || sched.error) return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  if (!target.data) return { ok: false, error: "체크리스트 대상 반이 아닙니다" };
  // 화면과 같은 판정 — 그 달의 수업일이고(배치 이력 포함) 그날 등원하는 학생만.
  if (!classDatesInMonth(date.slice(0, 7), sched.data ?? []).includes(date)) return { ok: false, error: "이 반의 수업일이 아닙니다" };
  const onRoster = attendsClassOn(enr.data ?? [], date);
  if (!onRoster) return { ok: false, error: "그날 이 반 명단에 없는 학생입니다" };

  const key = { tenant_id: user.tenantId, class_id: classId, student_id: studentId, check_date: date };
  const base = { ...key, missed, absent, card, checked_by: user.id, updated_at: new Date().toISOString() };
  const upsert = (row: Record<string, unknown>) =>
    admin.from("before_class_checks").upsert(row, { onConflict: "tenant_id,class_id,student_id,check_date" });
  let { error } = isBlankCheck({ missed, absent, card, excused, excuseReason, excuseNote })
    ? await admin.from("before_class_checks").delete().match(key)
    : await upsert({ ...base, excused, excuse_reason: excuseReason, excuse_note: excuseNote });
  // 제외 칸(s2_0016)이 아직 없는 DB — 제외를 안 쓴 저장은 옛 모양으로 다시, 제외를 쓴 저장은 안내([[#95]]).
  if (isMissingColumn(error)) {
    if (hasExcuse) return { ok: false, error: "체크 제외는 아직 준비 중입니다(저장 공간 갱신 필요)" };
    ({ error } = await upsert(base));
  }
  if (error) {
    console.error("[before-class] 저장 실패", error);
    return { ok: false, error: "저장하지 못했습니다. 잠시 후 다시 시도해 주세요" };
  }
  return { ok: true };
}
