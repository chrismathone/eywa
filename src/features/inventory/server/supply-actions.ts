"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { dateField, idField, intField, textField } from "../form";
import { friendlyInventoryError, requireInventoryWrite } from "./access";
import type { InventoryActionState } from "./asset-actions";

/**
 * 소모품 수량 수정 — qty + 최종확인일 + 확인자. v1 범위는 "수량 수정"뿐(브리프 §2 — 품목 신설·삭제는 없다).
 * 확인자는 **로그인한 사람 이름**을 기본값으로 두되 폼이 다른 이름을 적을 수 있다(원본 시트처럼 데스크가
 * 대신 적는 경우가 있다).
 */
export async function updateSupplyQty(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "소모품을 찾지 못했습니다" };
  const qty = intField(fd, "qty", "수량");
  if ("error" in qty) return qty;
  const checked = dateField(fd, "checkedOn", "최종확인");
  if ("error" in checked) return checked;
  const checker = textField(fd, "checkerName", "확인자", 80);
  if ("error" in checker) return checker;
  const note = textField(fd, "note", "비고", 500);
  if ("error" in note) return note;
  const checkedOn = checked.value ?? kstToday();
  if (checkedOn > kstToday()) return { error: "최종확인일은 오늘 이후일 수 없습니다" };

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_supplies")
    .select("item_code, name, qty")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "소모품을 불러오지 못했습니다") };
  if (!cur) return { error: "소모품을 찾지 못했습니다" };

  const { error } = await admin
    .from("inventory_supplies")
    .update({ qty: qty.value, checked_on: checkedOn, checker_name: checker.value ?? ctx.displayName, note: note.value })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "수량을 저장하지 못했습니다") };

  await logAction({
    action: "inventory_supply_update",
    targetType: "inventory_supply",
    targetLabel: cur.item_code ? `${cur.item_code} ${cur.name}` : cur.name,
    metadata: { supplyId: id, itemCode: cur.item_code, name: cur.name, qtyFrom: cur.qty, qtyTo: qty.value, checkedOn },
  });
  revalidatePath("/inventory");
  return { ok: true };
}

/**
 * **소모품 삭제** — 잘못 등록한 줄을 지운다(원장 2026-09-08 *"소모품도 마찬가지"*).
 * ⚠️ 딸린 표가 없어(FK 없음) 이 행만 사라진다. 되짚을 근거가 로그뿐이라 내용을 스냅샷으로 남긴다.
 */
export async function deleteSupply(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "소모품을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_supplies")
    .select("item_code, name, maker_model, qty, location, checked_on, checker_name, note")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "소모품을 불러오지 못했습니다") };
  if (!cur) return { error: "소모품을 찾지 못했습니다" };

  const { error } = await admin.from("inventory_supplies").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "소모품을 지우지 못했습니다") };

  await logAction({
    action: "inventory_supply_delete",
    targetType: "inventory_supply",
    targetLabel: cur.item_code ? `${cur.item_code} ${cur.name}` : cur.name,
    metadata: {
      supplyId: id,
      itemCode: cur.item_code,
      name: cur.name,
      makerModel: cur.maker_model,
      qty: cur.qty,
      location: cur.location,
      checkedOn: cur.checked_on,
      checkerName: cur.checker_name,
      note: cur.note,
    },
  });
  revalidatePath("/inventory");
  return { ok: true };
}
