"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { buildCategoryMaps, normalizeCategoryText, type InventoryCategory } from "../category";
import { confirmMatchesPlan, planNewCategories, planToCategories, type NewCategoryPlan } from "../category-plan";
import { loadCategoriesForWrite } from "./category-queries";
import {
  ASSET_SHEET_COLUMNS,
  ASSET_SHEET_NAME,
  SUPPLY_SHEET_COLUMNS,
  SUPPLY_SHEET_NAME,
  duplicateKeyErrors,
  isBlankCells,
  isExcelMode,
  mapHeaders,
  parseAssetSheetRow,
  parseSupplySheetRow,
  type AssetSheetKey,
  type AssetSheetRow,
  type ExcelMode,
  type SupplySheetKey,
  type SupplySheetRow,
} from "../excel-sheet";
import { assetStatusLabel } from "../status";
import { cellText } from "./excel-cell";
import { friendlyInventoryError, requireInventoryWrite, type InventoryWriteCtx } from "./access";

/**
 * 엑셀 업로드 — 원장 2026-09-02: *"작성 후 업로드시에 그대로 반영 — 덮어쓰기 또는 추가 방식"* · *"업로드하면 미리보기로
 * 어떻게 추가되는지 보여주고(파일이 형식에 맞을 경우), 형식에 맞지 않을 경우 일치하지 않는다고 경고 띄우고 업로드 취소"*.
 *
 * 흐름: 파일 → 서식 확인(자산ID·분류·상태 열이 없으면 **서식 불일치** = 취소) → 행 파싱 → 기존 행과 대조(키 = 자산ID / 품목ID)
 * → 행별 미리보기(추가/갱신/건너뜀) → **오류가 하나라도 있으면 아무것도 안 쓴다**(전부 또는 전무) → `dryRun`이면 여기서 끝.
 * 🔴 열린 대여가 있는 자산은 덮어쓰기여도 **상태·사용자 칸은 파일 값으로 바꾸지 않는다**(대여 행과 자산이 갈리면 "누가 갖고
 *    있나"가 두 표에서 다른 말을 한다) — `notes`로 알린다. ⚠️ admin 클라이언트 = RLS 우회 → 모든 쿼리에 tenant_id 명시. 5MB까지.
 *
 * 🔑 **모르는 분류는 오류가 아니라 새 분류다**(원장 2026-09-03) — 미리보기가 `newCategories`로 무엇이 생기는지 보여 주고,
 *    [반영]을 누르면 화면이 확인 창을 띄운다. 🔴 게이트는 화면이 아니라 서버([[#77]]): 여기서 계획을 **다시 계산해**
 *    클라가 보낸 확인 목록과 정확히 같을 때만 통과시킨다(확인 창을 건너뛴 요청은 거절).
 * 🔑 분류 insert는 자산 insert **앞**(FK 순서). 자산 insert가 실패하면 방금 만든 분류를 되돌린다(전부 또는 전무).
 */
export type ExcelCounts = { total: number; insert: number; update: number; skip: number };
export type ExcelPreviewRow = { rowNum: number; key: string; action: "insert" | "update" | "skip"; summary: string };
export type ExcelImportResult =
  | {
      error?: string;
      /** 서식 자체가 안 맞음(열 이름) — 화면이 파일 선택을 취소한다. */
      formatMismatch?: boolean;
      mode?: ExcelMode;
      dryRun?: boolean;
      assets?: ExcelCounts;
      supplies?: ExcelCounts;
      preview?: { assets: ExcelPreviewRow[]; supplies: ExcelPreviewRow[] };
      /** 이 파일이 **새로 만들** 분류 — 비어 있으면 확인 창을 띄우지 않는다(매번 뜨면 아무도 안 읽는다). */
      newCategories?: NewCategoryPlan[];
      /** 확인 목록이 계획과 어긋났다 — 파일은 그대로라 **다시 확인하면 반영된다**(화면이 [반영]을 안 잠근다). */
      needsReconfirm?: boolean;
      errors?: string[];
      notes?: string[];
      applied?: boolean;
    }
  | undefined;

