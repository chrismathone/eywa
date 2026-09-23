"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { dateField, idField, intField, textField } from "../form";
import { friendlyInventoryError, requireInventoryWrite } from "./access";
import type { InventoryActionState } from "./asset-actions";

/**
 * 품목·제조사/모델·분배위치 — 폼에 칸이 **있을 때만** 값(`undefined` = 칸 없음 = 안 건드림).
 * 품목은 비울 수 없다(DB 1~80자). 길이는 0242a 제약과 같다.
 */
function readSupplyMeta(
  fd: FormData,
): { name?: string; makerModel?: string | null; location?: string | null } | { error: string } {
  const out: { name?: string; makerModel?: string | null; location?: string | null } = {};
  if (fd.has("name")) {
    const name = textField(fd, "name", "품목", 80);
    if ("error" in name) return name;
    if (!name.value) return { error: "품목 이름을 입력해 주세요" };
    out.name = name.value;
  }
  if (fd.has("makerModel")) {
    const mm = textField(fd, "makerModel", "제조사/모델", 120);
    if ("error" in mm) return mm;
    out.makerModel = mm.value;
  }
  if (fd.has("location")) {
    const loc = textField(fd, "location", "분배위치", 120);
    if ("error" in loc) return loc;
    out.location = loc.value;
  }
  return out;
}

/**
 * 소모품 수정 — qty + 최종확인일 + 확인자 + 비고, 그리고(감사 N5, 2026-09-23) **품목·제조사/모델·분배위치**.
 * 확인자는 **로그인한 사람 이름**을 기본값으로 두되 폼이 다른 이름을 적을 수 있다(원본 시트처럼 데스크가
 * 대신 적는 경우가 있다).
 * ⚠️ 품목·모델·위치 칸은 **폼에 있을 때만** 바꾼다(`fd.has`) — 칸이 없는 옛 화면이 저장해도 값을 지우지 않는다.
 * ⚠️ 품목ID는 여기서 못 바꾼다 — 엑셀 가져오기의 매칭 키라 바꾸면 다음 가져오기가 같은 품목을 새 줄로 만든다.
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
  const meta = readSupplyMeta(fd);
  if ("error" in meta) return meta;

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_supplies")
    .select("item_code, name, qty, maker_model, location")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "소모품을 불러오지 못했습니다") };
  if (!cur) return { error: "소모품을 찾지 못했습니다" };

  const patch: Record<string, unknown> = { qty: qty.value, checked_on: checkedOn, checker_name: checker.value ?? ctx.displayName, note: note.value };
  const changes: { field: string; from: string | null; to: string | null }[] = [];
  if (meta.name !== undefined && meta.name !== cur.name) {
    patch.name = meta.name;
    changes.push({ field: "품목", from: cur.name, to: meta.name });
  }
  if (meta.makerModel !== undefined && meta.makerModel !== cur.maker_model) {
    patch.maker_model = meta.makerModel;
    changes.push({ field: "제조사/모델", from: cur.maker_model, to: meta.makerModel });
  }
  if (meta.location !== undefined && meta.location !== cur.location) {
    patch.location = meta.location;
    changes.push({ field: "분배위치", from: cur.location, to: meta.location });
  }

  const { error } = await admin
    .from("inventory_supplies")
    .update(patch)
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "소모품을 저장하지 못했습니다") };

  const name = meta.name ?? cur.name;
  await logAction({
    action: "inventory_supply_update",
    targetType: "inventory_supply",
    targetLabel: cur.item_code ? `${cur.item_code} ${name}` : name,
    metadata: { supplyId: id, itemCode: cur.item_code, name, qtyFrom: cur.qty, qtyTo: qty.value, checkedOn, ...(changes.length ? { changes } : {}) },
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

/**
 * **소모품 새로 등록**(감사 N5, 2026-09-23) — 종전엔 새 품목을 매번 엑셀로 올려야 했다.
 * 품목ID는 엑셀 가져오기의 매칭 키라 **필수·대문자**로 받는다(엑셀 규약 `excel-sheet.ts`와 같다 — 비워 두면 다음 엑셀
 * 가져오기가 같은 품목을 한 줄 더 만든다). 같은 학원에 같은 품목ID가 있으면 DB 유니크가 거절한다.
 */
export async function createSupply(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const codeRaw = fd.get("itemCode");
  const itemCode = typeof codeRaw === "string" ? codeRaw.trim().toUpperCase() : "";
  if (!itemCode) return { error: "품목ID를 입력해 주세요(엑셀 가져오기의 매칭 키입니다)" };
  if (itemCode.length > 32) return { error: "품목ID는 32자까지입니다" };
  const meta = readSupplyMeta(fd);
  if ("error" in meta) return meta;
  if (!meta.name) return { error: "품목 이름을 입력해 주세요" };
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
  // 목록 순서(sort_order) — 맨 뒤에 붙인다. 못 읽으면 0(목록은 품목ID 순으로 이어서 정렬된다).
  const { data: last } = await admin
    .from("inventory_supplies")
    .select("sort_order")
    .eq("tenant_id", ctx.tenantId)
    .order("sort_order", { ascending: false })
    .order("id")
    .limit(1)
    .maybeSingle();
  const sortOrder = (last?.sort_order ?? -1) + 1;

  const { data: inserted, error } = await admin
    .from("inventory_supplies")
    .insert({
      tenant_id: ctx.tenantId,
      item_code: itemCode,
      name: meta.name,
      maker_model: meta.makerModel ?? null,
      location: meta.location ?? null,
      qty: qty.value,
      checked_on: checkedOn,
      checker_name: checker.value ?? ctx.displayName,
      note: note.value,
      sort_order: sortOrder,
    })
    .select("id")
    .single();
  if (error || !inserted) {
    return { error: friendlyInventoryError(error ?? {}, "소모품을 등록하지 못했습니다", `이미 같은 품목ID(${itemCode})가 있습니다`) };
  }

  await logAction({
    action: "inventory_supply_create",
    targetType: "inventory_supply",
    targetLabel: `${itemCode} ${meta.name}`,
    metadata: { supplyId: inserted.id, itemCode, name: meta.name, qty: qty.value, location: meta.location ?? null, checkedOn },
  });
  revalidatePath("/inventory");
  return { ok: true };
}
