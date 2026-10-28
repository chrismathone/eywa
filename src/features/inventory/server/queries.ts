import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/current-user";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import type { InventoryTab } from "../faces";
import type { InventoryAsset, InventoryAudit, InventoryLoan, InventorySupply, InventoryVendor } from "../types";
import { isMissingInventoryTable } from "./access";
import { canViewVendorsNow } from "./vendor-gate";

/**
 * 재고관리 조회 — 읽기는 세션 클라이언트 + RLS(테넌트 전원 select, 0242a). 쓰기는 서버 액션(`*-actions.ts`).
 *
 * ⚠️ 0242a 미적용 배포에서도 죽지 않는다([[#95]]) — 표가 없으면 `status:"missing-table"`로 접고 화면이
 *    한글 배너를 띄운다. 🔴 원인을 단정하지 않는다: 표 없음(42P01·PGRST205)과 그냥 실패는 다른 사실이다.
 * ⚠️ 임베드는 FK 이름을 명시한다([[#94]]) — `inventory_assets!inventory_loans_asset_id_fkey(...)`.
 * ⚠️ 전건 조회는 `fetchAllPaged`(B2 — 96행이지만 규약은 같다), 건수는 `count:"exact", head:true`.
 * ⚠️ 세션 클라이언트라 RLS가 테넌트를 거르지만 `tenant_id` 필터를 **명시**한다(admin으로 바꿔도 안 새게).
 */
export type TableStatus = "ok" | "missing-table" | "failed";
export type FaceData<T> = { status: TableStatus; rows: T[] };

function classify(error: { code?: string; message?: string } | null): TableStatus {
  if (!error) return "ok";
  return isMissingInventoryTable(error) ? "missing-table" : "failed";
}

/** 탭 라벨 옆 건수(면마다 하나) — 행을 안 받는다(head). 실패는 null(0을 적으면 "하나도 없다"는 거짓말). */
export async function getInventoryCounts(): Promise<Record<InventoryTab, number | null>> {
  const user = await getCurrentUser();
  if (!user) return { assets: null, loans: null, audits: null, supplies: null, vendors: null };
  const supabase = await createClient();
  const head = (table: string) =>
    supabase.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", user.tenantId);
  // 업체리스트 열람 게이트(vendor-gate) — 표는 RLS 읽기를 닫아 두어 admin으로 센다(tenant_id 필터 필수).
  const vendorHead = async () =>
    (await canViewVendorsNow())
      ? createAdminClient().from("inventory_vendors").select("id", { count: "exact", head: true }).eq("tenant_id", user.tenantId)
      : null;
  // 서로 독립 — 함께 받는다(B4).
  const [a, l, d, s, v] = await Promise.all([
    head("inventory_assets"),
    head("inventory_loans"),
    head("inventory_audits"),
    head("inventory_supplies"),
    vendorHead(),
  ]);
  const n = (r: { count: number | null; error: { message: string } | null } | null) => (!r || r.error ? null : (r.count ?? 0));
  return { assets: n(a), loans: n(l), audits: n(d), supplies: n(s), vendors: n(v) };
}

type Embedded = { asset_code: string; model: string | null } | { asset_code: string; model: string | null }[] | null;
/** 다대일 임베드는 객체로 오지만 타입상 배열일 수 있어 둘 다 받는다. */
function embeddedAsset(v: Embedded): { asset_code: string; model: string | null } {
  const one = Array.isArray(v) ? v[0] : v;
  return one ?? { asset_code: "?", model: null };
}

async function loadAll<T>(scope: string, run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>): Promise<FaceData<T>> {
  try {
    return { status: "ok", rows: await fetchAllPaged<T>(run) };
  } catch (e) {
    // fetchAllPaged는 규약대로 throw — 여기서 표 없음/실패로 가른다. 원문은 계측에만 남긴다.
    const msg = e instanceof Error ? e.message : String(e);
    const status = classify({ message: msg });
    if (status === "failed") reportError(e, { scope });
    return { status, rows: [] };
  }
}

type AssetRow = {
  id: string; asset_code: string; category: string; maker: string | null; model: string | null;
  serial_no: string | null; acquired_on: string | null; status: string; location: string | null;
  holder_user_id: string | null; holder_name: string | null; last_audited_on: string | null;
  disposed_on: string | null; note: string | null; sort_order: number;
};

/** 자산 전건(정렬 = sort_order, asset_code). 스탯·조치 목록·대여/실사 다이얼로그의 자산 선택이 함께 쓴다. */
export async function getAssets(): Promise<FaceData<InventoryAsset>> {
  const user = await getCurrentUser();
  if (!user) return { status: "failed", rows: [] };
  const supabase = await createClient();
  const res = await loadAll<AssetRow>("inventory.assets", (from, to) =>
    supabase
      .from("inventory_assets")
      .select("id, asset_code, category, maker, model, serial_no, acquired_on, status, location, holder_user_id, holder_name, last_audited_on, disposed_on, note, sort_order")
      .eq("tenant_id", user.tenantId)
      .order("sort_order", { ascending: true })
      .order("asset_code", { ascending: true })
      .range(from, to),
  );
  return {
    status: res.status,
    rows: res.rows.map((r) => ({
      id: r.id, assetCode: r.asset_code, category: r.category, maker: r.maker, model: r.model,
      serialNo: r.serial_no, acquiredOn: r.acquired_on, status: r.status, location: r.location,
      holderUserId: r.holder_user_id, holderName: r.holder_name, lastAuditedOn: r.last_audited_on,
      disposedOn: r.disposed_on, note: r.note, sortOrder: r.sort_order,
    })),
  };
}

