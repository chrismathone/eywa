"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { dateField, idField, textField } from "../form";
import { loanMismatchOf } from "../loan-link";
import { friendlyInventoryError, requireInventoryWrite } from "./access";
import type { InventoryActionState } from "./asset-actions";

/**
 * 대여 시작 · 반납.
 *
 * 🔴 한 자산에 '대여중'은 하나 — DB 부분 유니크(`inventory_loans_open_uniq where status='out'`)가 최후의
 *    방어이고, 그 축으로 **upsert 하지 않는다**([[#113]] — 부분 유니크는 `ON CONFLICT` 추론이 안 된다).
 *    읽고 → 없으면 insert, 23505는 경쟁으로 보고 한글로 되돌린다.
 * 🔑 반납 때 되돌릴 상태는 **추측하지 않는다** — 대여 행의 `prev_status`(대여 전 상태)로 되돌리고,
 *    없으면(가져온 기록) 사용중.
 */
function refresh() {
  revalidatePath("/inventory");
}

export async function startLoan(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const assetId = idField(fd, "assetId");
  if (!assetId) return { error: "자산을 선택하세요" };
  const borrower = textField(fd, "borrowerName", "대여자", 80);
  if ("error" in borrower) return borrower;
  if (!borrower.value) return { error: "대여자 이름을 입력하세요" };
  const dept = textField(fd, "dept", "소속", 80);
  if ("error" in dept) return dept;
  const lent = dateField(fd, "lentOn", "대여일");
  if ("error" in lent) return lent;
  const due = dateField(fd, "dueOn", "반납예정");
  if ("error" in due) return due;
  const dueNote = textField(fd, "dueNote", "반납예정 표기", 40);
  if ("error" in dueNote) return dueNote;
  const note = textField(fd, "note", "비고", 500);
  if ("error" in note) return note;
  const lentOn = lent.value ?? kstToday();
  if (due.value && due.value < lentOn) return { error: "반납예정일이 대여일보다 앞섭니다" };

  const admin = createAdminClient();
  const [{ data: asset, error: assetErr }, { count: open, error: openErr }] = await Promise.all([
    admin.from("inventory_assets").select("asset_code, status").eq("id", assetId).eq("tenant_id", ctx.tenantId).maybeSingle(),
    admin.from("inventory_loans").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("asset_id", assetId).eq("status", "out"),
  ]);
  if (assetErr) return { error: friendlyInventoryError(assetErr, "자산을 불러오지 못했습니다") };
  if (!asset) return { error: "자산을 찾지 못했습니다" };
  if (openErr) return { error: friendlyInventoryError(openErr, "대여 여부를 확인하지 못했습니다") };
  if (asset.status === "disposed") return { error: "폐기된 자산은 대여할 수 없습니다" };
  if ((open ?? 0) > 0) return { error: "이미 대여 중인 자산입니다 — 반납 처리 후 다시 대여하세요" };

  const { data: loan, error: insErr } = await admin
    .from("inventory_loans")
    .insert({
      tenant_id: ctx.tenantId,
      asset_id: assetId,
      borrower_name: borrower.value,
      dept: dept.value,
      lent_on: lentOn,
      due_on: due.value,
      due_note: due.value ? null : dueNote.value,
      status: "out",
      // 대여 전 상태 — 자산 표가 '대여중'인데 열린 대여가 없던 경우(가져온 기록)는 되돌릴 근거가 없어 비운다.
      prev_status: asset.status === "on_loan" ? null : asset.status,
      note: note.value,
    })
    .select("id, loan_code")
    .single();
  if (insErr) return { error: friendlyInventoryError(insErr, "대여를 기록하지 못했습니다", "이미 대여 중인 자산입니다(방금 다른 사람이 기록)") };

  const { error: upErr } = await admin
    .from("inventory_assets")
    .update({ status: "on_loan", holder_name: borrower.value, holder_user_id: null })
    .eq("id", assetId)
    .eq("tenant_id", ctx.tenantId);
  if (upErr) {
    // 자산 갱신이 실패하면 방금 넣은 대여 행을 거둬 두 표가 갈리지 않게 한다(트랜잭션 대용).
    await admin.from("inventory_loans").delete().eq("id", loan.id).eq("tenant_id", ctx.tenantId);
    return { error: friendlyInventoryError(upErr, "자산 상태를 대여중으로 바꾸지 못했습니다") };
  }

  await logAction({
    action: "inventory_loan_out",
    targetType: "inventory_loan",
    targetLabel: `${asset.asset_code} · ${loan.loan_code}`,
    metadata: {
      loanId: loan.id, assetId, assetCode: asset.asset_code, borrowerName: borrower.value, dept: dept.value,
      lentOn, dueOn: due.value, dueNote: due.value ? null : dueNote.value,
    },
  });
  refresh();
  return { ok: true };
}

