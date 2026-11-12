import "server-only";

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import type { MenuKey } from "@/lib/permissions";
import type { RecoveryKind } from "@/lib/recording-recovery";
import { createAdminClient } from "@/lib/supabase/admin";
import { INTERRUPT_REASON_LABEL, parseInterruptReport } from "@/lib/recording-diagnostics-core";

/** 녹음을 시작할 수 있는 메뉴(업로드 티켓과 같은 기준) — 그 녹음을 할 수 없는 사람의 중단 기록은 받지 않는다. */
const RECORDING_MENU: Record<RecoveryKind, MenuKey> = { meeting: "meetings", consultation: "enrollment", "student-consultation": "consultations" };

/** 한 사람이 하루에 남길 수 있는 중단 기록 상한 — 고장 난 브라우저가 감사로그를 채우지 않게. */
const DAILY_CAP = 50;

/**
 * 녹음 중단 진단 한 줄(`recording_interrupted`) — 녹음(백업 id) 하나에 한 번만.
 * 🔴 서버 액션이 아니다 — 셸의 녹음 런타임이 마운트하자마자(남은 녹음 훑기) 부르므로 `POST /api/recordings/interruption`
 *    라우트로만 닿는다(gotchas #137: 셸에서 저절로 부르는 서버 액션은 라우터 작업 큐와 엉켜 Next 기본 오류 화면을 띄운다).
 * 돌려주는 ok=true면 브라우저가 '보고함'을 찍는다(이미 있었어도 true — 다시 보내지 않게). 실패면 다음 접속 때 다시 보낸다.
 * 🔴 행위자 = 로그인한 본인(브라우저가 준 소유자를 믿지 않는다). 운영 콘솔 '지점 보기' 중이면 남기지 않는다(그 지점 사람의 일이 아니다).
 */
export async function recordRecordingInterruption(input: unknown): Promise<{ ok: boolean }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  if (user.tenantView) return { ok: true };
  const report = parseInterruptReport(input);
  if (!report) return { ok: true }; // 고칠 수 없는 입력 — 다시 보내도 같다
  // 그 녹음의 계정이 지금 로그인한 사람이 아니면 적지 않는다 — 브라우저는 다음에 그 계정이 들어왔을 때 다시 보낸다.
  if (report.ownerTenantId !== user.tenantId || report.ownerUserId !== user.id) return { ok: false };
  const level = await accessLevelTenant(user.systemRole, RECORDING_MENU[report.kind]);
  if (level !== "full" && level !== "scoped") return { ok: true }; // 그 녹음을 할 수 없는 계정 — 다시 보내도 같다
  try {
    const admin = createAdminClient();
    const base = () => admin.from("audit_logs").select("id", { count: "exact", head: true })
      .eq("tenant_id", user.tenantId).eq("actor_id", user.id).eq("action", "recording_interrupted");
    const same = await base().eq("metadata->>sessionId", report.sessionId);
    if (same.error) return { ok: false };
    if ((same.count ?? 0) > 0) return { ok: true };
    const today = await base().gte("created_at", new Date(Date.now() - 86400_000).toISOString());
    if (today.error) return { ok: false };
    if ((today.count ?? 0) >= DAILY_CAP) return { ok: true };
    const { error } = await admin.from("audit_logs").insert({
      tenant_id: user.tenantId,
      actor_id: user.id,
      actor_name: user.displayName,
      action: "recording_interrupted",
      target_type: report.kind === "meeting" ? "meeting_recording" : "consultation_recording",
      target_label: INTERRUPT_REASON_LABEL[report.reason],
      // 계정 칸은 행의 tenant_id·actor_id와 같아 싣지 않는다.
      metadata: (({ ownerTenantId: _t, ownerUserId: _u, ...rest }) => rest)(report),
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