type LoanRow = {
  id: string; asset_id: string; loan_code: string; borrower_user_id: string | null; borrower_name: string;
  dept: string | null; lent_on: string | null; due_on: string | null; due_note: string | null;
  returned_on: string | null; status: string; prev_status: string | null; note: string | null;
  inventory_assets: Embedded;
};

export async function getLoans(): Promise<FaceData<InventoryLoan>> {
  const user = await getCurrentUser();
  if (!user) return { status: "failed", rows: [] };
  const supabase = await createClient();
  const res = await loadAll<LoanRow>("inventory.loans", (from, to) =>
    supabase
      .from("inventory_loans")
      .select("id, asset_id, loan_code, borrower_user_id, borrower_name, dept, lent_on, due_on, due_note, returned_on, status, prev_status, note, inventory_assets!inventory_loans_asset_id_fkey(asset_code, model)")
      .eq("tenant_id", user.tenantId)
      .order("lent_on", { ascending: false, nullsFirst: false })
      .order("loan_code", { ascending: false })
      .range(from, to),
  );
  return {
    status: res.status,
    rows: res.rows.map((r) => {
      const a = embeddedAsset(r.inventory_assets);
      return {
        id: r.id, assetId: r.asset_id, assetCode: a.asset_code, assetModel: a.model, loanCode: r.loan_code,
        borrowerUserId: r.borrower_user_id, borrowerName: r.borrower_name, dept: r.dept, lentOn: r.lent_on,
        dueOn: r.due_on, dueNote: r.due_note, returnedOn: r.returned_on, status: r.status,
        prevStatus: r.prev_status, note: r.note,
      };
    }),
  };
}

type AuditRow = {
  id: string; asset_id: string; audit_code: string; audited_on: string; result: string; location: string | null;
  auditor_user_id: string | null; auditor_name: string | null; action: string | null; note: string | null;
  inventory_assets: Embedded;
};

export async function getAudits(): Promise<FaceData<InventoryAudit>> {
  const user = await getCurrentUser();
  if (!user) return { status: "failed", rows: [] };
  const supabase = await createClient();
  const res = await loadAll<AuditRow>("inventory.audits", (from, to) =>
    supabase
      .from("inventory_audits")
      .select("id, asset_id, audit_code, audited_on, result, location, auditor_user_id, auditor_name, action, note, inventory_assets!inventory_audits_asset_id_fkey(asset_code, model)")
      .eq("tenant_id", user.tenantId)
      .order("audited_on", { ascending: false })
      .order("audit_code", { ascending: false })
      .range(from, to),
  );
  return {
    status: res.status,
    rows: res.rows.map((r) => {
      const a = embeddedAsset(r.inventory_assets);
      return {
        id: r.id, assetId: r.asset_id, assetCode: a.asset_code, assetModel: a.model, auditCode: r.audit_code,
        auditedOn: r.audited_on, result: r.result, location: r.location, auditorUserId: r.auditor_user_id,
        auditorName: r.auditor_name, action: r.action, note: r.note,
      };
    }),
  };
}

type SupplyRow = {
  id: string; item_code: string | null; name: string; maker_model: string | null; qty: number;
  location: string | null; checked_on: string | null; checker_name: string | null; note: string | null; sort_order: number;
};

export async function getSupplies(): Promise<FaceData<InventorySupply>> {
  const user = await getCurrentUser();
  if (!user) return { status: "failed", rows: [] };
  const supabase = await createClient();
  const res = await loadAll<SupplyRow>("inventory.supplies", (from, to) =>
    supabase
      .from("inventory_supplies")
      .select("id, item_code, name, maker_model, qty, location, checked_on, checker_name, note, sort_order")
      .eq("tenant_id", user.tenantId)
      .order("sort_order", { ascending: true })
      .order("item_code", { ascending: true, nullsFirst: false })
      .range(from, to),
  );
  return {
    status: res.status,
    rows: res.rows.map((r) => ({
      id: r.id, itemCode: r.item_code, name: r.name, makerModel: r.maker_model, qty: r.qty, location: r.location,
      checkedOn: r.checked_on, checkerName: r.checker_name, note: r.note, sortOrder: r.sort_order,
    })),
  };
}

type VendorRow = {
  id: string; name: string; category: string | null; phone: string | null; contact_name: string | null;
  contact_phone: string | null; email: string | null; address: string | null; biz_no: string | null; note: string | null;
};

/** 업체리스트 전건(업체명 가나다). 표가 없으면(0448a 미적용) `missing-table` — 이 면만 배너. */
export async function getVendors(): Promise<FaceData<InventoryVendor>> {
  const user = await getCurrentUser();
  if (!user) return { status: "failed", rows: [] };
  // 열람 게이트(재고관리를 여는 직원 전원) — 호출부가 탭을 감춰도 여기서 한 번 더 닫는다([[#77]]).
  if (!(await canViewVendorsNow())) return { status: "ok", rows: [] };
  // 표의 RLS 읽기 정책은 닫았다(0449a) — 세션 클라이언트는 0행이라 admin + tenant_id 필터로 읽는다([[#104]]).
  const supabase = createAdminClient();
  const res = await loadAll<VendorRow>("inventory.vendors", (from, to) =>
    supabase
      .from("inventory_vendors")
      .select("id, name, category, phone, contact_name, contact_phone, email, address, biz_no, note")
      .eq("tenant_id", user.tenantId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  return {
    status: res.status,
    rows: res.rows.map((r) => ({
      id: r.id, name: r.name, category: r.category, phone: r.phone, contactName: r.contact_name,
      contactPhone: r.contact_phone, email: r.email, address: r.address, bizNo: r.biz_no, note: r.note,
    })),
  };
}
