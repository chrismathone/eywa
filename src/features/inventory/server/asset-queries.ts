import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { normalizeAssetCode } from "../asset-code";
import type { InventoryAsset, InventoryAudit, InventoryLoan } from "../types";

/** 자산 한 대의 현재 상태 + 최근 대여·실사(QR 스캔 착지 화면). 세션 클라이언트(RLS). */
export type AssetDetail = {
  asset: InventoryAsset;
  loans: InventoryLoan[];
  audits: InventoryAudit[];
};

const RECENT = 10;

export async function getAssetDetail(rawCode: string): Promise<AssetDetail | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const code = normalizeAssetCode(rawCode);
  if (!code) return null;
  const supabase = await createClient();
  const { data: a, error } = await supabase
    .from("inventory_assets")
    .select("id, asset_code, category, maker, model, serial_no, acquired_on, status, location, holder_user_id, holder_name, last_audited_on, disposed_on, note, sort_order")
    .eq("tenant_id", user.tenantId)
    .eq("asset_code", code)
    .maybeSingle();
  if (error || !a) return null;

  // 자산 id를 알아야 하는 두 조회는 서로 독립 — 함께 받는다(B4). 최근 10건씩(상한 — 이력은 대여 면에 전건).
  const [loansRes, auditsRes] = await Promise.all([
    supabase
      .from("inventory_loans")
      .select("id, asset_id, loan_code, borrower_user_id, borrower_name, dept, lent_on, due_on, due_note, returned_on, status, prev_status, note")
      .eq("tenant_id", user.tenantId)
      .eq("asset_id", a.id)
      .order("lent_on", { ascending: false, nullsFirst: false })
      .order("loan_code", { ascending: false })
      .limit(RECENT),
    supabase
      .from("inventory_audits")
      .select("id, asset_id, audit_code, audited_on, result, location, auditor_user_id, auditor_name, action, note")
      .eq("tenant_id", user.tenantId)
      .eq("asset_id", a.id)
      .order("audited_on", { ascending: false })
      .order("audit_code", { ascending: false })
      .limit(RECENT),
  ]);

  const asset: InventoryAsset = {
    id: a.id, assetCode: a.asset_code, category: a.category, maker: a.maker, model: a.model, serialNo: a.serial_no,
    acquiredOn: a.acquired_on, status: a.status, location: a.location, holderUserId: a.holder_user_id,
    holderName: a.holder_name, lastAuditedOn: a.last_audited_on, disposedOn: a.disposed_on, note: a.note, sortOrder: a.sort_order,
  };
  return {
    asset,
    loans: (loansRes.data ?? []).map((r) => ({
      id: r.id, assetId: r.asset_id, assetCode: asset.assetCode, assetModel: asset.model, loanCode: r.loan_code,
      borrowerUserId: r.borrower_user_id, borrowerName: r.borrower_name, dept: r.dept, lentOn: r.lent_on, dueOn: r.due_on,
      dueNote: r.due_note, returnedOn: r.returned_on, status: r.status, prevStatus: r.prev_status, note: r.note,
    })),
    audits: (auditsRes.data ?? []).map((r) => ({
      id: r.id, assetId: r.asset_id, assetCode: asset.assetCode, assetModel: asset.model, auditCode: r.audit_code,
      auditedOn: r.audited_on, result: r.result, location: r.location, auditorUserId: r.auditor_user_id,
      auditorName: r.auditor_name, action: r.action, note: r.note,
    })),
  };
}
