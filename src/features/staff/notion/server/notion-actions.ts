"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { tenantViewWriteError } from "@/lib/auth/tenant-view";
import { canWriteTenant, getUserPermMatrix } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logAction } from "@/features/audit/server/log";
import { canAccess } from "@/lib/permissions";
import { humanizeNotionError } from "@/features/staff/notion/notion-tasks";
import type { ContentLine } from "@/features/staff/notion/notion-tasks";
import { notionConfigFor } from "@/lib/notion/client";
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

const NOT_CONFIGURED = "Notion 연동이 설정되지 않았습니다";

// 쓰기 액션 공통 게이트 — 편집(완료/이동/생성)은 직원관리 쓰기 권한(개인 예외 포함) + 이 학원이 Notion 연동 학원일 때만.
// 🔴 Notion 페이지 id는 브라우저가 보낸 값이다 — 연동 학원 확인 없이 쓰면 다른 학원이 그 워크스페이스 업무를 고친다.
async function requireEditor(): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(actor.systemRole, "staff"))) return { ok: false, error: "편집 권한이 없습니다" };
  if (!notionConfigFor(actor.tenantId)) return { ok: false, error: NOT_CONFIGURED };
  return { ok: true };
}

// 읽기 액션 공통 게이트 — 직원관리 열람 권한 + 연동 학원.
async function requireReader(): Promise<{ ok: true; tenantId: string; displayName: string } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getUserPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  if (!notionConfigFor(actor.tenantId)) return { ok: false, error: NOT_CONFIGURED };
  return { ok: true, tenantId: actor.tenantId, displayName: actor.displayName };
}

// 클라(월간뷰)에서 호출하는 서버 액션 — 월 이동/매핑. 권한은 tenant-aware 매트릭스로 게이트([[#58]]). RLS가 테넌트 격리.

