"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { isValidAssetCode, nextAssetCode, normalizeAssetCode } from "../asset-code";
import { buildCategoryMaps } from "../category";
import { dateField, idField, textField } from "../form";
import { isAssetStatus } from "../status";
import { friendlyInventoryError, requireInventoryWrite } from "./access";
import { holderEditBlockReason } from "../loan-link";
import { loadCategoriesForWrite } from "./category-queries";

/**
 * 자산 마스터 쓰기 — 등록 · 수정 · 상태 변경.
 *
 * 게이트 = `requireInventoryWrite`(canWriteTenant("inventory")). 쓰기는 service_role 전용(0242a는 읽기 정책만)
 * → ⚠️ admin은 RLS를 우회하므로 **모든 쿼리에 tenant_id 명시 필터**. 조회 후 수정하는 경로는 대상 행의
 * tenant까지 확인한다.
 *
 * 🔴 `on_loan`(대여중)은 여기서 못 만든다 — 대여 시작(`loan-actions.ts`)만이 그 상태를 만든다. 상태만 바꾸면
 *    대여 행 없는 '대여중'이 생겨 "누가 갖고 있나"를 아무도 모르게 된다(시안의 NB-012가 그 흔적이다).
 */
export type InventoryActionState = { ok?: true; error?: string } | undefined;

const ASSET_FIELDS = [
  ["maker", "제조사", 80],
  ["model", "모델명", 120],
  ["serialNo", "시리얼번호", 120],
  ["location", "현위치", 120],
  ["note", "비고", 500],
] as const;

function refresh() {
  revalidatePath("/inventory");
}

type AssetFields = { maker: string | null; model: string | null; serialNo: string | null; location: string | null; note: string | null; acquiredOn: string | null };

/** 폼 공통 칸(제조사·모델명·시리얼·현위치·비고·입고일) — 등록·수정이 같은 규칙으로 읽는다. */
function readAssetFields(fd: FormData): { ok: true; values: AssetFields } | { ok: false; error: string } {
  const out: Record<string, string | null> = {};
  for (const [key, label, max] of ASSET_FIELDS) {
    const r = textField(fd, key, label, max);
    if ("error" in r) return { ok: false, error: r.error };
    out[key] = r.value;
  }
  const acquired = dateField(fd, "acquiredOn", "입고일");
  if ("error" in acquired) return { ok: false, error: acquired.error };
  return {
    ok: true,
    values: {
      maker: out.maker ?? null, model: out.model ?? null, serialNo: out.serialNo ?? null,
      location: out.location ?? null, note: out.note ?? null, acquiredOn: acquired.value,
    },
  };
}

/**
 * 등록된 분류인가 — **게이트는 화면이 아니라 서버**([[#77]]). 화면 드롭다운은 진입로일 뿐이다.
 * ⚠️ 0247a 미적용이면 `loadCategoriesForWrite`가 내장 7종으로 폴백하므로 지금 동작이 그대로 유지된다.
 */
async function resolveCategory(
  admin: ReturnType<typeof createAdminClient>,
  tenantId: string,
  raw: unknown,
): Promise<{ key: string; label: string; prefix: string } | { error: string }> {
  const category = String(raw ?? "").trim();
  if (!category) return { error: "분류를 선택하세요" };
  const maps = buildCategoryMaps((await loadCategoriesForWrite(admin, tenantId)).rows);
  if (!maps.has(category)) return { error: "등록되지 않은 분류입니다 — 목록에서 다시 고르세요" };
  return { key: category, label: maps.labelOf(category), prefix: maps.prefixOf(category) };
}