/** 확인 목록(클라가 보낸 JSON 배열) — 모양이 아니면 빈 배열(= 계획과 불일치 → 거절). */
function readConfirmedLabels(raw: FormDataEntryValue | null): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const MAX_BYTES = 5 * 1024 * 1024;
const REQUIRED_ASSET_HEADERS: AssetSheetKey[] = ["assetCode", "category", "status"];

function readSheet<K extends string>(ws: ExcelJS.Worksheet, columns: ReadonlyArray<{ key: K; header: string }>) {
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell.value);
  });
  const map = mapHeaders(headers, columns);
  const rows: { rowNum: number; cells: Partial<Record<K, string>> }[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Partial<Record<K, string>> = {};
    for (const [key, idx] of map) cells[key] = cellText(row.getCell(idx + 1).value).trim();
    if (isBlankCells(cells)) continue;
    rows.push({ rowNum: r, cells });
  }
  return { map, rows };
}

export async function importInventoryExcel(fd: FormData): Promise<ExcelImportResult> {
  const gate = await requireInventoryWrite();
  if ("error" in gate) return gate;
  // ⚠️ 타입을 못박아 둔다 — 좁힘(narrowing)만으론 아래 중첩 함수(rollbackCategories) 안에서 유지되지 않는다.
  const ctx: InventoryWriteCtx = gate;
  const file = fd.get("file");
  if (!(file instanceof File)) return { error: "엑셀 파일을 선택하세요" };
  if (file.size > MAX_BYTES) return { error: "파일이 너무 큽니다(5MB까지)", formatMismatch: true };
  const modeRaw = String(fd.get("mode") ?? "append");
  if (!isExcelMode(modeRaw)) return { error: "반영 방식이 올바르지 않습니다" };
  const mode: ExcelMode = modeRaw;
  const dryRun = String(fd.get("dryRun") ?? "") === "1";

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(await file.arrayBuffer());
  } catch {
    return { error: "엑셀 파일을 읽지 못했습니다 — xlsx 형식인지 확인하세요", formatMismatch: true };
  }
  const assetWs = wb.getWorksheet(ASSET_SHEET_NAME) ?? wb.worksheets[0];
  const supplyWs = wb.getWorksheet(SUPPLY_SHEET_NAME) ?? null;
  if (!assetWs) return { error: "시트를 찾을 수 없습니다 — 내려받은 서식으로 작성해 주세요", formatMismatch: true };

  const errors: string[] = [];
  const notes: string[] = [];

  // ── 자산 시트 — 서식 확인 ────────────────────────────────────────────────────────
  const a = readSheet<AssetSheetKey>(assetWs, ASSET_SHEET_COLUMNS);
  const missingHeaders = REQUIRED_ASSET_HEADERS.filter((k) => !a.map.has(k)).map((k) => ASSET_SHEET_COLUMNS.find((c) => c.key === k)!.header);
  if (missingHeaders.length > 0) {
    return {
      error: `서식이 일치하지 않습니다 — 자산 시트에 ${missingHeaders.map((h) => `'${h}'`).join("·")} 열이 없습니다. [서식 내려받기]로 받은 파일에 작성해 주세요.`,
      formatMismatch: true,
    };
  }
  // ── 기존 행·분류 목록 — 서로 독립이라 함께 받는다(B4). 분류 목록은 행을 파싱하기 **전에** 있어야 한다. ──
  const admin = createAdminClient();
  type ExistingAsset = { id: string; asset_code: string; status: string; holder_name: string | null; sort_order: number };
  type ExistingSupply = { id: string; item_code: string | null; sort_order: number };
  let existingAssets: ExistingAsset[];
  let existingSupplies: ExistingSupply[];
  let openLoanAssetIds: Set<string>;
  let categoryData: Awaited<ReturnType<typeof loadCategoriesForWrite>>;
  try {
    [categoryData, existingAssets, existingSupplies, openLoanAssetIds] = await Promise.all([
      loadCategoriesForWrite(admin, ctx.tenantId),
      fetchAllPaged<ExistingAsset>((from, to) =>
        admin.from("inventory_assets").select("id, asset_code, status, holder_name, sort_order").eq("tenant_id", ctx.tenantId).range(from, to),
      ),
      fetchAllPaged<ExistingSupply>((from, to) =>
        admin.from("inventory_supplies").select("id, item_code, sort_order").eq("tenant_id", ctx.tenantId).range(from, to),
      ),
      fetchAllPaged<{ asset_id: string }>((from, to) =>
        admin.from("inventory_loans").select("asset_id").eq("tenant_id", ctx.tenantId).eq("status", "out").range(from, to),
      ).then((rows) => new Set(rows.map((r) => r.asset_id))),
    ]);
  } catch (e) {
    return { error: friendlyInventoryError({ message: e instanceof Error ? e.message : String(e) }, "기존 재고를 불러오지 못했습니다") };
  }
  const categoryMaps = buildCategoryMaps(categoryData.rows);

  const assetRows: AssetSheetRow[] = [];
  for (const { rowNum, cells } of a.rows) {
    const p = parseAssetSheetRow(cells, rowNum, categoryMaps);
    if (p.ok) assetRows.push(p.row);
    else errors.push(p.error);
  }
  errors.push(...duplicateKeyErrors(assetRows, (r) => r.assetCode, "자산ID"));

  // ── 소모품 시트(있을 때만) ─────────────────────────────────────────────────────
  const supplyRows: SupplySheetRow[] = [];
  if (supplyWs) {
    const s = readSheet<SupplySheetKey>(supplyWs, SUPPLY_SHEET_COLUMNS);
    if (s.rows.length > 0 && !s.map.has("itemCode")) {
      return { error: "서식이 일치하지 않습니다 — 소모품 시트에 '품목ID' 열이 없습니다.", formatMismatch: true };
    }
    for (const { rowNum, cells } of s.rows) {
      const p = parseSupplySheetRow(cells, rowNum);
      if (p.ok) supplyRows.push(p.row);
      else errors.push(p.error);
    }
    errors.push(...duplicateKeyErrors(supplyRows, (r) => r.itemCode, "품목ID"));
  }
  if (assetRows.length === 0 && supplyRows.length === 0 && errors.length === 0) return { error: "데이터 행이 없습니다" };

  const assetByCode = new Map(existingAssets.map((r) => [r.asset_code, r]));
  const supplyByCode = new Map(existingSupplies.filter((r) => r.item_code).map((r) => [r.item_code!.toUpperCase(), r]));

  const assetPlan = { insert: [] as AssetSheetRow[], update: [] as { row: AssetSheetRow; cur: ExistingAsset }[], skip: 0 };
  const assetPreview: ExcelPreviewRow[] = [];
  for (const row of assetRows) {
    const cur = assetByCode.get(row.assetCode);
    const action: ExcelPreviewRow["action"] = !cur ? "insert" : mode === "overwrite" ? "update" : "skip";
    if (action === "insert") assetPlan.insert.push(row);
    else if (action === "update") assetPlan.update.push({ row, cur: cur! });
    else assetPlan.skip += 1;
    assetPreview.push({
      rowNum: row.rowNum, key: row.assetCode, action,
      // 새 분류 행은 라벨 뒤에 '(새 분류)'. 🔴 건너뛰는 행엔 안 붙인다 — 그 행은 안 쓰이니 분류도 안 생긴다.
      summary: `${row.categoryLabel}${row.categoryKey === null && action !== "skip" ? "(새 분류)" : ""} · ${row.model ?? "모델 미기재"} · ${row.statusGiven ? assetStatusLabel(row.status) : cur ? `상태 유지(${assetStatusLabel(cur.status)})` : assetStatusLabel(row.status)}${row.location ? ` · ${row.location}` : ""}`,
    });
  }
  // ── 모르는 분류 → 새로 만들 분류 계획(오류 아님) ────────────────────────────────
  // 🔴 **실제로 쓰이는 행만** 센다(추가 방식에서 건너뛰는 행의 오타가 아무도 안 쓰는 분류를 만들면 안 된다).
  // 🔴 분류 표가 준비되지 않았으면(`ready:false`) 자동 추가를 잠근다 — 없는 표에 만들 수는 없다(fail-closed).
  //    그때는 계획을 **비워서 내려보낸다**(미리보기가 "새 분류가 생긴다"고 약속해 놓고 오류로 막으면 거짓말이다).
  const writtenRows: AssetSheetRow[] = [...assetPlan.insert, ...assetPlan.update.map((u) => u.row)];
  const planned = planNewCategories(
    writtenRows.filter((r) => r.categoryKey === null).map((r) => ({ label: r.categoryLabel, assetCode: r.assetCode })),
    categoryData.rows,
  );
  const newCategories = categoryData.ready ? planned : [];
  if (planned.length > 0 && !categoryData.ready) {
    // 🔴 원인을 단정하지 않는다 — 표 없음(0247a 미적용)과 시드 0건은 다른 사실이다.
    errors.push(
      `분류 ${planned.map((c) => `"${c.label}"`).join("·")}은(는) 등록된 분류가 아닙니다 — ` +
        "지금은 자산 분류 표를 읽지 못해(마이그레이션 0247a 적용·시드 확인 필요) 새 분류를 만들 수 없습니다. 등록된 분류로 고쳐 주세요.",
    );
  }
  const keyByNewLabel = new Map(newCategories.map((c) => [normalizeCategoryText(c.label), c.key]));
  /** 행의 최종 분류 키 — 이미 있으면 그 키, 새 분류면 계획이 도출한 키. */
  const categoryKeyOfRow = (r: AssetSheetRow): string =>
    r.categoryKey ?? keyByNewLabel.get(normalizeCategoryText(r.categoryLabel)) ?? "";

  const supplyPlan = { insert: [] as SupplySheetRow[], update: [] as { row: SupplySheetRow; cur: ExistingSupply }[], skip: 0 };
  const supplyPreview: ExcelPreviewRow[] = [];
  for (const row of supplyRows) {
    const cur = supplyByCode.get(row.itemCode);
    const action: ExcelPreviewRow["action"] = !cur ? "insert" : mode === "overwrite" ? "update" : "skip";
    if (action === "insert") supplyPlan.insert.push(row);
    else if (action === "update") supplyPlan.update.push({ row, cur: cur! });
    else supplyPlan.skip += 1;
    supplyPreview.push({ rowNum: row.rowNum, key: row.itemCode, action, summary: `${row.name} · ${row.makerModel ?? "미기재"} · ${row.qty}개${row.location ? ` · ${row.location}` : ""}` });
  }
  for (const { row, cur } of assetPlan.update) {
    const wantsStatus = row.statusGiven && row.status !== cur.status;
    const wantsHolder = row.holderName !== (cur.holder_name ?? null);
    if (openLoanAssetIds.has(cur.id) && (wantsStatus || wantsHolder)) {
      notes.push(`${row.assetCode}: 대여 중이라 상태·사용자 칸은 파일 값으로 바꾸지 않습니다(반납은 대여 면에서)`);
    } else if (!row.statusGiven && row.status !== cur.status) {
      notes.push(`${row.assetCode}: 상태 칸이 비어 있어 지금 상태(${assetStatusLabel(cur.status)})를 그대로 둡니다`);
    }
  }
  const counts = {
    assets: { total: assetRows.length, insert: assetPlan.insert.length, update: assetPlan.update.length, skip: assetPlan.skip },
    supplies: { total: supplyRows.length, insert: supplyPlan.insert.length, update: supplyPlan.update.length, skip: supplyPlan.skip },
  };
  const preview = { assets: assetPreview, supplies: supplyPreview };
  const base = { mode, ...counts, preview, newCategories, notes };
  if (errors.length > 0 || dryRun) return { ...base, dryRun, errors, applied: false };

  // ── 새 분류 확인(서버 재검증) ───────────────────────────────────────────────────
  // 🔴 게이트는 화면이 아니라 서버([[#77]]) — 클라가 보낸 확인 목록이 방금 계산한 계획과 **정확히 같을 때만** 통과.
  //    파일을 고른 뒤 다른 사람이 분류를 추가하면 계획이 달라지므로, 그때는 미리보기를 다시 보게 한다.
  if (newCategories.length > 0 && !confirmMatchesPlan(readConfirmedLabels(fd.get("confirmCategories")), newCategories)) {
    return {
      ...base,
      dryRun: false,
      applied: false,
      errors: [],
      // 파일은 그대로고 계획만 다시 계산됐다 — 화면이 [반영]을 잠그지 않고 새 목록으로 다시 묻는다.
      needsReconfirm: true,
      error: "새로 만들 분류를 확인해 주세요 — 미리보기에 적힌 목록과 확인한 목록이 다릅니다(아래 목록으로 다시 확인하면 반영됩니다).",
    };
  }

  // 🔴 여기까지 왔는데 **쓸 행** 중 분류 키가 안 풀린 게 있으면 아무것도 쓰지 않는다(빈 키를 넣으면 FK가
  //    거절하고, 막히기 전이라면 더 나쁘다). 정상 흐름에선 안 일어나지만 조용한 손상보다 멈추는 게 낫다.
  const unresolved = writtenRows.filter((r) => !categoryKeyOfRow(r));
  if (unresolved.length > 0) {
    return {
      ...base, dryRun: false, applied: false, errors: [],
      error: `분류를 정하지 못한 행이 있습니다(${unresolved.slice(0, 5).map((r) => `${r.rowNum}행`).join("·")}) — 아무것도 반영하지 않았습니다.`,
    };
  }

  // ── 반영 ───────────────────────────────────────────────────────────────────────
  // 🔑 분류 insert가 **먼저**다(자산이 FK로 분류를 가리킨다). 자산 insert가 실패하면 방금 만든 분류를 되돌린다.
  let createdCategoryIds: string[] = [];
  if (newCategories.length > 0) {
    const rows: InventoryCategory[] = planToCategories(newCategories, categoryData.rows);
    const { data, error } = await admin
      .from("inventory_categories")
      .insert(
        rows.map((c) => ({
          tenant_id: ctx.tenantId, key: c.key, label: c.label, code_prefix: c.codePrefix,
          sort_order: c.sortOrder, created_by: ctx.userId,
        })),
      )
      .select("id");
    if (error) {
      return {
        ...base, dryRun: false, applied: false, errors: [],
        error: friendlyInventoryError(error, "분류를 추가하지 못했습니다(아무것도 반영되지 않았습니다)", "이미 같은 이름·접두의 분류가 있습니다 — 미리보기를 다시 받아 주세요"),
      };
    }
    createdCategoryIds = (data ?? []).map((r) => r.id);
    await logAction({
      action: "inventory_category_create",
      targetType: "inventory_category",
      targetLabel: rows.map((c) => c.label).join("·"),
      metadata: { source: "excel", labels: rows.map((c) => c.label), keys: rows.map((c) => c.key), prefixes: rows.map((c) => c.codePrefix) },
    });
  }
  /**
   * 자산을 **한 줄도 못 쓴 채** 엎어지면 방금 만든 분류를 되돌린다(아직 아무것도 참조하지 않는다).
   * ⚠️ 자산이 이미 들어간 뒤에 실패하면 되돌리지 않는다 — 그 분류를 그 자산이 쓰고 있어 FK가 막는다.
   */
  let wroteAsset = false;
  const rollbackCategories = async () => {
    if (createdCategoryIds.length === 0 || wroteAsset) return;
    await admin.from("inventory_categories").delete().in("id", createdCategoryIds).eq("tenant_id", ctx.tenantId);
  };

  const assetSortBase = existingAssets.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
  if (assetPlan.insert.length > 0) {
    const { error } = await admin.from("inventory_assets").insert(
      assetPlan.insert.map((r, i) => ({
        tenant_id: ctx.tenantId, asset_code: r.assetCode, category: categoryKeyOfRow(r), maker: r.maker, model: r.model,
        serial_no: r.serialNo, acquired_on: r.acquiredOn, status: r.status, location: r.location,
        holder_name: r.holderName, last_audited_on: r.lastAuditedOn, disposed_on: r.disposedOn, note: r.note,
        sort_order: assetSortBase + i,
      })),
    );
    if (error) {
      await rollbackCategories();
      return { error: friendlyInventoryError(error, "자산을 추가하지 못했습니다(아무것도 반영되지 않았습니다)", "이미 같은 자산ID가 있습니다") };
    }
    wroteAsset = true;
  }
  for (const { row, cur } of assetPlan.update) {
    const locked = openLoanAssetIds.has(cur.id);
    const { error } = await admin
      .from("inventory_assets")
      .update({
        category: categoryKeyOfRow(row), maker: row.maker, model: row.model, serial_no: row.serialNo, acquired_on: row.acquiredOn,
        location: row.location, last_audited_on: row.lastAuditedOn, note: row.note,
        // 열린 대여가 있으면 상태·사용자·폐기일을 안 건드리고, 상태 칸이 비어 있으면 상태·폐기일도 그대로 둔다.
        ...(locked ? {} : row.statusGiven ? { status: row.status, holder_name: row.holderName, disposed_on: row.disposedOn } : { holder_name: row.holderName }),
      })
      .eq("id", cur.id)
      .eq("tenant_id", ctx.tenantId);
    if (error) {
      await rollbackCategories();
      return { error: friendlyInventoryError(error, `${row.assetCode}을(를) 갱신하지 못했습니다 — 그 앞까지는 반영됐습니다`) };
    }
    wroteAsset = true;
  }
  const supplySortBase = existingSupplies.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
  if (supplyPlan.insert.length > 0) {
    const { error } = await admin.from("inventory_supplies").insert(
      supplyPlan.insert.map((r, i) => ({
        tenant_id: ctx.tenantId, item_code: r.itemCode, name: r.name, maker_model: r.makerModel, qty: r.qty,
        location: r.location, checked_on: r.checkedOn, checker_name: r.checkerName, note: r.note, sort_order: supplySortBase + i,
      })),
    );
    if (error) return { error: friendlyInventoryError(error, "소모품을 추가하지 못했습니다(자산은 반영됐습니다)", "이미 같은 품목ID가 있습니다") };
  }
  for (const { row, cur } of supplyPlan.update) {
    const { error } = await admin
      .from("inventory_supplies")
      .update({ name: row.name, maker_model: row.makerModel, qty: row.qty, location: row.location, checked_on: row.checkedOn, checker_name: row.checkerName, note: row.note })
      .eq("id", cur.id)
      .eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyInventoryError(error, `${row.itemCode}을(를) 갱신하지 못했습니다 — 그 앞까지는 반영됐습니다`) };
  }

  await logAction({
    action: "inventory_excel_import",
    targetType: "inventory_asset",
    targetLabel: file.name,
    metadata: {
      mode,
      assetsInserted: counts.assets.insert, assetsUpdated: counts.assets.update, assetsSkipped: counts.assets.skip,
      suppliesInserted: counts.supplies.insert, suppliesUpdated: counts.supplies.update, suppliesSkipped: counts.supplies.skip,
      // 이 파일이 만든 분류 — 감사로그 상세가 "분류가 언제 늘었나"를 되짚을 수 있게 라벨로 남긴다.
      categoriesCreated: newCategories.map((c) => c.label),
    },
  });
  revalidatePath("/inventory");
  return { ...base, dryRun: false, errors: [], applied: true };
}
