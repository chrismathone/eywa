import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchInChunks } from "@/lib/supabase/batch";
import { collectAuditNameIds } from "../describe";

// 운영 감사로그 액션 키 + 라벨 — logAction 호출부와 뷰어 필터가 공유.
// ⚠️ 새 logAction 액션 키는 반드시 여기 등록(안 하면 뷰어에 영문 키 원문 노출) + describe.ts에 상세 한글화 추가.
export const AUDIT_ACTIONS = {
  staff_role_change: "역할 변경",
  staff_delete: "직원 삭제",
  invoice_create: "청구서 생성",
  exam_create: "시험 등록",
  exam_delete: "시험 삭제",
  exam_scores: "성적 일괄입력",
  payroll_upsert: "급여 정산",
  withdrawal_update: "퇴원 사유",
  student_import: "학생 일괄 등록",
  class_end_term: "반 종강 처리",
  class_reopen_term: "반 종강 취소",
  class_handover_schedule: "담임 인수인계 예약",
  class_handover_cancel: "담임 인수인계 취소",
  class_handover_apply: "담임 인수인계 적용",
  classroom_auto_assign: "강의실 자동배정",
  owner_settings_update: "학원 설정 변경",
  owner_subject_absorb: "과목 흡수·삭제",
  owner_subject_delete: "과목 삭제(미사용)",
  notice_popup_create: "팝업 공지 생성",
  notice_popup_delete: "팝업 공지 삭제",
  classroom_create: "강의실 추가",
  classroom_delete: "강의실 삭제",
  intake_token_create: "QR 접수 링크 생성",
  resume_view_unlock: "이력서 열람(재인증)",
} as const;
export type AuditActionKey = keyof typeof AUDIT_ACTIONS;

export const auditActionLabel = (a: string): string =>
  (AUDIT_ACTIONS as Record<string, string>)[a] ?? a;

type LogArgs = {
  action: AuditActionKey | string;
  targetType?: string | null;
  targetLabel?: string | null;
  metadata?: Record<string, unknown> | null;
};

/**
 * 고가치 mutation을 감사로그에 기록(INSERT-only). 서버 액션 본 작업 성공 후 호출.
 * RLS createClient라 tenant_id=actor.tenantId 행만 INSERT(정책 통과). best-effort: 실패해도 본 작업 안 막음.
 */
export async function logAction(args: LogArgs): Promise<void> {
  try {
    const user = await getCurrentUser();
    if (!user) return;
    const supabase = await createClient();
    await supabase.from("audit_logs").insert({
      tenant_id: user.tenantId,
      actor_id: user.id,
      actor_name: user.displayName,
      action: args.action,
      target_type: args.targetType ?? null,
      target_label: args.targetLabel ?? null,
      metadata: args.metadata ?? null,
    });
  } catch {
    // 감사 기록 실패는 본 작업을 막지 않음
  }
}

export type AuditLogRow = {
  id: string;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetLabel: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export async function getAuditLogsPage(
  filter: { action?: string },
  page = 1,
  pageSize = 50,
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const supabase = await createClient();
  const from = (page - 1) * pageSize;
  let q = supabase
    .from("audit_logs")
    .select("id, actor_name, action, target_type, target_label, metadata, created_at", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);
  if (filter.action && filter.action !== "all") q = q.eq("action", filter.action);

  const { data, count } = await q;
  return {
    rows: (data ?? []).map((r) => ({
      id: r.id,
      actorName: r.actor_name,
      action: r.action,
      targetType: r.target_type,
      targetLabel: r.target_label,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.created_at,
    })),
    total: count ?? 0,
  };
}

/**
 * 페이지 행들의 metadata에 든 학생/직원 uuid → 표시 이름 일괄 해석(상세 열 한글화).
 * best-effort: 조회 실패해도 뷰어를 막지 않음(이름만 빠진 채 표시).
 */
export async function getAuditNameMap(
  rows: Array<{ metadata: Record<string, unknown> | null }>,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const { studentIds, userIds, classIds } = collectAuditNameIds(rows);
  if (studentIds.length === 0 && userIds.length === 0 && classIds.length === 0) return map;
  try {
    const supabase = await createClient();
    const [students, users, classes] = await Promise.all([
      fetchInChunks<{ id: string; name: string | null }>(studentIds, (c) =>
        supabase.from("students").select("id, name").in("id", c),
      ),
      fetchInChunks<{ id: string; display_name: string | null }>(userIds, (c) =>
        supabase.from("users").select("id, display_name").in("id", c),
      ),
      fetchInChunks<{ id: string; class_name: string | null }>(classIds, (c) =>
        supabase.from("classes").select("id, class_name").in("id", c),
      ),
    ]);
    for (const s of students) if (s.name) map.set(s.id, s.name);
    for (const u of users) if (u.display_name) map.set(u.id, u.display_name);
    for (const k of classes) if (k.class_name) map.set(k.id, k.class_name);
  } catch {
    // 이름 해석은 표시 보강일 뿐 — 실패 시 uuid 항목만 생략된 채 렌더
  }
  return map;
}
