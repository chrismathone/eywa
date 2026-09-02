"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { assetCategoryLabel } from "../category";
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
import { friendlyInventoryError, requireInventoryWrite } from "./access";

/**
 * 엑셀 업로드 — 원장 2026-09-02: *"작성 후 업로드시에 그대로 반영 — 덮어쓰기 또는 추가 방식"* · *"업로드하면 미리보기로
 * 어떻게 추가되는지 보여주고(파일이 형식에 맞을 경우), 형식에 맞지 않을 경우 일치하지 않는다고 경고 띄우고 업로드 취소"*.
 *
 * 흐름: 파일 → 서식 확인(자산ID·분류·상태 열이 없으면 **서식 불일치** = 취소) → 행 파싱 → 기존 행과 대조(키 = 자산ID / 품목ID)
 * → 행별 미리보기(추가/갱신/건너뜀) → **오류가 하나라도 있으면 아무것도 안 쓴다**(전부 또는 전무) → `dryRun`이면 여기서 끝.
 * 🔴 열린 대여가 있는 자산은 덮어쓰기여도 **상태·사용자 칸은 파일 값으로 바꾸지 않는다**(대여 행과 자산이 갈리면 "누가 갖고
 *    있나"가 두 표에서 다른 말을 한다) — `notes`로 알린다. ⚠️ admin 클라이언트 = RLS 우회 → 모든 쿼리에 tenant_id 명시. 5MB까지.
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
      errors?: string[];
      notes?: string[];
      applied?: boolean;
    }
  | undefined;

const MAX_BYTES = 5 * 1024 * 1024;
const REQUIRED_ASSET_HEADERS: AssetSheetKey[] = ["assetCode", "category", "status"];

/** ExcelJS 셀 값 → 문자열(richText·수식 결과·하이퍼링크·날짜·숫자 안전화). 날짜는 UTC 성분으로 YYYY-MM-DD(엑셀 날짜엔 시간대가 없다). */
function cellText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, "0")}-${String(v.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (o.result != null) return cellText(o.result);
    return String(v);
  }
  return String(v);
}

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
  const ctx = await requireInventoryWrite();
  if ("error" in ctx) return ctx;
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
  const assetRows: AssetSheetRow[] = [];
  for (const { rowNum, cells } of a.rows) {
    const p = parseAssetSheetRow(cells, rowNum);
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

  // ── 기존 행과 대조 ──────────────────────────────────────────────────────────────
  const admin = createAdminClient();
  type ExistingAsset = { id: string; asset_code: string; status: string; holder_name: string | null; sort_order: number };
  type ExistingSupply = { id: string; item_code: string | null; sort_order: number };
  let existingAssets: ExistingAsset[];
  let existingSupplies: ExistingSupply[];
  let openLoanAssetIds: Set<string>;
  try {
    [existingAssets, existingSupplies, openLoanAssetIds] = await Promise.all([
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
      summary: `${assetCategoryLabel(row.category)} · ${row.model ?? "모델 미기재"} · ${row.statusGiven ? assetStatusLabel(row.status) : cur ? `상태 유지(${assetStatusLabel(cur.status)})` : assetStatusLabel(row.status)}${row.location ? ` · ${row.location}` : ""}`,
    });
  }
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
  if (errors.length > 0 || dryRun) return { mode, dryRun, ...counts, preview, errors, notes, applied: false };

  // ── 반영 ───────────────────────────────────────────────────────────────────────
  const assetSortBase = existingAssets.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
  if (assetPlan.insert.length > 0) {
    const { error } = await admin.from("inventory_assets").insert(
      assetPlan.insert.map((r, i) => ({
        tenant_id: ctx.tenantId, asset_code: r.assetCode, category: r.category, maker: r.maker, model: r.model,
        serial_no: r.serialNo, acquired_on: r.acquiredOn, status: r.status, location: r.location,
        holder_name: r.holderName, last_audited_on: r.lastAuditedOn, disposed_on: r.disposedOn, note: r.note,
        sort_order: assetSortBase + i,
      })),
    );
    if (error) return { error: friendlyInventoryError(error, "자산을 추가하지 못했습니다(아무것도 반영되지 않았습니다)", "이미 같은 자산ID가 있습니다") };
  }
  for (const { row, cur } of assetPlan.update) {
    const locked = openLoanAssetIds.has(cur.id);
    const { error } = await admin
      .from("inventory_assets")
      .update({
        category: row.category, maker: row.maker, model: row.model, serial_no: row.serialNo, acquired_on: row.acquiredOn,
        location: row.location, last_audited_on: row.lastAuditedOn, note: row.note,
        // 열린 대여가 있으면 상태·사용자·폐기일을 안 건드리고, 상태 칸이 비어 있으면 상태·폐기일도 그대로 둔다.
        ...(locked ? {} : row.statusGiven ? { status: row.status, holder_name: row.holderName, disposed_on: row.disposedOn } : { holder_name: row.holderName }),
      })
      .eq("id", cur.id)
      .eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyInventoryError(error, `${row.assetCode}을(를) 갱신하지 못했습니다 — 그 앞까지는 반영됐습니다`) };
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
    },
  });
  revalidatePath("/inventory");
  return { mode, dryRun: false, ...counts, preview, errors: [], notes, applied: true };
}
