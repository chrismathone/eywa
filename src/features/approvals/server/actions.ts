"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { leavePeriodLabel, resolveLeavePeriod } from "@/features/leave/accrual";
import {
  countLeaveDays,
  formatLeaveDays,
  isLeaveKind,
  validateLeaveRange,
  type LeaveKind,
} from "@/features/leave/request-days";
import { approverCandidateIds } from "../access";
import { nextDocNo } from "../doc-no";
import { normalizeLine, normalizeRefs, validateApprovalLine } from "../line";
import { APPROVAL_FORM_LABEL, stepRoleLabels } from "../types";

/**
 * 전자결재 쓰기 — 기안·결재·회수.
 *
 * 🔴 **쓰기는 모두 여기서만** — 0213a는 authenticated 쓰기 정책을 두지 않았다(RLS는 읽기 격리 전용).
 *    ① 잔여 연차 검증과 ② 순차 단계 진행이 서버 판단이라, 클라가 행을 직접 만들 수 있으면 규칙이 뚫린다.
 * ⚠️ admin(service_role)은 RLS를 우회하므로 **모든 쿼리에 `tenant_id` 명시 필터**([[#104]]).
 * ⚠️ 게이트는 화면과 **같은 함수**(`canWriteTenant(role, "approvals")`) — 파일럿 명단이 권한 매트릭스에
 *    개인 예외로 얹혀 있어 사이드바·페이지·액션이 한 판정을 공유한다([[#77]]).
 */

export type ApprovalActionState = { ok?: true; error?: string; notice?: string } | undefined;

const MAX_TEXT = 500;
const DOC_NO_RETRY = 3;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 폼의 JSON id 배열(`["uuid", …]`)을 안전하게 파싱 — 형식이 깨졌으면 빈 배열(검증이 걸러낸다). */
function parseIds(raw: FormDataEntryValue | null): string[] {
  try {
    const v = JSON.parse(String(raw ?? "[]"));
    return Array.isArray(v) ? v.map(String).filter((id) => UUID_RE.test(id)) : [];
  } catch {
    return [];
  }
}

async function requireApprovalWriter() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "approvals"))) {
    return { error: "전자결재 권한이 없습니다" as const };
  }
  return { user };
}