export async function returnLoan(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const loanId = idField(fd, "loanId");
  if (!loanId) return { error: "대여 기록을 찾지 못했습니다" };
  const ret = dateField(fd, "returnedOn", "반납일");
  if ("error" in ret) return ret;
  const returnedOn = ret.value ?? kstToday();

  const admin = createAdminClient();
  const { data: loan, error: loanErr } = await admin
    .from("inventory_loans")
    .select("id, asset_id, borrower_name, status, prev_status, lent_on")
    .eq("id", loanId)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (loanErr) return { error: friendlyInventoryError(loanErr, "대여 기록을 불러오지 못했습니다") };
  if (!loan) return { error: "대여 기록을 찾지 못했습니다" };
  if (loan.status !== "out") return { error: "대여중인 기록만 반납할 수 있습니다" };
  if (loan.lent_on && returnedOn < loan.lent_on) return { error: "반납일이 대여일보다 앞섭니다" };

  const { data: asset, error: assetErr } = await admin
    .from("inventory_assets")
    .select("asset_code, status")
    .eq("id", loan.asset_id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (assetErr) return { error: friendlyInventoryError(assetErr, "자산을 불러오지 못했습니다") };

  // 🔑 되돌릴 상태 — 대여 전 상태(prev_status). 대여중/폐기로는 되돌리지 않는다(없으면 사용중).
  const prev = loan.prev_status;
  const restored = prev && prev !== "on_loan" && prev !== "disposed" ? prev : "in_use";

  const { error: upLoanErr } = await admin
    .from("inventory_loans")
    .update({ status: "returned", returned_on: returnedOn })
    .eq("id", loanId)
    .eq("tenant_id", ctx.tenantId)
    .eq("status", "out");
  if (upLoanErr) return { error: friendlyInventoryError(upLoanErr, "반납을 기록하지 못했습니다") };

  // 자산이 아직 '대여중'일 때만 되돌린다 — 다른 경로로 이미 바뀐 상태를 덮지 않는다.
  if (asset && asset.status === "on_loan") {
    const { error: upAssetErr } = await admin
      .from("inventory_assets")
      .update({ status: restored, holder_name: null, holder_user_id: null })
      .eq("id", loan.asset_id)
      .eq("tenant_id", ctx.tenantId)
      .eq("status", "on_loan");
    if (upAssetErr) return { error: friendlyInventoryError(upAssetErr, "반납은 기록됐지만 자산 상태를 되돌리지 못했습니다 — 상태 변경에서 직접 고쳐 주세요") };
  }

  await logAction({
    action: "inventory_loan_return",
    targetType: "inventory_loan",
    targetLabel: asset?.asset_code ?? null,
    metadata: {
      loanId, assetId: loan.asset_id, assetCode: asset?.asset_code ?? null, borrowerName: loan.borrower_name,
      returnedOn, restoredStatus: asset && asset.status === "on_loan" ? restored : null,
    },
  });
  refresh();
  return { ok: true };
}

/**
 * 대여 기록 수정 — 대여자·소속·대여일·반납예정·비고 (원장 2026-09-08 *"대여자는 어디서 수정함?"*).
 *
 * 🔴 **상태(대여중/반납/확인필요/회수불가)는 여기서 못 바꾼다** — 상태 전이는 [반납]·[맞추기]가
 *    자산 상태까지 함께 옮기는 일이라, 이 폼에서 열면 두 표가 갈린다.
 * 🔑 **열린 대여의 대여자를 바꾸면 자산의 '사용자'도 함께 바꾼다** — 그 값은 대여자에서 파생된
 *    스냅샷이라, 한쪽만 고치면 자산 표와 대여 표가 다른 이름을 말한다(이 배선의 이유 그 자체).
 */
export async function updateLoan(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd, "id");
  if (!id) return { error: "대여 기록을 찾지 못했습니다" };
  const borrower = textField(fd, "borrowerName", "대여자", 80);
  if ("error" in borrower) return borrower;
  if (!borrower.value) return { error: "대여자 이름을 입력하세요" };
  const dept = textField(fd, "dept", "소속", 80);
  if ("error" in dept) return dept;
  const lent = dateField(fd, "lentOn", "대여일");
  if ("error" in lent) return lent;
  const due = dateField(fd, "dueOn", "반납예정");
  if ("error" in due) return due;
  const dueNote = textField(fd, "dueNote", "반납예정 표기", 40);
  if ("error" in dueNote) return dueNote;
  const note = textField(fd, "note", "비고", 500);
  if ("error" in note) return note;
  if (due.value && lent.value && due.value < lent.value) return { error: "반납예정일이 대여일보다 앞섭니다" };

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_loans")
    .select("loan_code, asset_id, status, borrower_name, inventory_assets!inventory_loans_asset_id_fkey(asset_code)")
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "대여 기록을 불러오지 못했습니다") };
  if (!cur) return { error: "대여 기록을 찾지 못했습니다" };

  const { error } = await admin
    .from("inventory_loans")
    .update({
      borrower_name: borrower.value,
      dept: dept.value,
      lent_on: lent.value,
      due_on: due.value,
      due_note: due.value ? null : dueNote.value,
      note: note.value,
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "대여 기록을 고치지 못했습니다") };

  // 열린 대여면 자산의 '사용자'가 이 이름을 그대로 비춘다.
  if (cur.status === "out" && borrower.value !== cur.borrower_name) {
    const { error: upErr } = await admin
      .from("inventory_assets")
      .update({ holder_name: borrower.value, holder_user_id: null })
      .eq("id", cur.asset_id)
      .eq("tenant_id", ctx.tenantId);
    if (upErr) return { error: friendlyInventoryError(upErr, "자산의 사용자 표기를 함께 바꾸지 못했습니다") };
  }

  const assetRow = Array.isArray(cur.inventory_assets) ? cur.inventory_assets[0] : cur.inventory_assets;
  await logAction({
    action: "inventory_loan_update",
    targetType: "inventory_loan",
    targetLabel: `${assetRow?.asset_code ?? ""} · ${cur.loan_code}`,
    metadata: {
      loanId: id, assetId: cur.asset_id, loanStatus: cur.status,
      from: cur.borrower_name, to: borrower.value, dept: dept.value,
      lentOn: lent.value, dueOn: due.value, dueNote: due.value ? null : dueNote.value,
    },
  });
  refresh();
  return { ok: true };
}

