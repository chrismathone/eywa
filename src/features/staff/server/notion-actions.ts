"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getPermMatrix } from "@/lib/auth/perm-matrix";
import { canAccess } from "@/lib/permissions";
import { canManageStaff } from "@/lib/auth/role-hierarchy";
import { humanizeNotionError } from "@/features/staff/notion-tasks";
import type { ContentLine } from "@/features/staff/notion-tasks";
import { notionTasksDatabaseId } from "@/lib/notion/client";
import {
  resolveMonthlyTasks,
  prepareStaffNotionMappingRow,
  setStaffNotionUserIdRow,
  fetchTaskComments,
  addTaskComment,
  fetchTaskContent,
  setTaskDoneRow,
  moveTaskDueRow,
  createStaffTaskRow,
  resolveStaffNotionId,
  type MonthlyTasksResult,
  type MappingPrep,
  type TaskComment,
} from "./notion";

// 쓰기 액션 공통 게이트 — 편집(완료/이동/생성)은 사무실(canManageStaff)만.
async function requireEditor(): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  if (!canManageStaff(actor.systemRole)) return { ok: false, error: "편집 권한이 없습니다" };
  return { ok: true };
}

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

/**
 * 미매핑 직원의 매핑 준비(지연 호출) — 이메일 자동연결 시도(+저장) 또는 수동 후보 목록.
 * 담당자 스캔(수 초)이 여기서 돌므로 첫 페인트를 안 막는다. 후보 목록은 사무실(canManageStaff)만.
 */
export async function prepareNotionMapping(
  staffId: string,
): Promise<{ ok: true; prep: MappingPrep } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  try {
    const prep = await prepareStaffNotionMappingRow(
      staffId,
      actor.tenantId,
      canManageStaff(actor.systemRole),
    );
    if (prep.state === "matched") revalidatePath(`/staff/${staffId}`);
    return { ok: true, prep };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 태스크 댓글 목록 — 직원관리 열람 권한. 다이얼로그 열 때 지연 로드. */
export async function getTaskComments(
  pageId: string,
): Promise<{ ok: true; comments: TaskComment[] } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  try {
    return { ok: true, comments: await fetchTaskComments(pageId) };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 업무완료 토글 → Notion 반영. 편집 권한(사무실)만. */
export async function toggleTaskDone(
  pageId: string,
  done: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  try {
    await setTaskDoneRow(pageId, done);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 마감일 이동(드래그) → Notion 반영. 기간 업무는 시작일도 평행이동. 편집 권한(사무실)만. */
export async function moveTaskDue(
  pageId: string,
  newDue: string,
  oldStart: string | null,
  oldDue: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  try {
    await moveTaskDueRow(pageId, newDue, oldStart, oldDue);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 새 업무 생성(담당자=이 직원) → Notion. 편집 권한(사무실)만. 직원이 Notion 미매핑이면 거부. */
export async function createStaffTask(
  staffId: string,
  input: { title: string; due: string; start?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireEditor();
  if (!gate.ok) return gate;
  const title = input.title.trim();
  if (!title) return { ok: false, error: "업무명을 입력하세요" };
  if (!input.due) return { ok: false, error: "마감일을 선택하세요" };
  const dbId = notionTasksDatabaseId();
  if (!dbId) return { ok: false, error: "Notion 연동이 설정되지 않았습니다" };
  const notionId = await resolveStaffNotionId(staffId);
  if (!notionId) return { ok: false, error: "이 직원의 Notion 계정이 연결되지 않아 업무를 만들 수 없습니다" };
  try {
    await createStaffTaskRow(dbId, notionId, { ...input, title });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 태스크 본문 — 직원관리 열람 권한. 상세창 열 때 지연 로드(댓글과 함께). */
export async function getTaskContent(
  pageId: string,
): Promise<{ ok: true; lines: ContentLine[] } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  try {
    return { ok: true, lines: await fetchTaskContent(pageId) };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 태스크에 댓글 작성 — 직원관리 열람 권한. eywa 작성자명이 접두로 붙어 출처 보존. */
export async function addTaskCommentAction(
  pageId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  const t = text.trim();
  if (!t) return { ok: false, error: "댓글 내용을 입력하세요" };
  try {
    await addTaskComment(pageId, t.slice(0, 1800), actor.displayName || "직원");
    return { ok: true };
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
