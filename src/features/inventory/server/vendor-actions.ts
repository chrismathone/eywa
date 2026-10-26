"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { idField } from "../form";
import { tidyVendor, VENDOR_FIELDS, vendorColumns, type VendorValues } from "../vendor";
import { friendlyInventoryError, isMissingInventoryTable } from "./access";
import type { InventoryActionState } from "./asset-actions";
import { requireVendorWrite } from "./vendor-gate";

/**
 * 업체리스트(거래처 연락처) 등록·수정·삭제 — 게이트 = `requireVendorWrite`(재고관리 쓰기 + 업체리스트 지정, [[#77]]).
 * 다듬기·길이 상한은 엑셀 가져오기와 같은 `tidyVendor`(상한 = 0448a 제약). 번호는 숫자만 적었으면 하이픈을 넣는다.
 */
const NOT_READY = "업체리스트 표가 아직 만들어지지 않았습니다 — 마이그레이션 0448a를 적용해 주세요";

const fail = (error: { code?: string; message?: string }, fallback: string) =>
  isMissingInventoryTable(error) ? NOT_READY : friendlyInventoryError(error, fallback);

type VendorFields = ReturnType<typeof vendorColumns>;

function readVendor(fd: FormData): VendorFields | { error: string } {
  const raw = Object.fromEntries(VENDOR_FIELDS.map((f) => [f.key, fd.get(f.key)])) as Record<keyof VendorValues, unknown>;
  const v = tidyVendor(raw);
  return "error" in v ? v : vendorColumns(v);
}

export async function createVendor(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireVendorWrite();
  if ("error" in ctx) return ctx;
  const v = readVendor(fd);
  if ("error" in v) return v;

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("inventory_vendors")
    .insert({ ...v, tenant_id: ctx.tenantId, created_by: ctx.userId })
    .select("id")
    .single();
  if (error || !data) return { error: fail(error ?? {}, "업체를 등록하지 못했습니다") };

  await logAction({
    action: "inventory_vendor_create",
    targetType: "inventory_vendor",
    targetLabel: v.name,
    metadata: { vendorId: data.id, name: v.name, category: v.category },
  });
  revalidatePath("/inventory");
  return { ok: true };
}

const LABEL_OF: Record<keyof VendorFields, string> = {
  name: "업체명", category: "분류", phone: "대표전화", contact_name: "담당자", contact_phone: "담당자 연락처",
  email: "이메일", address: "주소", biz_no: "사업자등록번호", note: "비고",
};

export async function updateVendor(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireVendorWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "업체를 찾지 못했습니다" };
  const v = readVendor(fd);
  if ("error" in v) return v;

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_vendors")
    .select("name, category, phone, contact_name, contact_phone, email, address, biz_no, note")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: fail(curErr, "업체를 불러오지 못했습니다") };
  if (!cur) return { error: "업체를 찾지 못했습니다" };

  // 바뀐 칸만 기록한다 — 비고 전문은 로그에 싣지 않는다(칸 이름만).
  const changed = (Object.keys(LABEL_OF) as (keyof VendorFields)[]).filter((k) => (cur as VendorFields)[k] !== v[k]);
  if (changed.length === 0) return { ok: true };

  const { error } = await admin.from("inventory_vendors").update(v).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: fail(error, "업체를 저장하지 못했습니다") };

  await logAction({
    action: "inventory_vendor_update",
    targetType: "inventory_vendor",
    targetLabel: v.name,
    metadata: { vendorId: id, name: v.name, fields: changed.map((k) => LABEL_OF[k]) },
  });
  revalidatePath("/inventory");
  return { ok: true };
}

/** 삭제 — 딸린 표가 없다. 되짚을 근거가 로그뿐이라 내용을 스냅샷으로 남긴다. */
export async function deleteVendor(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireVendorWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "업체를 찾지 못했습니다" };

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_vendors")
    .select("name, category, phone, contact_name, contact_phone, email, address, biz_no, note")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: fail(curErr, "업체를 불러오지 못했습니다") };
  if (!cur) return { error: "업체를 찾지 못했습니다" };

  const { error } = await admin.from("inventory_vendors").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: fail(error, "업체를 지우지 못했습니다") };

  await logAction({
    action: "inventory_vendor_delete",
    targetType: "inventory_vendor",
    targetLabel: cur.name,
    metadata: { vendorId: id, ...cur },
  });
  revalidatePath("/inventory");
  return { ok: true };
}
