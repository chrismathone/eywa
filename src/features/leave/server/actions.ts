"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { leavePeriodLabel, resolveLeavePeriod } from "../accrual";
import { approverIdsFor } from "../leave-access";
import {
  countLeaveDays,
  formatLeaveDays,
  isLeaveKind,
  validateLeaveRange,
  type LeaveKind,
} from "../request-days";
import { LEAVE_KIND_LABEL } from "../types";

/**
 * 휴가 신청·결재 액션.
 *
 * 🔴 **쓰기는 모두 여기서만** — 0210a는 authenticated 쓰기 정책을 두지 않았다(RLS는 읽기 격리 전용).
 *    이유 두 가지: ① **잔여 초과 거절**이 서버 계산이라, 클라가 행을 직접 만들 수 있으면 규칙이
 *    우회된다 ② 결재 확정(전원 승인 집계)은 원자적 판단이라 한 곳에서만 해야 한다.
 * ⚠️ admin(service_role)은 RLS를 우회하므로 **모든 쿼리에 `tenant_id` 명시 필터**를 건다([[#104]]).
 * ⚠️ 게이트는 화면과 **같은 함수**(`canWriteTenant(role, "leave")`) — 파일럿 명단은 권한 매트릭스에
 *    개인 예외로 얹혀 있어 사이드바·페이지·액션이 한 판정을 공유한다([[#77]]).
 */

export type LeaveActionState = { ok?: true; error?: string; notice?: string } | undefined;

const MAX_REASON = 500;

async function requireLeaveWriter() {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" as const };
  if (!(await canWriteTenant(user.systemRole, "leave"))) {
    return { error: "휴가관리 권한이 없습니다" as const };
  }
  return { user };
}

/** 그 구간에서 이미 잡아 둔 일수(승인 + 결재 대기). 대기분도 빼야 같은 연차를 두 번 신청하지 못한다. */
async function reservedDays(args: {
  tenantId: string;
  userId: string;
  periodStart: string;
}): Promise<number> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("leave_requests")
    .select("days")
    .eq("tenant_id", args.tenantId)
    .eq("user_id", args.userId)
    .eq("period_start", args.periodStart)
    .in("status", ["pending", "approved"])
    .limit(500); // 한 사람·한 구간(1년)이라 상한에 닿지 않는다(절단 방지용 명시 상한, B2)
  if (error) throw new Error(`잔여 연차 확인 실패 — ${error.message}`);
  const total = (data ?? []).reduce((acc, r) => acc + Number(r.days ?? 0), 0);
  return Math.round(total * 10) / 10;
}

/**
 * 휴가 신청. 잔여를 넘으면 **접수 자체를 거절한다**(원장 2026-08-14: *"자동반려 필요없고 잔여없으면
 * 신청 자체를 못하자나 어차피"*) — 반려 행을 만들어 두면 결재함·내역에 아무도 처리할 수 없는 줄만 쌓인다.
 * ⚠️ 화면도 같은 순간 버튼을 잠그지만(미리 알려주려고), **판정의 근거는 여기**다 — 화면은 게이트가 아니다([[#77]]).
 */
