"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { isAuditResult } from "../audit-result";
import { dateField, idField, textField } from "../form";
import { friendlyInventoryError, requireInventoryWrite } from "./access";

/**
 * 실사 기록 — `inventory_audits` insert + 자산 `last_audited_on` 갱신.
 *
 * 🔴 결과가 '미확인'이어도 자산 상태를 **자동으로 바꾸지 않는다**(자동 쓰기 금지 — 셔틀 결정·강사 소급
 *    퇴원 사고와 같은 결). 화면에 "분실로 표시할까요?"를 **제안**하고 사람이 누른다(`suggestLost`).
 * ⚠️ 옛 날짜의 실사를 뒤늦게 적어도 `last_audited_on`은 **뒤로 가지 않는다**(더 최근 값을 유지).
 */
export type AuditActionState = { ok?: true; error?: string; suggestLost?: boolean } | undefined;

export async function recordAudit(fd: FormData): Promise<AuditActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const assetId = idField(fd, "assetId");
  if (!assetId) return { error: "자산을 선택하세요" };
  const result = String(fd.get("result") ?? "");
  if (!isAuditResult(result)) return { error: "실사 결과를 선택하세요" };
  const on = dateField(fd, "auditedOn", "실사일");
  if ("error" in on) return on;
  const auditedOn = on.value ?? kstToday();
  if (auditedOn > kstToday()) return { error: "실사일은 오늘 이후일 수 없습니다" };
  const location = textField(fd, "location", "확인위치", 120);
  if ("error" in location) return location;
  const action = textField(fd, "action", "조치", 200);
  if ("error" in action) return action;
  const note = textField(fd, "note", "비고", 500);
  if ("error" in note) return note;

  const admin = createAdminClient();
  const { data: asset, error: assetErr } = await admin
    .from("inventory_assets")
    .select("asset_code, status, last_audited_on")
    .eq("id", assetId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (assetErr) return { error: friendlyInventoryError(assetErr, "자산을 불러오지 못했습니다") };
  if (!asset) return { error: "자산을 찾지 못했습니다" };

  const { data: audit, error: insErr } = await admin
    .from("inventory_audits")
    .insert({
      tenant_id: ctx.tenantId,
      asset_id: assetId,
      audited_on: auditedOn,
      result,
      location: location.value,
      auditor_user_id: ctx.userId,
      auditor_name: ctx.displayName,
      action: action.value,
      note: note.value,
    })
    .select("id, audit_code")
    .single();
  if (insErr) return { error: friendlyInventoryError(insErr, "실사를 기록하지 못했습니다") };

  if (!asset.last_audited_on || auditedOn > asset.last_audited_on) {
    const { error: upErr } = await admin
      .from("inventory_assets")
      .update({ last_audited_on: auditedOn })
      .eq("id", assetId)
      .eq("tenant_id", ctx.tenantId);
    if (upErr) return { error: friendlyInventoryError(upErr, "실사는 기록됐지만 자산의 최종실사일을 갱신하지 못했습니다") };
  }

  await logAction({
    action: "inventory_audit",
    targetType: "inventory_audit",
    targetLabel: `${asset.asset_code} · ${audit.audit_code}`,
    metadata: { auditId: audit.id, assetId, assetCode: asset.asset_code, auditedOn, result, location: location.value, action: action.value },
  });
  refresh();
  // 미확인 + 아직 분실이 아닌 자산 → 화면이 "분실로 표시" 버튼을 띄운다(자동 변경 아님).
  return { ok: true, suggestLost: result === "missing" && asset.status !== "lost" && asset.status !== "disposed" };
}

function refresh() {
  revalidatePath("/inventory");
}
