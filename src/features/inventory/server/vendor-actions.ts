"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAction } from "@/features/audit/server/log";
import { idField, textField } from "../form";
import { formatBizNo, formatPhone } from "../vendor";
import { friendlyInventoryError, isMissingInventoryTable, requireInventoryWrite } from "./access";
import type { InventoryActionState } from "./asset-actions";
import { VENDOR_DENIED_MSG } from "../vendor-access";
import { canViewVendorsNow } from "./vendor-gate";

/** 쓰기 = 재고관리 쓰기 게이트 **그리고** 업체리스트 지정(vendor-gate) — 둘 중 하나라도 아니면 거절. */
async function requireVendorWrite() {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  if (!(await canViewVendorsNow())) return { error: VENDOR_DENIED_MSG };
  return ctx;
}

/**
 * 업체리스트(거래처 연락처) 등록·수정·삭제 — 게이트는 재고관리와 같은 `requireInventoryWrite`([[#77]]).
 * 길이 상한은 20261022140000 제약과 같다. 번호는 숫자만 적었으면 하이픈을 넣어 저장한다(`formatPhone`).
 */
const NOT_READY = "업체리스트 표가 아직 만들어지지 않았습니다 — 마이그레이션 20261022140000을 적용해 주세요";

const fail = (error: { code?: string; message?: string }, fallback: string) =>
  isMissingInventoryTable(error) ? NOT_READY : friendlyInventoryError(error, fallback);

type VendorFields = {
  name: string;
  category: string | null;
  phone: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  email: string | null;
  address: string | null;
  biz_no: string | null;
  note: string | null;
};

const SPEC: [key: string, col: Exclude<keyof VendorFields, "name">, label: string, max: number][] = [
  ["category", "category", "분류", 40],
  ["phone", "phone", "대표전화", 40],
  ["contactName", "contact_name", "담당자", 40],
  ["contactPhone", "contact_phone", "담당자 연락처", 40],
  ["email", "email", "이메일", 120],
  ["address", "address", "주소", 200],
  ["bizNo", "biz_no", "사업자등록번호", 20],
  ["note", "note", "비고", 500],
];

function readVendor(fd: FormData): VendorFields | { error: string } {
  const name = textField(fd, "name", "업체명", 80);
  if ("error" in name) return name;
  if (!name.value) return { error: "업체명을 입력해 주세요" };
  const out: VendorFields = {
    name: name.value, category: null, phone: null, contact_name: null, contact_phone: null,
    email: null, address: null, biz_no: null, note: null,
  };
  for (const [key, col, label, max] of SPEC) {
    const v = textField(fd, key, label, max);
    if ("error" in v) return v;
    out[col] = v.value;
  }
  if (out.phone) out.phone = formatPhone(out.phone);
  if (out.contact_phone) out.contact_phone = formatPhone(out.contact_phone);
  if (out.biz_no) out.biz_no = formatBizNo(out.biz_no);
  // 다듬은 뒤에도 상한 안인지(하이픈이 붙어 늘어날 수 있다).
  for (const [, col, label, max] of SPEC) {
    const v = out[col];
    if (v && v.length > max) return { error: `${label}은(는) ${max}자까지입니다` };
  }
  return out;
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
