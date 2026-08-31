"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { MONTH_RE } from "@/features/class-sheets/lib/month";
import { normalizeMcsMonthView, type McsMonthView } from "../view-prefs";
import { requireMcsClassAccess } from "./access";

/**
 * MCS 서버 액션 — **쓰기 경로는 목표 하나뿐**이다. 실제 진도(교재·진도·과제)는 원스크린이
 * `lesson_reports`에 쓰고 MCS는 읽기만 한다(같은 사실을 두 곳에서 쓰면 어느 쪽이 진실인지 알 수 없다).
 *
 * ⚠️ `"use server"` 파일은 **async 함수만 export**할 수 있다([[#119]] — 동기 헬퍼에 export를 붙이면
 *    typecheck·lint·테스트를 다 통과하고 **빌드만** 깨진다). 순수 판정은 전부 `../lib/*`에 있다.
 */
const MAX_LEN = 500;

function clean(v: string | null): string | null {
  const s = (v ?? "").trim();
  if (!s) return null;
  return s.slice(0, MAX_LEN);
}

export type GoalSaveResult = { ok: true } | { ok: false; error: string };

/**
 * 학생 한 명의 그 달 목표 저장 — 값이 둘 다 비면 **행을 지운다**(ECS `upsertGoal`과 같은 규약:
 * 빈 목표 행을 남기면 "목표를 정했다"와 "지웠다"가 구분되지 않는다).
 *
 * 🔴 게이트는 `requireMcsClassAccess(write)` 하나 — 화면 조건은 게이트가 아니다([[#77]]).
 * ⚠️ upsert 대상은 0237a의 **일반 유니크**(부분 유니크 금지 — [[#113]]).
 */
export async function upsertStudentGoal(input: {
  classId: string;
  studentId: string;
  month: string;
  textbook: string | null;
  targetProgress: string | null;
}): Promise<GoalSaveResult> {
  const gate = await requireMcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  if (!MONTH_RE.test(input.month)) return { ok: false, error: "달 형식이 올바르지 않습니다" };
  const { from } = monthRange(input.month);

  const textbook = clean(input.textbook);
  const targetProgress = clean(input.targetProgress);
  const admin = createAdminClient();

  // 🔴 학생이 **이 반 명단**인지 확인 — classId만 믿으면 남의 반 학생 id로 행을 만들 수 있다.
  const { data: enr, error: enrErr } = await admin
    .from("enrollments")
    .select("id")
    .eq("tenant_id", access.tenantId)
    .eq("class_id", access.classId)
    .eq("student_id", input.studentId)
    .limit(1);
  if (enrErr) return { ok: false, error: enrErr.message };
  if (!enr || enr.length === 0) return { ok: false, error: "이 반 학생이 아닙니다" };

  if (!textbook && !targetProgress) {
    const { error } = await admin
      .from("math_month_goals")
      .delete()
      .eq("tenant_id", access.tenantId)
      .eq("class_id", access.classId)
      .eq("student_id", input.studentId)
      .eq("period_start", from);
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from("math_month_goals").upsert(
      {
        tenant_id: access.tenantId,
        class_id: access.classId,
        student_id: input.studentId,
        period_start: from,
        textbook,
        target_progress: targetProgress,
        updated_by: access.user.id,
      },
      { onConflict: "tenant_id,class_id,student_id,period_start" },
    );
    if (error) return { ok: false, error: error.message };
  }

  await logAction({
    action: "mcs_goal_update",
    targetType: "class",
    targetLabel: access.className,
    // ⚠️ 목표 **값**(교재명)은 남기지 않는다 — 감사로그는 "누가 언제 무엇을 건드렸나"지 내용 사본이 아니다.
    metadata: { studentId: input.studentId, month: input.month, cleared: !textbook && !targetProgress },
  });

  revalidatePath(`/mcs/${access.classId}/month`);
  return { ok: true };
}

/** 마지막에 본 보기(진도표 / 진도 레일) — 계정 귀속. 반 게이트가 아니라 로그인만 본다. */
export async function setMyMcsMonthView(raw: string): Promise<{ ok: boolean; error?: string }> {
  const view: McsMonthView = normalizeMcsMonthView(raw);
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const admin = createAdminClient();
  const { data: row, error: readErr } = await admin
    .from("users")
    .select("ui_prefs")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (readErr) return { ok: false, error: readErr.message };

  const raw0 =
    row?.ui_prefs && typeof row.ui_prefs === "object" && !Array.isArray(row.ui_prefs)
      ? (row.ui_prefs as Record<string, unknown>)
      : {};
  const ns =
    raw0.mcs && typeof raw0.mcs === "object" && !Array.isArray(raw0.mcs)
      ? { ...(raw0.mcs as Record<string, unknown>) }
      : {};
  ns.monthView = view;

  const { error } = await admin
    .from("users")
    .update({ ui_prefs: { ...raw0, mcs: ns } })
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
