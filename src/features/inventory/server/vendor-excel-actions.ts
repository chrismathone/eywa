"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged } from "@/lib/supabase/batch";
import { logAction } from "@/features/audit/server/log";
import { isExcelMode, mapHeaders, type ExcelMode } from "../excel-sheet";
import { vendorColumns } from "../vendor";
import {
  parseVendorSheetRow,
  planVendorRows,
  VENDOR_SHEET_COLUMNS,
  VENDOR_SHEET_NAME,
  type VendorSheetKey,
  type VendorSheetRow,
} from "../vendor-sheet";
import { friendlyInventoryError, isMissingInventoryTable } from "./access";
import { cellText } from "./excel-cell";
import { requireVendorWrite } from "./vendor-gate";

/**
 * 업체리스트 엑셀 가져오기 — 원장 2026-10-26 *"엑셀 시트로 넣고 뺄수있게 일괄 등록"*. 흐름은 재고 엑셀과 같다:
 * 파일 → 서식 확인('업체명' 열이 없으면 **서식 불일치** = 취소) → 행 파싱 → 기존 업체와 대조(키 = 업체명) → 행별 미리보기
 * → **오류가 하나라도 있으면 아무것도 안 쓴다** → `dryRun`이면 여기서 끝.
 * ⚠️ admin 클라이언트 = RLS 우회 → 모든 쿼리에 tenant_id 명시. 5MB까지.
 */
export type VendorExcelPreviewRow = { rowNum: number; key: string; action: "insert" | "update" | "skip"; summary: string };
export type VendorExcelResult =
  | {
      error?: string;
      formatMismatch?: boolean;
      mode?: ExcelMode;
      counts?: { total: number; insert: number; update: number; skip: number };
      preview?: VendorExcelPreviewRow[];
      errors?: string[];
      applied?: boolean;
    }
  | undefined;

const MAX_BYTES = 5 * 1024 * 1024;
const PHONE_KEYS: ReadonlySet<VendorSheetKey> = new Set(["phone", "contactPhone"]);

/**
 * 번호 칸이 **숫자 셀**이면 엑셀이 맨 앞 0을 지운 것이다(`010…` → `10…`) — 0을 되붙인다.
 * 🔑 8자리 `15xx/16xx/18xx` 대표번호는 원래 0이 없어 그대로 둔다. 글자 셀(서식 그대로 적은 값)은 손대지 않는다.
 */
function phoneCell(v: unknown): string {
  if (typeof v !== "number" || !Number.isInteger(v)) return cellText(v);
  const s = String(v);
  return /^1\d{7}$/.test(s) ? s : `0${s}`;
}

export async function importVendorExcel(fd: FormData): Promise<VendorExcelResult> {
  const ctx = await requireVendorWrite();
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
  const ws = wb.getWorksheet(VENDOR_SHEET_NAME) ?? wb.worksheets[0];
  if (!ws) return { error: "시트를 찾을 수 없습니다 — 내려받은 서식으로 작성해 주세요", formatMismatch: true };

  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
    headers[col - 1] = cellText(cell.value);
  });
  const map = mapHeaders(headers, VENDOR_SHEET_COLUMNS);
  if (!map.has("name")) {
    return { error: "서식이 일치하지 않습니다 — 첫 줄에 '업체명' 열이 없습니다. [엑셀 내보내기]로 받은 파일에 작성해 주세요.", formatMismatch: true };
  }

  const presentKeys = new Set(map.keys());
  const errors: string[] = [];
  const rows: VendorSheetRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: Partial<Record<VendorSheetKey, string>> = {};
    for (const [key, idx] of map) {
      const v = row.getCell(idx + 1).value;
      cells[key] = (PHONE_KEYS.has(key) ? phoneCell(v) : cellText(v)).trim();
    }
    if (Object.values(cells).every((v) => !v)) continue;
    const p = parseVendorSheetRow(cells, r);
    if (p.ok) rows.push(p.row);
    else errors.push(p.error);
  }
  if (rows.length === 0 && errors.length === 0) return { error: "데이터 행이 없습니다" };

  const admin = createAdminClient();
  let existing: { id: string; name: string }[];
  try {
    existing = await fetchAllPaged<{ id: string; name: string }>((from, to) =>
      admin.from("inventory_vendors").select("id, name").eq("tenant_id", ctx.tenantId).order("id").range(from, to),
    );
  } catch (e) {
    const err = { message: e instanceof Error ? e.message : String(e) };
    return { error: isMissingInventoryTable(err) ? "업체리스트 표가 아직 만들어지지 않았습니다 — 마이그레이션 0448a를 적용해 주세요" : friendlyInventoryError(err, "기존 업체를 불러오지 못했습니다") };
  }

  const plan = planVendorRows(rows, existing, mode);
  errors.push(...plan.errors);
  const preview: VendorExcelPreviewRow[] = plan.actions
    .filter((a) => a.action !== "ambiguous")
    .map(({ row, action }) => ({
      rowNum: row.rowNum,
      key: row.name,
      action: action as VendorExcelPreviewRow["action"],
      summary: [row.category, row.phone, row.contactName].filter(Boolean).join(" · ") || "—",
    }));
  const inserts = plan.actions.filter((a) => a.action === "insert");
  const updates = plan.actions.filter((a) => a.action === "update");
  const counts = { total: rows.length, insert: inserts.length, update: updates.length, skip: plan.actions.filter((a) => a.action === "skip").length };
  const base = { mode, counts, preview };
  if (errors.length > 0 || dryRun) return { ...base, errors, applied: false };

  if (inserts.length > 0) {
    const { error } = await admin
      .from("inventory_vendors")
      .insert(inserts.map(({ row }) => ({ ...vendorColumns(row), tenant_id: ctx.tenantId, created_by: ctx.userId })));
    if (error) return { error: friendlyInventoryError(error, "업체를 추가하지 못했습니다(아무것도 반영되지 않았습니다)") };
  }
  for (const { row, id } of updates) {
    // 🔴 파일에 **있는 열만** 바꾼다 — 비고 열을 지운 파일로 덮어쓰면 모든 업체의 비고가 지워지면 안 된다.
    const { error } = await admin.from("inventory_vendors").update(vendorColumns(row, presentKeys)).eq("id", id!).eq("tenant_id", ctx.tenantId);
    if (error) return { error: friendlyInventoryError(error, `${row.rowNum}행 "${row.name}"을(를) 갱신하지 못했습니다 — 추가분과 그 앞 행까지는 반영됐습니다`) };
  }

  await logAction({
    action: "inventory_vendor_excel_import",
    targetType: "inventory_vendor",
    targetLabel: file.name,
    metadata: { mode, inserted: counts.insert, updated: counts.update, skipped: counts.skip },
  });
  revalidatePath("/inventory");
  return { ...base, errors: [], applied: true };
}