export async function submitLeaveRequest(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const gate = await requireLeaveWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const kindRaw = String(formData.get("kind") ?? "annual");
  const kind: LeaveKind = isLeaveKind(kindRaw) ? kindRaw : "annual";
  const start = String(formData.get("startDate") ?? "").trim();
  // 반차는 하루라 종료일 입력이 없다 — 시작일로 채운다.
  const end = kind === "half" ? start : String(formData.get("endDate") ?? "").trim() || start;
  const reason = String(formData.get("reason") ?? "").trim().slice(0, MAX_REASON) || null;

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
      error: "입사일이 등록되지 않아 연차를 계산할 수 없습니다 — 사무실(직원관리)에 입사일 등록을 요청하세요",
    };
  }

  const invalid = validateLeaveRange({ start, end, kind, periodEnd: period.end });
  if (invalid) return { error: invalid };

  const days = countLeaveDays(start, end, kind);
  const approvers = approverIdsFor(user.id);
  if (approvers.length === 0) {
    return { error: "결재선이 비어 있어 신청을 접수할 수 없습니다 — 관리자에게 문의하세요" };
  }

  let reserved: number;
  try {
    reserved = await reservedDays({ tenantId: user.tenantId, userId: user.id, periodStart: period.start });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "잔여 연차 확인 실패" };
  }
  const remaining = Math.max(0, Math.round((period.granted - reserved) * 10) / 10);
  if (days > remaining) {
    return {
      error:
        remaining <= 0
          ? `남은 연차가 없습니다 (${period.label} 부여 ${formatLeaveDays(period.granted)} 전부 사용·결재 대기 중)`
          : `잔여 연차 ${formatLeaveDays(remaining)}보다 많이 신청할 수 없습니다 (신청 ${formatLeaveDays(days)})`,
    };
  }

  const { data: inserted, error } = await admin
    .from("leave_requests")
    .insert({
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
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !inserted) {
    const missing = /does not exist|Could not find the table|PGRST205/i.test(error?.message ?? "");
    return {
      error: missing
        ? "휴가관리 표가 아직 준비되지 않았습니다(마이그레이션 0210a 적용 필요)"
        : `신청 저장 실패 — ${error?.message ?? "알 수 없는 오류"}`,
    };
  }

  const label = `${LEAVE_KIND_LABEL[kind]} ${formatLeaveDays(days)} (${start}${
    end !== start ? ` ~ ${end}` : ""
  })`;

  // 결재선을 **행으로 동결** — 명단이 나중에 바뀌어도 진행 중인 건의 결재자는 그대로.
  const { error: lineErr } = await admin.from("leave_approvals").insert(
    approvers.map((approverId) => ({
      tenant_id: user.tenantId,
      request_id: inserted.id,
      approver_id: approverId,
      step: 1,
    })),
  );
  if (lineErr) {
    // 결재선 없는 신청서는 영원히 대기한다 — 신청 자체를 되돌린다(고아 행 방지).
    await admin.from("leave_requests").delete().eq("id", inserted.id).eq("tenant_id", user.tenantId);
    return { error: `결재선 생성 실패 — ${lineErr.message}` };
  }

  await notifyUsers(
    approvers.map((approverId) => ({
      tenantId: user.tenantId,
      recipientId: approverId,
      type: "leave_request_submitted" as const,
      title: "휴가 결재 요청",
      body: `${user.displayName} · ${label}`,
      link: "/leave?tab=approvals",
      actorId: user.id,
    })),
  );
  await logAction({
    action: "leave_request_submit",
    targetType: "leave_request",
    targetLabel: label,
    metadata: { days, remaining, granted: period.granted, period: leavePeriodLabel(period) },
  });
  revalidatePath("/leave");
  return { ok: true, notice: `휴가 신청을 접수했습니다 — 결재 대기 ${approvers.length}명` };
}

/**
 * 전자결재 처리(승인·반려). **한 명이라도 반려하면 즉시 반려**, 결재선 전원이 승인하면 승인 확정
 * (병렬 결재 — 0210a 주석). 자기 결재란이 없거나 이미 처리했으면 거부한다.
 */