export async function createAsset(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;

  const status = String(fd.get("status") ?? "in_use");
  if (!isAssetStatus(status)) return { error: "상태 값이 올바르지 않습니다" };
  if (status === "on_loan") return { error: "대여중은 '대여 시작'으로 만드세요(대여자·기간이 함께 기록됩니다)" };
  const disposed = dateField(fd, "disposedOn", "폐기일");
  if ("error" in disposed) return disposed;
  if (status === "disposed" && !disposed.value) return { error: "폐기 상태는 폐기일이 필요합니다" };
  const read = readAssetFields(fd);
  if (!read.ok) return { error: read.error };
  const fields = read.values;

  const admin = createAdminClient();
  const cat = await resolveCategory(admin, ctx.tenantId, fd.get("category"));
  if ("error" in cat) return cat;
  let assetCode = normalizeAssetCode(String(fd.get("assetCode") ?? ""));
  if (!assetCode) {
    // 비워 두면 자동 채번 — 그 접두의 코드만 받아 최대 번호 + 1(전건 페이징, B2).
    const codes = await fetchAllPaged<{ asset_code: string }>((from, to) =>
      admin.from("inventory_assets").select("asset_code").eq("tenant_id", ctx.tenantId).like("asset_code", `${cat.prefix}-%`).range(from, to),
    ).catch(() => null);
    if (!codes) return { error: "자산ID를 자동으로 매기지 못했습니다 — 직접 입력해 주세요" };
    assetCode = nextAssetCode(cat.prefix, codes.map((c) => c.asset_code));
  }
  if (!isValidAssetCode(assetCode)) return { error: "자산ID는 영문 대문자·숫자·하이픈 2~32자입니다(예: NB-019)" };

  const { data, error } = await admin
    .from("inventory_assets")
    .insert({
      tenant_id: ctx.tenantId,
      asset_code: assetCode,
      category: cat.key,
      status,
      maker: fields.maker,
      model: fields.model,
      serial_no: fields.serialNo,
      acquired_on: fields.acquiredOn,
      location: fields.location,
      disposed_on: status === "disposed" ? disposed.value : null,
      note: fields.note,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyInventoryError(error, "자산을 등록하지 못했습니다", "이미 같은 자산ID가 있습니다") };

  await logAction({
    action: "inventory_asset_create",
    targetType: "inventory_asset",
    targetLabel: assetCode,
    // 🔑 분류 라벨을 **스냅샷**으로 함께 남긴다 — 분류가 학원별 데이터라 감사로그(순수·동기)가 나중에
    //    라벨을 되짚을 수 없다(0247a 이전 행은 describe.ts가 내장 7종으로 폴백한다).
    metadata: { assetId: data.id, assetCode, category: cat.key, categoryLabel: cat.label, status },
  });
  refresh();
  return { ok: true };
}

export async function updateAsset(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "자산을 찾지 못했습니다" };
  const assetCode = normalizeAssetCode(String(fd.get("assetCode") ?? ""));
  if (!isValidAssetCode(assetCode)) return { error: "자산ID는 영문 대문자·숫자·하이픈 2~32자입니다(예: NB-019)" };
  const read = readAssetFields(fd);
  if (!read.ok) return { error: read.error };
  const fields = read.values;

  const admin = createAdminClient();
  const cat = await resolveCategory(admin, ctx.tenantId, fd.get("category"));
  if ("error" in cat) return cat;
  const category = cat.key;
  const { data: cur, error: curErr } = await admin
    .from("inventory_assets")
    .select("asset_code, category, maker, model, serial_no, acquired_on, location, note")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "자산을 불러오지 못했습니다") };
  if (!cur) return { error: "자산을 찾지 못했습니다" };

  const next = {
    asset_code: assetCode,
    category,
    maker: fields.maker,
    model: fields.model,
    serial_no: fields.serialNo,
    acquired_on: fields.acquiredOn,
    location: fields.location,
    note: fields.note,
  };
  // 바뀐 칸을 **한글 라벨**로 남긴다(감사로그 상세가 컬럼명을 내보내지 않게).
  const labels: Record<keyof typeof next, string> = {
    asset_code: "자산ID", category: "분류", maker: "제조사", model: "모델명",
    serial_no: "시리얼번호", acquired_on: "입고일", location: "현위치", note: "비고",
  };
  const changed = (Object.keys(next) as (keyof typeof next)[])
    .filter((k) => (cur[k] ?? null) !== (next[k] ?? null))
    .map((k) => labels[k]);
  if (changed.length === 0) return { ok: true };

  const { error } = await admin.from("inventory_assets").update(next).eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "자산을 수정하지 못했습니다", "이미 같은 자산ID가 있습니다") };

  await logAction({
    action: "inventory_asset_update",
    targetType: "inventory_asset",
    targetLabel: assetCode,
    metadata: { assetId: id, assetCode, changed },
  });
  refresh();
  return { ok: true };
}

