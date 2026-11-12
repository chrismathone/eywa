"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { monthRange } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { MONTH_RE } from "@/features/class-sheets/lib/month";
import { shiftMonth } from "@/lib/date-kst";
import { parseMcsFontSize } from "../font-size";
import { requireMcsClassAccess } from "./access";
import { explainDbError } from "@/lib/supabase/db-error";
import { writeUiPrefsNs } from "@/lib/ui-prefs/write";

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
  if (enrErr) return { ok: false, error: explainDbError(enrErr, { scope: "math-sheets.actions.upsertStudentGoal", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if (!enr || enr.length === 0) return { ok: false, error: "이 반 학생이 아닙니다" };

  if (!textbook && !targetProgress) {
    const { error } = await admin
      .from("math_month_goals")
      .delete()
      .eq("tenant_id", access.tenantId)
      .eq("class_id", access.classId)
      .eq("student_id", input.studentId)
      .eq("period_start", from);
    if (error) return { ok: false, error: explainDbError(error, { scope: "math-sheets.actions.upsertStudentGoal", fallback: "삭제하지 못했습니다 — 잠시 후 다시 시도해 주세요", op: "delete" }).message };
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
    if (error) return { ok: false, error: explainDbError(error, { scope: "math-sheets.actions.upsertStudentGoal", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  }

  // 🔑 감사로그는 여기서 남기지 않는다 — 이 저장은 타이핑 디바운스마다 불린다(종전엔 칸 하나에 여러 줄·전후 값
  //    없음). 칸을 떠날 때 **전후 값 한 줄**은 `commitMathGoalEdits`(goal-audit-actions.ts)의 몫이다(원장 결정 2026-09-14).

  revalidatePath(`/mcs/${access.classId}/month`);
  return { ok: true };
}

/**
 * 지난 달 목표를 이 달로 **가져온다** — ECS '내용 복사'의 MCS판(원장 2026-09-01 *"영어처럼 편리한
 * 복사기능도 추가하고"*).
 *
 * 🔴 **빈 칸만 채운다**(ECS `ecs_copy_slot` 0209a와 같은 규약) — 이미 적어 둔 이 달 목표를 덮으면
 *    사람이 방금 정한 것을 기계가 지우는 꼴이다. 덮어쓰기 옵션은 두지 않는다.
 * 🔴 **이 반 명단인 학생만** — 화면이 보낸 id를 그대로 믿지 않고 수강 기록과 교집합을 다시 잡는다.
 *    ⚠️ "달 중간에 나간 학생 제외"는 **화면이 거른다**(`rosterPhase !== "ended"`) — 여기서 다시 거르려면
 *    날짜별 판정을 통째로 다시 해야 하는데, 최악의 결과가 "나간 학생에게 목표 한 줄"이라 그만한 값이
 *    아니다. 게이트가 지키는 것은 **남의 반 학생이 들어오지 않는 것**이고 그건 아래에서 막는다.
 */
export async function copyGoalsFromPreviousMonth(input: {
  classId: string;
  month: string;
  /** 이 달 명단(화면이 그리는 그 학생들) — 서버가 이 안에서만 만든다. */
  studentIds: string[];
}): Promise<{ ok: true; copied: number; skipped: number } | { ok: false; error: string }> {
  const gate = await requireMcsClassAccess(input.classId, { write: true });
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;
  if (!MONTH_RE.test(input.month)) return { ok: false, error: "달 형식이 올바르지 않습니다" };

  const { from: thisStart } = monthRange(input.month);
  const { from: prevStart } = monthRange(shiftMonth(input.month, -1));
  const admin = createAdminClient();

  // 🔴 화면이 보낸 학생 id를 그대로 믿지 않는다 — 이 반 명단과 교집합만 쓴다([[#77]]).
  const { data: enr, error: enrErr } = await admin
    .from("enrollments")
    .select("student_id")
    .eq("tenant_id", access.tenantId)
    .eq("class_id", access.classId);
  if (enrErr) return { ok: false, error: explainDbError(enrErr, { scope: "math-sheets.actions.copyGoalsFromPreviousMonth", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  const inClass = new Set((enr ?? []).map((e) => String(e.student_id)));
  const targets = [...new Set(input.studentIds)].filter((id) => inClass.has(id));
  if (targets.length === 0) return { ok: true, copied: 0, skipped: 0 };

  const [prevRes, curRes] = await Promise.all([
    admin
      .from("math_month_goals")
      .select("student_id, textbook, target_progress")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", access.classId)
      .eq("period_start", prevStart),
    admin
      .from("math_month_goals")
      .select("student_id")
      .eq("tenant_id", access.tenantId)
      .eq("class_id", access.classId)
      .eq("period_start", thisStart),
  ]);
  if (prevRes.error) return { ok: false, error: explainDbError(prevRes.error, { scope: "math-sheets.actions.copyGoalsFromPreviousMonth", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  if (curRes.error) return { ok: false, error: explainDbError(curRes.error, { scope: "math-sheets.actions.copyGoalsFromPreviousMonth", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  const taken = new Set((curRes.data ?? []).map((r) => String(r.student_id)));
  const rows = (prevRes.data ?? [])
    .filter((r) => targets.includes(String(r.student_id)))
    .filter((r) => !taken.has(String(r.student_id)))
    .filter((r) => clean(r.textbook) || clean(r.target_progress))
    .map((r) => ({
      tenant_id: access.tenantId,
      class_id: access.classId,
      student_id: String(r.student_id),
      period_start: thisStart,
      textbook: clean(r.textbook),
      target_progress: clean(r.target_progress),
      updated_by: access.user.id,
    }));

  const skipped = (prevRes.data ?? []).length - rows.length;
  if (rows.length > 0) {
    const { error } = await admin
      .from("math_month_goals")
      .upsert(rows, { onConflict: "tenant_id,class_id,student_id,period_start" });
    if (error) return { ok: false, error: explainDbError(error, { scope: "math-sheets.actions.copyGoalsFromPreviousMonth", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    await logAction({
      action: "mcs_goal_update",
      targetType: "class",
      targetLabel: access.className,
      metadata: { month: input.month, copiedFromPrevMonth: rows.length },
    });
    revalidatePath(`/mcs/${access.classId}/month`);
  }
  return { ok: true, copied: rows.length, skipped };
}

/** `ui_prefs.mcs` 부분 병합 — 보기·글씨 크기가 서로를 덮지 않게 한 곳에서 한다. */
async function patchMyMcsPrefs(patch: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  const { error } = await writeUiPrefsNs(createAdminClient(), { userId: user.id, tenantId: user.tenantId }, "mcs", { set: patch });
  if (error) return { ok: false, error: explainDbError(error, { scope: "math-sheets.actions.patchMyMcsPrefs", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}

// ⚠️ 옛 `setMyMcsMonthView`(보기 저장)는 2026-09-02 보기 탭 폐기와 함께 지웠다 — `ui_prefs.mcs.monthView`가
//    남아 있는 계정이 있어도 아무도 안 읽는다(진도표 하나뿐).

/** 글씨 크기(작음·보통·큼) — 원스크린·ECS와 같은 어휘·같은 배율, 저장만 `mcs` 네임스페이스. */
export async function setMyMcsFontSize(raw: string): Promise<{ ok: boolean; error?: string }> {
  return patchMyMcsPrefs({ fontSize: parseMcsFontSize(raw) });
}
