import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidAssetCode, normalizeAssetCode } from "../asset-code";
import type { InventoryAsset, InventoryAudit, InventoryLoan } from "../types";

/**
 * 자산 한 대의 현재 상태 + 최근 대여·실사 — **QR 스캔 착지 화면(`/inventory/asset/[code]`) 전용**.
 *
 * 🔴 이 화면은 **비로그인 공개**다(원장 2026-09-03 *"seat/jj처럼 비로그인자도 볼 수 있게"*) — 세션이 없어
 *    `getCurrentUser()`로 테넌트를 못 얻는다. 그래서 admin(service_role)으로 자산ID를 **전역 조회**하고
 *    그 행의 tenant로 나머지를 좁힌다((share)/r 공개 보고서가 share_token으로 테넌트를 해석하는 것과 같은 결).
 * 🔴 **자산ID가 유일할 때만** 돌려준다 — `asset_code`는 `(tenant_id, asset_code)` 유니크라 **테넌트가 여럿이면
 *    같은 코드가 둘일 수 있다**. 그때 아무거나 고르면 남의 학원 기기를 보여 준다 → 모호하면 못 찾은 것으로 친다
 *    (`getPublicBranding`이 "학원이 정확히 1개일 때만" 확정하는 것과 같은 규약).
 * 🔴 admin은 RLS를 우회한다 — 자산 행에서 얻은 `tenant_id`로 대여·실사를 **반드시 좁힌다**.
 * ⚠️ 사람 이름(사용자·대여자·실사자)은 **일부러 싣는다** — 원장 2026-09-03 *"괜찮아 QR은 우리내부에 사용중이니까
 *    이름도 넣어"*. 좌석 PIN 화면의 '이름 조회 금지'를 여기 적용하지 말 것(축이 다르다).
 * ⚠️ 읽기 전용 — 이 파일에 쓰기를 추가하지 말 것(공개 경로에서 닿는 유일한 조회다).
 */
export type AssetDetail = {
  asset: InventoryAsset;
  loans: InventoryLoan[];
  audits: InventoryAudit[];
  /** 이 자산의 학원 — 호출부가 분류 라벨을 그 학원으로 읽는다(세션이 없어 테넌트를 따로 못 구한다). */
  tenantId: string;
};

const RECENT = 10;

export async function getAssetDetail(rawCode: string): Promise<AssetDetail | null> {
  const code = normalizeAssetCode(rawCode);
  // 🔴 이 함수는 이제 **로그인 없이** 닿는다 — 모양이 안 맞는 코드는 DB까지 가지 않고 여기서 끊는다.
  //    `asset_code`엔 같은 정규식의 CHECK가 걸려 있어(0242a) 여기서 거르는 값은 **존재할 수 없는 코드**뿐이다.
  if (!code || !isValidAssetCode(code)) return null;
  const admin = createAdminClient();
  // 🔴 `.limit(2)` — 하나만 받으면 "유일한가"를 알 수 없다. 둘 이상이면 모호 → null.
  const { data: rows, error } = await admin
    .from("inventory_assets")
    .select("id, tenant_id, asset_code, category, maker, model, serial_no, acquired_on, status, location, holder_user_id, holder_name, last_audited_on, disposed_on, note, sort_order")
    .eq("asset_code", code)
    .limit(2);
  if (error || !rows || rows.length !== 1) return null;
  const a = rows[0]!;
  const tenantId = a.tenant_id as string;

  // 자산 id를 알아야 하는 두 조회는 서로 독립 — 함께 받는다(B4). 최근 10건씩(상한 — 이력은 대여 면에 전건).
  const [loansRes, auditsRes] = await Promise.all([
    admin
      .from("inventory_loans")
      .select("id, asset_id, loan_code, borrower_user_id, borrower_name, dept, lent_on, due_on, due_note, returned_on, status, prev_status, note")
      .eq("tenant_id", tenantId)
      .eq("asset_id", a.id)
      .order("lent_on", { ascending: false, nullsFirst: false })
      .order("loan_code", { ascending: false })
      .limit(RECENT),
    admin
      .from("inventory_audits")
      .select("id, asset_id, audit_code, audited_on, result, location, auditor_user_id, auditor_name, action, note")
      .eq("tenant_id", tenantId)
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
    tenantId,
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
