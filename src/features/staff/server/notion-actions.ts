"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { canAccess } from "@/lib/permissions";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { humanizeNotionError } from "@/features/staff/notion-tasks";
import {
  resolveMonthlyTasks,
  fetchNotionUserOptions,
  setStaffNotionUserIdRow,
  type MonthlyTasksResult,
  type NotionUserOption,
} from "./notion";

// 클라(월간뷰)에서 호출하는 서버 액션 — 월 이동/매핑. 권한은 tenant-aware 매트릭스로 게이트([[#58]]). RLS가 테넌트 격리.

/** 월간 업무 조회 — 직원관리 열람 권한 필요. 월 이동 시 클라가 재호출. */
export async function getStaffMonthlyTasks(
  staffId: string,
  month: string,
): Promise<MonthlyTasksResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  try {
    return await resolveMonthlyTasks(staffId, month);
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 매핑 드롭다운용 Notion 사람 목록 — 직원 관리 권한(사무실)만. */
export async function listNotionUserOptions(): Promise<
  { ok: true; options: NotionUserOption[] } | { ok: false; error: string }
> {
  const actor = await getCurrentUser();
  if (!actor || !canManageStaff(actor.systemRole)) return { ok: false, error: "권한이 없습니다" };
  try {
    return { ok: true, options: await fetchNotionUserOptions() };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 직원 ↔ Notion 사용자 매핑 저장 — 직원 관리 권한(사무실)만. */
export async function setStaffNotionUserId(
  staffId: string,
  notionUserId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor || !canManageStaff(actor.systemRole)) return { ok: false, error: "권한이 없습니다" };
  const res = await setStaffNotionUserIdRow(staffId, notionUserId?.trim() || null, actor.tenantId);
  if (res.ok) revalidatePath(`/staff/${staffId}`);
  return res;
}