/** 이 구간에서 이미 잡아 둔 연차(승인 + 진행중). 진행중도 빼야 같은 연차를 두 번 올리지 못한다. */
async function reservedLeaveDays(args: {
  tenantId: string;
  userId: string;
  periodStart: string;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leave_forms")
    .select("days, doc:approval_documents!leave_forms_document_id_fkey(status)")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    .eq("period_start", args.periodStart)
    .limit(500); // 한 사람·한 구간(1년)이라 상한에 닿지 않는다(절단 방지용 명시 상한, B2)
  if (error) throw new Error(`잔여 연차 확인 실패 — ${error.message}`);
  const total = (data ?? []).reduce((acc, r) => {
    const status = (r as { doc?: { status?: string } | null }).doc?.status;
    return status === "approved" || status === "pending" ? acc + Number(r.days ?? 0) : acc;
  }, 0);
  return Math.round(total * 10) / 10;
}

/**
 * 휴가신청서 기안(상신). 잔여를 넘으면 **접수 자체를 거절한다**(원장 2026-08-14:
 * *"자동반려 필요없고 잔여없으면 신청 자체를 못하자나 어차피"*).
 */
export async function submitLeaveDraft(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const kindRaw = String(formData.get("kind") ?? "annual");
  const kind: LeaveKind = isLeaveKind(kindRaw) ? kindRaw : "annual";
  const start = String(formData.get("startDate") ?? "").trim();
  const end = kind === "half" ? start : String(formData.get("endDate") ?? "").trim() || start;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, MAX_TEXT) || null;

  const admin = createAdminClient();
  const { data: me } = await admin
    .from("users")
    .select("hire_date")
    .eq("id", user.id)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  const hireDate = (me?.hire_date as string | null) ?? null;

  const today = kstToday();
  const period = resolveLeavePeriod(hireDate, start || today, today);
  if (!period) {
    return {
      error: "입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 등록을 요청하세요",
    };
  }

  const invalid = validateLeaveRange({ start, end, kind, periodEnd: period.end });
  if (invalid) return { error: invalid };
  const days = countLeaveDays(start, end, kind);

  // 결재선·참조 — 기안자가 편집기에서 지정한 값(하이웍스 대응). 폼 조작 방어는 순수 검증(line.ts)이
  // 후보 풀과 대조해서 한다 — 명단 밖 결재자는 메뉴가 없어 문서가 그 칸에서 영원히 멈춘다.
  const line = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, line, parseIds(formData.get("refIds")));
  const lineInvalid = validateApprovalLine({
    drafterId: user.id,
    approverIds: line,
    refIds: refs,
    candidateIds: approverCandidateIds(),
  });
  if (lineInvalid) return { error: lineInvalid };

  let reserved: number;
  try {
    reserved = await reservedLeaveDays({ tenantId: user.tenantId, userId: user.id, periodStart: period.start });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "잔여 연차 확인 실패" };
  }
  const remaining = Math.max(0, Math.round((period.granted - reserved) * 10) / 10);
  if (days > remaining) {
    return {
      error:
        remaining <= 0
          ? `남은 연차가 없습니다 (${period.label} 부여 ${formatLeaveDays(period.granted)} 전부 사용·결재중)`
          : `잔여 연차 ${formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다 (신청 ${formatLeaveDays(days)})`,
    };
  }

  const title = `${APPROVAL_FORM_LABEL.leave} — ${start}${end !== start ? ` ~ ${end}` : ""} ${formatLeaveDays(days)}`;

  // 문서번호 채번 — 그 해 그 양식의 개수에서 잇는다. 동시 기안이 같은 번호를 잡으면 unique가 막고 재시도.
  const year = today.slice(0, 4);
  const { count } = await admin
    .from("approval_documents")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", user.tenantId)
    .eq("form_type", "leave")
    .like("doc_no", `%-${year}-%`);

  let docId: string | null = null;
  let lastError = "";
  for (let attempt = 0; attempt < DOC_NO_RETRY && !docId; attempt += 1) {
    const { data, error } = await admin
      .from("approval_documents")
      .insert({
        tenant_id: user.tenantId,
        doc_no: nextDocNo("leave", today, count ?? 0, attempt),
        form_type: "leave",
        title,
        drafter_id: user.id,
        status: "pending",
        current_step: 1,
      })
      .select("id, doc_no")
      .single();
    if (data) docId = data.id as string;
    else {
      lastError = error?.message ?? "";
      if (!/23505|duplicate key/i.test(lastError)) break; // 번호 충돌이 아니면 재시도 무의미
    }
  }
  if (!docId) {
    const missing = /does not exist|Could not find the table|PGRST205/i.test(lastError);
    return {
      error: missing
        ? "전자결재 표가 아직 준비되지 않았습니다(마이그레이션 0213a 적용 필요)"
        : `상신 실패 — ${lastError || "알 수 없는 오류"}`,
    };
  }

  // 결재선·참조·양식 상세를 붙인다. 하나라도 실패하면 문서를 지운다(결재선 없는 유령 문서 방지).
  const roles = stepRoleLabels(line.length);
  const inserts = await Promise.all([
    admin.from("approval_steps").insert(
      line.map((approverId, i) => ({
        tenant_id: user.tenantId,
        document_id: docId,
        step_no: i + 1,
        approver_id: approverId,
        role_label: roles[i] ?? "승인",
      })),
    ),
    admin.from("leave_forms").insert({
      document_id: docId,
      tenant_id: user.tenantId,
      user_id: user.id,
      leave_kind: kind,
      start_date: start,
      end_date: end,
      days,
      reason,
      period_start: period.start,
      period_end: period.end,
      granted_days: period.granted,
    }),
    refs.length > 0
      ? admin.from("approval_refs").insert(
          refs.map((userId) => ({ tenant_id: user.tenantId, document_id: docId, user_id: userId })),
        )
      : Promise.resolve({ error: null }),
  ]);
  const insertErr = inserts.find((r) => r.error)?.error;
  if (insertErr) {
    await admin.from("approval_documents").delete().eq("id", docId).eq("tenant_id", user.tenantId);
    return { error: `상신 실패 — ${insertErr.message}` };
  }

  // 순차 결재라 **1단계 결재자에게만** 알린다(뒤 차례는 자기 차례가 되면 알림을 받는다).
  const firstApprover = line[0];
  if (firstApprover) {
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: firstApprover,
        type: "approval_requested",
        title: "결재 요청",
        body: `${user.displayName} · ${title}`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
    ]);
  }
  await logAction({
    action: "approval_submit",
    targetType: "approval_document",
    targetLabel: title,
    metadata: { days, remaining, granted: period.granted, period: leavePeriodLabel(period) },
  });
  revalidatePath("/approvals");
  return {
    ok: true,
    notice: `상신했습니다 — 결재 ${line.length}단계${refs.length > 0 ? ` · 참조 ${refs.length}명` : ""}`,
  };
}