/** 월간 업무 조회 — 직원관리 열람 권한 필요. 월 이동 시 클라가 재호출. */
export async function getStaffMonthlyTasks(
  staffId: string,
  month: string,
): Promise<MonthlyTasksResult> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getUserPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  try {
    // 연동 학원이 아니면 resolveMonthlyTasks가 API 호출 없이 'not_configured'를 돌려준다(화면이 그 상태를 그린다).
    return await resolveMonthlyTasks(staffId, month, actor.tenantId);
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * 미매핑 직원의 매핑 준비(지연 호출) — 이메일 자동연결 시도(+저장) 또는 수동 후보 목록.
 * 담당자 스캔(수 초)이 여기서 돌므로 첫 페인트를 안 막는다.
 * 🔴 열람은 읽기 권한으로 들어오지만 **자동연결 저장과 후보 목록은 직원관리 쓰기 권한만**(canWriteTenant(staff)) —
 *    읽기 권한이면 저장 없이 'none'을 돌려준다(원장 2026-11-05, prepareStaffNotionMappingRow 주석).
 */
export async function prepareNotionMapping(
  staffId: string,
): Promise<{ ok: true; prep: MappingPrep } | { ok: false; error: string }> {
  const actor = await getCurrentUser();
  if (!actor) return { ok: false, error: "로그인이 필요합니다" };
  const matrix = await getUserPermMatrix();
  if (!canAccess(actor.systemRole, "staff", matrix)) return { ok: false, error: "권한이 없습니다" };
  if (!notionConfigFor(actor.tenantId)) return { ok: false, error: NOT_CONFIGURED };
  // 이메일 자동연결은 수동 연결과 **같은 컬럼**(users.notion_user_id)을 말없이 바꾼다 — 바꾸기 전
  // 상태를 먼저 읽어, 비어 있던 사람이 matched로 돌아온 경우에만 남긴다. 이미 연결돼 있던 걸 다시
  // 연 것까지 세면 다이얼로그를 열 때마다 "연결함"이 쌓여 없던 변경을 주장하게 된다.
  // 못 읽었으면 남기지 않는다 — 거짓 기록보다 빠진 기록이 낫다.
  let wasUnmapped = false;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("users")
      .select("notion_user_id")
      .eq("id", staffId)
      .maybeSingle();
    const row = data as { notion_user_id?: string | null } | null;
    wasUnmapped = row ? !row.notion_user_id : false;
  } catch {
    wasUnmapped = false;
  }
  try {
    const prep = await prepareStaffNotionMappingRow(
      staffId,
      actor.tenantId,
      await canWriteTenant(actor.systemRole, "staff"), // 저장·후보 노출 게이트(읽기 권한이면 저장하지 않는다)
    );
    if (prep.state === "matched") {
      revalidatePath(`/staff/${staffId}`);
      if (wasUnmapped) {
        await logAction({
          action: "staff_notion_map",
          targetType: "user",
          metadata: { userId: staffId, auto: true, matchedBy: "email" },
        });
      }
    }
    return { ok: true, prep };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 태스크 댓글 목록 — 직원관리 열람 권한. 다이얼로그 열 때 지연 로드. */
export async function getTaskComments(
  pageId: string,
): Promise<{ ok: true; comments: TaskComment[] } | { ok: false; error: string }> {
  const gate = await requireReader();
  if (!gate.ok) return gate;
  try {
    return { ok: true, comments: await fetchTaskComments(pageId, gate.tenantId) };
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
    // 외부(Notion) 데이터를 바꾸는 쓰기 — 우리 DB엔 흔적이 안 남으므로 감사로그가 유일한 근거다.
    // ⚠️ 업무 제목은 클라가 pageId만 넘겨 알 수 없다 — 라벨은 비우고 상세만 metadata.pageId로 남긴다.
    await logAction({
      action: "notion_task_done",
      targetType: "notion_task",
      metadata: { pageId, done },
    });
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
    await logAction({
      action: "notion_task_due_move",
      targetType: "notion_task",
      metadata: { pageId, from: oldDue, to: newDue, ...(oldStart ? { fromStart: oldStart } : {}) },
    });
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
  const actor = await getCurrentUser();
  const cfg = notionConfigFor(actor?.tenantId);
  if (!cfg) return { ok: false, error: NOT_CONFIGURED };
  const dbId = cfg.dbId;
  const notionId = await resolveStaffNotionId(staffId);
  if (!notionId) return { ok: false, error: "이 직원의 Notion 계정이 연결되지 않아 업무를 만들 수 없습니다" };
  try {
    await createStaffTaskRow(dbId, notionId, { ...input, title });
    // 여기선 제목을 알고 있으니 라벨로 남긴다. metadata.userId는 담당 직원(뷰어가 이름으로 해석).
    await logAction({
      action: "notion_task_create",
      targetType: "notion_task",
      targetLabel: title,
      metadata: { userId: staffId, due: input.due, ...(input.start ? { start: input.start } : {}) },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 태스크 본문 — 직원관리 열람 권한. 상세창 열 때 지연 로드(댓글과 함께). */
export async function getTaskContent(
  pageId: string,
): Promise<{ ok: true; lines: ContentLine[] } | { ok: false; error: string }> {
  const gate = await requireReader();
  if (!gate.ok) return gate;
  try {
    return { ok: true, lines: await fetchTaskContent(pageId) };
  } catch (e) {
    return { ok: false, error: humanizeNotionError(e instanceof Error ? e.message : String(e)) };
  }
}

/** 태스크에 댓글 작성 — 직원관리 열람 권한. aywa 작성자명이 접두로 붙어 출처 보존. */
export async function addTaskCommentAction(
  pageId: string,
  text: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await requireReader();
  if (!gate.ok) return gate;
  // 🔴 이 액션은 **읽기 문**(requireReader)을 지난다 — 댓글은 직원관리를 볼 수 있는 사람이면 남길 수 있어서다. 그런데 운영 콘솔의
  //    '지점 보기'(읽기 전용)도 읽기 문은 통과하므로, 여기서 따로 거절한다(안 하면 그 지점의 노션에 댓글이 실제로 써진다).
  const viewError = await tenantViewWriteError();
  if (viewError) return { ok: false, error: viewError };
  const t = text.trim();
  if (!t) return { ok: false, error: "댓글 내용을 입력하세요" };
  try {
    await addTaskComment(pageId, t.slice(0, 1800), gate.displayName || "직원");
    // 🔴 댓글 본문은 담지 않는다(내용은 Notion이 갖는다) — 남긴 사실과 길이까지만.
    await logAction({
      action: "notion_task_comment",
      targetType: "notion_task",
      metadata: { pageId, length: t.length },
    });
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
  if (!actor || !(await canWriteTenant(actor.systemRole, "staff"))) return { ok: false, error: "권한이 없습니다" };
  if (!notionConfigFor(actor.tenantId)) return { ok: false, error: NOT_CONFIGURED };
  const nextId = notionUserId?.trim() || null;
  const res = await setStaffNotionUserIdRow(staffId, nextId, actor.tenantId);
  if (res.ok) {
    revalidatePath(`/staff/${staffId}`);
    await logAction({
      action: "staff_notion_map",
      targetType: "user",
      metadata: { userId: staffId, notionUserId: nextId, cleared: nextId === null },
    });
  }
  return res;
}