/**
 * 상태 변경 — 폐기로 바꾸면 폐기일을 함께 받는다(CHECK `disposed_on is null or status='disposed'`와 짝).
 * 🔴 대여중으로는 못 바꾼다(대여 시작으로). 🔴 열린 대여가 있는 자산은 반납이 먼저다(상태만 바꾸면 대여
 *    행이 '대여중'인 채 자산은 '사용중'이 되어 두 표가 서로 다른 말을 한다).
 */
export async function setAssetStatus(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "자산을 찾지 못했습니다" };
  const status = String(fd.get("status") ?? "");
  if (!isAssetStatus(status)) return { error: "상태 값이 올바르지 않습니다" };
  if (status === "on_loan") return { error: "대여중은 '대여 시작'으로 바꾸세요(대여자·기간이 함께 기록됩니다)" };
  const disposed = dateField(fd, "disposedOn", "폐기일");
  if ("error" in disposed) return disposed;
  if (status === "disposed" && !disposed.value) return { error: "폐기 상태는 폐기일이 필요합니다" };

  const admin = createAdminClient();
  const [{ data: cur, error: curErr }, { count: openLoans, error: loanErr }] = await Promise.all([
    admin.from("inventory_assets").select("asset_code, status").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    admin.from("inventory_loans").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("asset_id", id).eq("status", "out"),
  ]);
  if (curErr) return { error: friendlyInventoryError(curErr, "자산을 불러오지 못했습니다") };
  if (!cur) return { error: "자산을 찾지 못했습니다" };
  if (loanErr) return { error: friendlyInventoryError(loanErr, "대여 여부를 확인하지 못했습니다") };
  if ((openLoans ?? 0) > 0) return { error: "대여 중인 자산입니다 — 대여 면에서 먼저 반납 처리하세요" };
  if (cur.status === status && status !== "disposed") return { ok: true };

  const { error } = await admin
    .from("inventory_assets")
    .update({
      status,
      disposed_on: status === "disposed" ? disposed.value : null,
      // 대여 행 없이 '대여중'이던 자산(가져온 기록)이 다른 상태로 가면 보유자 표기도 함께 지운다.
      ...(cur.status === "on_loan" ? { holder_user_id: null, holder_name: null } : {}),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "상태를 바꾸지 못했습니다") };

  await logAction({
    action: "inventory_asset_status",
    targetType: "inventory_asset",
    targetLabel: cur.asset_code,
    metadata: { assetId: id, assetCode: cur.asset_code, from: cur.status, to: status, disposedOn: status === "disposed" ? disposed.value : null },
  });
  refresh();
  return { ok: true };
}

/**
 * **사용자(보유자) 지정** — 자산 표의 '사용자' 칸 더블클릭(원장 2026-09-08
 * *"재고 관리에서 더블클릭해도 사용자 수정을 할 수 없네 … 더블클릭에서 지정할 수 있도록"*).
 *
 * 🔴 **대여 중인 자산은 여기서 못 고친다** — 그 값은 대여자에서 파생된 스냅샷이라, 한쪽만 고치면
 *    자산 표와 대여 표가 다른 이름을 말한다. 판정은 순수 규약 [`holderEditBlockReason`](../loan-link.ts)이고
 *    서버가 **다시 계산**한다([[#77]] — 화면에서 막았다고 끝이 아니다).
 * ⚠️ 이름은 자유 입력이다 — 실데이터에 `셔틀담당`·`확인필요`처럼 계정이 없는 값이 들어 있다.
 *    계정을 고르면 `holder_user_id`도 함께 적어 나중에 사람이 바뀌어도 되짚을 수 있게 한다.
 */