/**
 * 결재 처리(승인·반려). **내 차례일 때만** 가능하다 — 자격의 근거는 명단이 아니라
 * 문서의 `current_step`과 동결된 결재선이다.
 * 승인 = 다음 단계로(마지막이면 문서 승인) · 반려 = 즉시 문서 반려(뒤 단계는 건너뛴다).
 */
export async function decideDocument(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const docId = String(formData.get("documentId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "");
  const comment = String(formData.get("comment") ?? "").trim().slice(0, MAX_TEXT) || null;
  if (!docId) return { error: "결재할 문서를 찾을 수 없습니다" };
  if (decision !== "approved" && decision !== "rejected") return { error: "승인 또는 반려를 선택하세요" };

  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("approval_documents")
    .select("id, title, drafter_id, status, current_step")
    .eq("id", docId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!doc) return { error: "문서를 찾을 수 없습니다" };
  if (doc.status !== "pending") return { error: "이미 처리된 문서입니다" };
  if (doc.drafter_id === user.id) return { error: "본인이 올린 문서는 결재할 수 없습니다" };

  const { data: steps } = await admin
    .from("approval_steps")
    .select("id, step_no, approver_id, decision")
    .eq("document_id", docId)
    .order("step_no", { ascending: true });
  const line = steps ?? [];
  const myStep = line.find((s) => s.step_no === doc.current_step);
  if (!myStep || myStep.approver_id !== user.id) return { error: "지금은 내 결재 차례가 아닙니다" };
  if (myStep.decision !== "pending") return { error: "이미 결재한 문서입니다" };

  const now = new Date().toISOString();
  const { error: stepErr } = await admin
    .from("approval_steps")
    .update({ decision, decided_at: now, comment })
    .eq("id", myStep.id)
    .eq("decision", "pending"); // 동시 클릭 방어 — 이미 처리된 칸은 안 덮는다
  if (stepErr) return { error: `결재 저장 실패 — ${stepErr.message}` };

  const isLast = doc.current_step >= line.length;
  const approved = decision === "approved";
  const patch = approved
    ? isLast
      ? { status: "approved", completed_at: now, outcome_note: `최종 승인 — ${user.displayName}` }
      : { current_step: doc.current_step + 1 }
    : { status: "rejected", completed_at: now, outcome_note: `반려 — ${user.displayName}${comment ? ` (${comment})` : ""}` };

  const { error: docErr } = await admin
    .from("approval_documents")
    .update(patch)
    .eq("id", docId)
    .eq("tenant_id", user.tenantId);
  if (docErr) return { error: `문서 상태 갱신 실패 — ${docErr.message}` };

  if (approved && !isLast) {
    // 다음 차례 결재자에게만 알린다.
    const next = line.find((s) => s.step_no === doc.current_step + 1);
    if (next) {
      await notifyUsers([
        {
          tenantId: user.tenantId,
          recipientId: next.approver_id as string,
          type: "approval_requested",
          title: "결재 요청",
          body: `${doc.title}`,
          link: `/approvals/${docId}`,
          actorId: user.id,
        },
      ]);
    }
  } else {
    // 문서가 끝났다 — 기안자 + **참조자**에게 알린다(참조는 하이웍스처럼 결말을 받아본다).
    const { data: refRows } = await admin
      .from("approval_refs")
      .select("user_id")
      .eq("document_id", docId)
      .eq("tenant_id", user.tenantId);
    const outcome = approved ? "승인" : "반려";
    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: doc.drafter_id as string,
        type: "approval_decided",
        title: `결재 ${outcome}`,
        body: `${doc.title} — ${outcome}되었습니다`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      },
      ...((refRows ?? []).map((r) => ({
        tenantId: user.tenantId,
        recipientId: r.user_id as string,
        type: "approval_decided" as const,
        title: `참조 문서 ${outcome}`,
        body: `${doc.title} — ${outcome}으로 종결되었습니다 (참조)`,
        link: `/approvals/${docId}`,
        actorId: user.id,
      }))),
    ]);
  }

  await logAction({
    action: "approval_decide",
    targetType: "approval_document",
    targetLabel: `${doc.title} · ${approved ? "승인" : "반려"}`,
    metadata: { docId, decision, step: doc.current_step },
  });
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${docId}`);
  return {
    ok: true,
    notice: approved
      ? isLast
        ? "최종 승인했습니다"
        : "승인했습니다 — 다음 결재자에게 넘어갔습니다"
      : "반려했습니다",
  };
}

/** 기안 회수 — 진행중이고 **아직 아무도 승인하지 않았을 때만**(한 번 결재된 문서는 기록으로 남긴다). */
export async function withdrawDocument(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const docId = String(formData.get("documentId") ?? "").trim();
  if (!docId) return { error: "회수할 문서를 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: steps } = await admin
    .from("approval_steps")
    .select("decision")
    .eq("document_id", docId);
  if ((steps ?? []).some((s) => s.decision !== "pending")) {
    return { error: "이미 결재가 시작돼 회수할 수 없습니다" };
  }

  const { data: updated, error } = await admin
    .from("approval_documents")
    .update({
      status: "canceled",
      completed_at: new Date().toISOString(),
      outcome_note: "기안자 회수",
    })
    .eq("id", docId)
    .eq("tenant_id", user.tenantId)
    .eq("drafter_id", user.id) // 남의 문서는 못 건드린다
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { error: `회수 실패 — ${error.message}` };
  if (!updated) return { error: "진행중인 본인 기안만 회수할 수 있습니다" };

  await logAction({
    action: "approval_withdraw",
    targetType: "approval_document",
    targetLabel: docId,
  });
  revalidatePath("/approvals");
  revalidatePath(`/approvals/${docId}`);
  return { ok: true, notice: "기안을 회수했습니다" };
}

// ── 자주 쓰는 결재선(개인 템플릿, 하이웍스 대응) ─────────────────────────────

/**
 * 현재 결재선을 이름 붙여 저장(같은 이름은 덮어쓴다 — upsert). 저장 시점에도 검증해서
 * 애초에 못 쓸 결재선(풀 밖·상한 초과)이 템플릿으로 남지 않게 한다.
 */
export async function saveLineTemplate(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!name) return { error: "결재선 이름을 입력하세요" };
  const approvers = normalizeLine(user.id, parseIds(formData.get("approverIds")));
  const refs = normalizeRefs(user.id, approvers, parseIds(formData.get("refIds")));
  const invalid = validateApprovalLine({
    drafterId: user.id,
    approverIds: approvers,
    refIds: refs,
    candidateIds: approverCandidateIds(),
  });
  if (invalid) return { error: invalid };

  const admin = createAdminClient();
  const { error } = await admin.from("approval_line_templates").upsert(
    {
      tenant_id: user.tenantId,
      owner_id: user.id,
      name,
      approver_ids: approvers,
      ref_ids: refs,
    },
    { onConflict: "tenant_id,owner_id,name" },
  );
  if (error) {
    const missing = /does not exist|Could not find the table|PGRST205/i.test(error.message);
    return {
      error: missing
        ? "전자결재 표가 아직 준비되지 않았습니다(마이그레이션 0213a 적용 필요)"
        : `결재선 저장 실패 — ${error.message}`,
    };
  }
  revalidatePath("/approvals/new");
  return { ok: true, notice: `결재선 '${name}'을(를) 저장했습니다` };
}

/** 내 템플릿 삭제 — 본인 것만(owner_id 필터). */
export async function deleteLineTemplate(
  _prev: ApprovalActionState,
  formData: FormData,
): Promise<ApprovalActionState> {
  const gate = await requireApprovalWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const id = String(formData.get("templateId") ?? "").trim();
  if (!id) return { error: "삭제할 결재선을 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("approval_line_templates")
    .delete()
    .eq("id", id)
    .eq("tenant_id", user.tenantId)
    .eq("owner_id", user.id) // 남의 템플릿은 못 지운다
    .select("id")
    .maybeSingle();
  if (error) return { error: `삭제 실패 — ${error.message}` };
  if (!data) return { error: "본인이 저장한 결재선만 삭제할 수 있습니다" };
  revalidatePath("/approvals/new");
  return { ok: true, notice: "저장된 결재선을 삭제했습니다" };
}
