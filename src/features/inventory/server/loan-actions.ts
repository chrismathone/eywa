"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { kstToday } from "@/lib/date-kst";
import { logAction } from "@/features/audit/server/log";
import { dateField, idField, textField } from "../form";
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