export async function decideLeaveRequest(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const gate = await requireLeaveWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const requestId = String(formData.get("requestId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim().slice(0, MAX_REASON) || null;
  if (!requestId) return { error: "결재할 신청서를 찾을 수 없습니다" };
  if (decision !== "approved" && decision !== "rejected") return { error: "승인 또는 반려를 선택하세요" };

  const admin = createAdminClient();
  const { data: req } = await admin
    .from("leave_requests")
    .select("id, user_id, status, leave_kind, days, start_date, end_date")
    .eq("id", requestId)
    .eq("tenant_id", user.tenantId)
    .maybeSingle();
  if (!req) return { error: "신청서를 찾을 수 없습니다" };
  if (req.status !== "pending") return { error: "이미 처리된 신청서입니다" };
  if (req.user_id === user.id) return { error: "본인이 낸 신청은 결재할 수 없습니다" };

  // 내 결재란이 실제로 있는지 — **명단이 아니라 동결된 결재선**이 자격의 근거다.
  const { data: myCell } = await admin
    .from("leave_approvals")
    .select("id, decision")
    .eq("request_id", requestId)
    .eq("approver_id", user.id)
    .maybeSingle();
  if (!myCell) return { error: "이 신청서의 결재선에 포함되지 않았습니다" };
  if (myCell.decision !== "pending") return { error: "이미 결재한 신청서입니다" };

  const now = new Date().toISOString();
  const { error: cellErr } = await admin
    .from("leave_approvals")
    .update({ decision, decided_at: now, note })
    .eq("id", myCell.id);
  if (cellErr) return { error: `결재 저장 실패 — ${cellErr.message}` };

  // 내 칸을 쓴 **뒤에** 전체를 다시 읽는다 — 동시 결재라도 마지막 사람이 전원 승인을 본다.
  const { data: cells } = await admin
    .from("leave_approvals")
    .select("decision")
    .eq("request_id", requestId);
  const all = cells ?? [];
  const rejected = decision === "rejected" || all.some((c) => c.decision === "rejected");
  const allApproved = all.length > 0 && all.every((c) => c.decision === "approved");

  let finalStatus: "pending" | "approved" | "rejected" = "pending";
  if (rejected) finalStatus = "rejected";
  else if (allApproved) finalStatus = "approved";

  if (finalStatus !== "pending") {
    const verb = finalStatus === "approved" ? "승인" : "반려";
    await admin
      .from("leave_requests")
      .update({
        status: finalStatus,
        decided_at: now,
        decision_note:
          finalStatus === "approved"
            ? `결재선 전원 승인 (마지막 ${user.displayName})`
            : `${user.displayName} 반려${note ? ` — ${note}` : ""}`,
      })
      .eq("id", requestId)
      .eq("tenant_id", user.tenantId);

    await notifyUsers([
      {
        tenantId: user.tenantId,
        recipientId: req.user_id,
        type: "leave_request_decided",
        title: `휴가 신청 ${verb}`,
        body: `${req.start_date}${req.end_date !== req.start_date ? ` ~ ${req.end_date}` : ""} · ${
          LEAVE_KIND_LABEL[(req.leave_kind === "half" ? "half" : "annual") as LeaveKind]
        } ${formatLeaveDays(Number(req.days ?? 0))} — ${verb}되었습니다`,
        link: "/leave",
        actorId: user.id,
      },
    ]);
  }

  await logAction({
    action: "leave_request_decide",
    targetType: "leave_request",
    targetLabel: `${req.start_date} · ${decision === "approved" ? "승인" : "반려"}`,
    metadata: { requestId, decision, finalStatus },
  });
  revalidatePath("/leave");
  return {
    ok: true,
    notice:
      finalStatus === "pending"
        ? "결재했습니다 — 남은 결재자를 기다립니다"
        : `신청서를 ${finalStatus === "approved" ? "승인" : "반려"}했습니다`,
  };
}

/** 내 신청 취소 — 결재 대기 중일 때만(처리된 건은 기록으로 남긴다). */
export async function cancelLeaveRequest(
  _prev: LeaveActionState,
  formData: FormData,
): Promise<LeaveActionState> {
  const gate = await requireLeaveWriter();
  if ("error" in gate) return { error: gate.error };
  const { user } = gate;

  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!requestId) return { error: "취소할 신청서를 찾을 수 없습니다" };

  const admin = createAdminClient();
  const { data: updated, error } = await admin
    .from("leave_requests")
    .update({ status: "canceled", decided_at: new Date().toISOString(), decision_note: "신청자 취소" })
    .eq("id", requestId)
    .eq("tenant_id", user.tenantId)
    .eq("user_id", user.id) // 남의 신청은 못 건드린다
    .eq("status", "pending") // 이미 처리된 건은 그대로
    .select("id")
    .maybeSingle();
  if (error) return { error: `취소 실패 — ${error.message}` };
  if (!updated) return { error: "결재 대기 중인 본인 신청만 취소할 수 있습니다" };

  await logAction({
    action: "leave_request_cancel",
    targetType: "leave_request",
    targetLabel: requestId,
  });
  revalidatePath("/leave");
  return { ok: true, notice: "신청을 취소했습니다" };
}