/**
 * **맞추기** — 열린 대여가 없는데 '대여중'으로 남은 자산을 장부가 말하는 상태로 되돌린다
 * (원장 2026-09-08 *"연동 가능하게 배선해야할듯"*).
 *
 * 🔴 **사람이 누를 때만** 돈다(재고관리 상위 결정: 자동 쓰기 없음). 무엇으로 맞출지는 순수 규약
 *    [`loanMismatchOf`](../loan-link.ts)가 정하고, 서버가 **그 판정을 다시 계산**한다([[#77]] — 클라가
 *    보낸 목표 상태를 믿지 않는다).
 * ⚠️ 그 사이 누가 대여를 시작했으면(열린 대여가 생겼으면) 어긋남이 사라지므로 아무것도 안 하고 알린다.
 */
export async function syncAssetToLoans(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const assetId = idField(fd, "assetId");
  if (!assetId) return { error: "자산을 찾지 못했습니다" };

  const admin = createAdminClient();
  const [{ data: asset, error: assetErr }, { data: loans, error: loanErr }] = await Promise.all([
    admin.from("inventory_assets").select("asset_code, status").eq("id", assetId).eq("tenant_id", ctx.tenantId).maybeSingle(),
    admin.from("inventory_loans").select("loan_code, status").eq("asset_id", assetId).eq("tenant_id", ctx.tenantId),
  ]);
  if (assetErr) return { error: friendlyInventoryError(assetErr, "자산을 불러오지 못했습니다") };
  if (!asset) return { error: "자산을 찾지 못했습니다" };
  if (loanErr) return { error: friendlyInventoryError(loanErr, "대여 기록을 불러오지 못했습니다") };

  const mismatch = loanMismatchOf(
    { status: asset.status },
    (loans ?? []).map((l) => ({ loanCode: l.loan_code as string, status: l.status as string })),
  );
  if (!mismatch) return { error: "이 자산은 대여 장부와 어긋나지 않습니다(이미 정리됐습니다)" };

  const { error } = await admin
    .from("inventory_assets")
    // '대여중'에서 벗어나므로 대여자 표기도 함께 지운다(setAssetStatus와 같은 규약).
    .update({ status: mismatch.expected, holder_user_id: null, holder_name: null })
    .eq("id", assetId)
    .eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "자산 상태를 맞추지 못했습니다") };

  await logAction({
    action: "inventory_asset_status",
    targetType: "inventory_asset",
    targetLabel: asset.asset_code,
    metadata: {
      assetId, assetCode: asset.asset_code, from: mismatch.current, to: mismatch.expected,
      via: "loan_sync", loanCode: mismatch.loanCode, reason: mismatch.reason,
    },
  });
  refresh();
  return { ok: true };
}

