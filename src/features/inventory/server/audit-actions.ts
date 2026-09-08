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

/**
 * **실사 기록 수정** — 원장 2026-09-08 *"기존 실사 기록을 수정하려고 더블클릭해도 수정하거나 삭제할 수 없음"*.
 *
 * 🔴 **자산은 못 바꾼다** — 다른 자산으로 옮기는 건 정정이 아니라 새 기록이다(두 자산의 `최종실사`가
 *    한꺼번에 어긋난다). 자산을 잘못 골랐으면 지우고 다시 기록한다.
 * ⚠️ 실사일을 바꾸면 자산의 `최종실사`도 따라가야 한다 — 그 값은 **그 자산의 가장 최근 실사일**이라
 *    이 행 하나로 정할 수 없어서 남은 기록에서 다시 계산한다(`syncLastAudited`).
 */
export async function updateAudit(fd: FormData): Promise<AuditActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "실사 기록을 찾지 못했습니다" };
  const result = String(fd.get("result") ?? "");
  if (!isAuditResult(result)) return { error: "실사 결과 값이 올바르지 않습니다" };
  const audited = dateField(fd, "auditedOn", "실사일");
  if ("error" in audited) return audited;
  const auditedOn = audited.value ?? kstToday();
  if (auditedOn > kstToday()) return { error: "실사일은 오늘 이후일 수 없습니다" };
  const location = textField(fd, "location", "확인위치", 120);
  if ("error" in location) return location;
  const auditor = textField(fd, "auditorName", "확인자", 80);
  if ("error" in auditor) return auditor;
  const action = textField(fd, "action", "조치", 200);
  if ("error" in action) return action;
  const note = textField(fd, "note", "비고", 500);
  if ("error" in note) return note;

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_audits")
    .select(
      "audit_code, asset_id, audited_on, result, location, auditor_name, action, inventory_assets!inventory_audits_asset_id_fkey(asset_code)",
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "실사 기록을 불러오지 못했습니다") };
  if (!cur) return { error: "실사 기록을 찾지 못했습니다" };

  const { error } = await admin
    .from("inventory_audits")
    .update({
      audited_on: auditedOn,
      result,
      location: location.value,
      auditor_name: auditor.value ?? ctx.displayName,
      action: action.value,
      note: note.value,
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "실사 기록을 고치지 못했습니다") };
  await syncLastAudited(admin, ctx, cur.asset_id as string);

  const assetRow = Array.isArray(cur.inventory_assets) ? cur.inventory_assets[0] : cur.inventory_assets;
  await logAction({
    action: "inventory_audit_update",
    targetType: "inventory_audit",
    targetLabel: `${assetRow?.asset_code ?? ""} · ${cur.audit_code}`,
    metadata: {
      auditId: id,
      assetId: cur.asset_id,
      auditCode: cur.audit_code,
      from: {
        auditedOn: cur.audited_on,
        result: cur.result,
        location: cur.location,
        auditorName: cur.auditor_name,
        action: cur.action,
      },
      to: {
        auditedOn,
        result,
        location: location.value,
        auditorName: auditor.value ?? ctx.displayName,
        action: action.value,
      },
    },
  });
  revalidatePath("/inventory");
  return { ok: true };
}

/** **실사 기록 삭제** — 지운 뒤 그 자산의 `최종실사`를 남은 기록으로 다시 계산한다. */
export async function deleteAudit(fd: FormData): Promise<AuditActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "실사 기록을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_audits")
    .select(
      "audit_code, asset_id, audited_on, result, location, auditor_name, action, note, inventory_assets!inventory_audits_asset_id_fkey(asset_code)",
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "실사 기록을 불러오지 못했습니다") };
  if (!cur) return { error: "실사 기록을 찾지 못했습니다" };

  const { error } = await admin.from("inventory_audits").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "실사 기록을 지우지 못했습니다") };
  await syncLastAudited(admin, ctx, cur.asset_id as string);

  const assetRow = Array.isArray(cur.inventory_assets) ? cur.inventory_assets[0] : cur.inventory_assets;
  await logAction({
    action: "inventory_audit_delete",
    targetType: "inventory_audit",
    targetLabel: `${assetRow?.asset_code ?? ""} · ${cur.audit_code}`,
    metadata: {
      auditId: id,
      assetId: cur.asset_id,
      auditCode: cur.audit_code,
      auditedOn: cur.audited_on,
      result: cur.result,
      location: cur.location,
      auditorName: cur.auditor_name,
      action: cur.action,
      note: cur.note,
    },
  });
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * 자산의 `최종실사` = **그 자산에 남은 실사 중 가장 최근 날짜**. 기록이 하나도 없으면 비운다.
 * 🔴 수정·삭제 뒤에 반드시 부른다 — 안 부르면 지워진 실사의 날짜가 자산 표에 영원히 남는다.
 */
async function syncLastAudited(
  admin: ReturnType<typeof createAdminClient>,
  ctx: { tenantId: string },
  assetId: string,
): Promise<void> {
  const { data } = await admin
    .from("inventory_audits")
    .select("audited_on")
    .eq("tenant_id", ctx.tenantId)
    .eq("asset_id", assetId)
    .order("audited_on", { ascending: false })
    .limit(1);
  const latest = (data?.[0]?.audited_on as string | undefined) ?? null;
  await admin.from("inventory_assets").update({ last_audited_on: latest }).eq("id", assetId).eq("tenant_id", ctx.tenantId);
}