export async function setAssetHolder(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "자산을 찾지 못했습니다" };
  const holder = textField(fd, "holderName", "사용자", 80);
  if ("error" in holder) return holder;
  const holderUserId = idField(fd, "holderUserId");

  const admin = createAdminClient();
  const [{ data: cur, error: curErr }, { data: loans, error: loanErr }] = await Promise.all([
    admin.from("inventory_assets").select("asset_code, status, holder_name").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
    admin.from("inventory_loans").select("status").eq("asset_id", id).eq("tenant_id", ctx.tenantId),
  ]);
  if (curErr) return { error: friendlyInventoryError(curErr, "자산을 불러오지 못했습니다") };
  if (!cur) return { error: "자산을 찾지 못했습니다" };
  if (loanErr) return { error: friendlyInventoryError(loanErr, "대여 여부를 확인하지 못했습니다") };
  const blocked = holderEditBlockReason({ status: cur.status }, (loans ?? []).map((l) => ({ status: l.status as string })));
  if (blocked) return { error: blocked };

  const { error } = await admin
    .from("inventory_assets")
    .update({ holder_name: holder.value, holder_user_id: holder.value ? holderUserId : null })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "사용자를 저장하지 못했습니다") };

  await logAction({
    action: "inventory_asset_holder",
    targetType: "inventory_asset",
    targetLabel: cur.asset_code,
    metadata: { assetId: id, assetCode: cur.asset_code, from: cur.holder_name, to: holder.value },
  });
  refresh();
  return { ok: true };
}

/**
 * **자산 삭제** — 잘못 등록한 것을 지운다(원장 2026-09-08 *"실수로 등록했을때 삭제할 수 있도록 배선처리"*).
 *
 * 🔴 **대여·실사 이력이 함께 지워진다**(FK `on delete cascade`) — 화면이 그 사실을 먼저 말하고,
 *    지워질 건수를 세어 보여 준 뒤에만 누르게 한다.
 * 🔴 열린 대여가 있으면 거절한다 — 남이 갖고 있는 물건을 장부에서 지우는 것은 실수 정정이 아니다.
 * ⚠️ 감사로그에 **지워진 자산의 내용을 스냅샷으로 남긴다** — 행이 사라지면 되짚을 근거가 로그뿐이다.
 */
export async function deleteAsset(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "자산을 찾지 못했습니다" };

  const admin = createAdminClient();
  const [{ data: cur, error: curErr }, { count: openLoans, error: openErr }, { count: loanCount }, { count: auditCount }] =
    await Promise.all([
      admin.from("inventory_assets").select("asset_code, category, maker, model, status, location, holder_name").eq("id", id).eq("tenant_id", ctx.tenantId).maybeSingle(),
      admin.from("inventory_loans").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("asset_id", id).eq("status", "out"),
      admin.from("inventory_loans").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("asset_id", id),
      admin.from("inventory_audits").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("asset_id", id),
    ]);
  if (curErr) return { error: friendlyInventoryError(curErr, "자산을 불러오지 못했습니다") };
  if (!cur) return { error: "자산을 찾지 못했습니다" };
  if (openErr) return { error: friendlyInventoryError(openErr, "대여 여부를 확인하지 못했습니다") };
  if ((openLoans ?? 0) > 0) return { error: "대여 중인 자산입니다 — 반납 처리 후에 지울 수 있습니다" };

  const { error } = await admin.from("inventory_assets").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "자산을 지우지 못했습니다") };

  await logAction({
    action: "inventory_asset_delete",
    targetType: "inventory_asset",
    targetLabel: cur.asset_code,
    metadata: {
      assetId: id, assetCode: cur.asset_code, category: cur.category, maker: cur.maker, model: cur.model,
      status: cur.status, location: cur.location, holderName: cur.holder_name,
      cascadedLoans: loanCount ?? 0, cascadedAudits: auditCount ?? 0,
    },
  });
  refresh();
  return { ok: true };
}