/**
 * **대여 기록 삭제** — 잘못 만든 이력을 지운다(원장 2026-09-08 *"실수로 등록했을때 삭제할 수 있도록"*).
 *
 * 🔴 **열린 대여를 지우면 자산이 '대여중'인 채로 남는다** — 그래서 지우기 전에 자산 상태를
 *    `prev_status`(없으면 사용중)로 함께 되돌린다. 반납과 같은 규약이고, 이 배선이 없으면 오늘 원장이
 *    본 그 어긋남(장부 3 vs 상태 4)을 우리가 새로 만드는 셈이 된다.
 * ⚠️ 되돌린 자산 상태를 감사로그에 함께 남긴다 — 행이 사라지면 되짚을 근거가 로그뿐이다.
 */
export async function deleteLoan(fd: FormData): Promise<InventoryActionState> {
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
  const id = idField(fd);
  if (!id) return { error: "대여 기록을 찾지 못했습니다" };

  const admin = createAdminClient();
  const { data: cur, error: curErr } = await admin
    .from("inventory_loans")
    .select(
      "loan_code, asset_id, status, borrower_name, dept, lent_on, due_on, returned_on, prev_status, inventory_assets!inventory_loans_asset_id_fkey(asset_code, status)",
    )
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();
  if (curErr) return { error: friendlyInventoryError(curErr, "대여 기록을 불러오지 못했습니다") };
  if (!cur) return { error: "대여 기록을 찾지 못했습니다" };
  const assetRow = Array.isArray(cur.inventory_assets) ? cur.inventory_assets[0] : cur.inventory_assets;

  // 열린 대여였으면 자산을 먼저 되돌린다 — 순서를 바꾸면 지우고 나서 되돌릴 근거(prev_status)가 사라진다.
  let restored: string | null = null;
  if (cur.status === "out" && assetRow?.status === "on_loan") {
    restored = (cur.prev_status as string | null) ?? "in_use";
    const { error: upErr } = await admin
      .from("inventory_assets")
      .update({ status: restored, holder_user_id: null, holder_name: null })
      .eq("id", cur.asset_id)
      .eq("tenant_id", ctx.tenantId);
    if (upErr) return { error: friendlyInventoryError(upErr, "자산 상태를 되돌리지 못했습니다") };
  }

  const { error } = await admin.from("inventory_loans").delete().eq("id", id).eq("tenant_id", ctx.tenantId);
  if (error) return { error: friendlyInventoryError(error, "대여 기록을 지우지 못했습니다") };

  await logAction({
    action: "inventory_loan_delete",
    targetType: "inventory_loan",
    targetLabel: `${assetRow?.asset_code ?? ""} · ${cur.loan_code}`,
    metadata: {
      loanId: id,
      assetId: cur.asset_id,
      assetCode: assetRow?.asset_code ?? null,
      loanCode: cur.loan_code,
      loanStatus: cur.status,
      borrowerName: cur.borrower_name,
      dept: cur.dept,
      lentOn: cur.lent_on,
      dueOn: cur.due_on,
      returnedOn: cur.returned_on,
      restoredAssetStatus: restored,
    },
  });
  refresh();
  return { ok: true };
}
