/**
 * 업체리스트 엑셀 규약 — 순수(서버 액션·내려받기 라우트·Vitest가 함께 읽는다). 원장 2026-10-26:
 * *"업체 등록하는걸 엑셀 시트로 넣고 뺄수있게 일괄 등록가능하게"*.
 *
 * 🔑 **내려받는 서식 = 올리는 서식**(같은 열·같은 라벨) — 재고 엑셀(`excel-sheet.ts`)과 같은 규약이다.
 * 🔑 **매칭 키 = 업체명**(공백·대소문자 무시). 업체엔 자산ID 같은 코드가 없어서다. 추가 = 이미 있는 이름은 건너뜀 ·
 *    덮어쓰기 = 있는 이름의 칸을 파일 값으로 바꿈(빈 칸은 지움 — 내려받은 파일엔 지금 값이 다 들어 있다).
 * 🔴 DB에 같은 이름이 **두 곳** 있으면 그 행은 오류다(어느 쪽을 고칠지 모른다 — 이름을 고쳐 구분해 달라고 한다).
 * 🔑 번호·사업자번호 다듬기와 길이 상한은 화면 등록과 **같은 함수**(`tidyVendor`)를 탄다.
 */
import { tidyVendor, VENDOR_FIELDS, type VendorValues } from "./vendor";

export const VENDOR_SHEET_NAME = "업체리스트";
export const VENDOR_GUIDE_SHEET_NAME = "안내";

export type VendorSheetKey = keyof VendorValues;
const WIDTH: Record<VendorSheetKey, number> = {
  name: 22, category: 12, phone: 16, contactName: 10, contactPhone: 16, email: 24, address: 36, bizNo: 15, note: 36,
};
export const VENDOR_SHEET_COLUMNS: ReadonlyArray<{ key: VendorSheetKey; header: string; width: number }> = VENDOR_FIELDS.map((f) => ({
  key: f.key,
  header: f.label,
  width: WIDTH[f.key],
}));

/** 매칭 키 — 업체명의 공백·대소문자를 무시한다(`대구 서점`과 `대구서점`은 같은 곳). */
export function vendorNameKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "");
}

export type VendorSheetRow = VendorValues & { rowNum: number };

export function parseVendorSheetRow(
  cells: Partial<Record<VendorSheetKey, string>>,
  rowNum: number,
): { ok: true; row: VendorSheetRow } | { ok: false; error: string } {
  const raw = Object.fromEntries(VENDOR_FIELDS.map((f) => [f.key, cells[f.key] ?? null])) as Record<VendorSheetKey, string | null>;
  const v = tidyVendor(raw);
  if ("error" in v) return { ok: false, error: `${rowNum}행: ${v.error}` };
  return { ok: true, row: { ...v, rowNum } };
}

export type VendorPlanAction = "insert" | "update" | "skip" | "ambiguous";

/**
 * 행마다 할 일 — 기존 업체(이름 키)와 대조. 파일 안의 같은 이름 두 번은 오류(어느 행이 맞는지 모른다).
 * `ambiguous` = DB에 같은 이름이 여럿 → 오류로 세운다(추가 방식이어도 — 건너뛰면 "들어갔다"로 오해한다).
 */
export function planVendorRows(
  rows: ReadonlyArray<VendorSheetRow>,
  existing: ReadonlyArray<{ id: string; name: string }>,
  mode: "append" | "overwrite",
): { actions: { row: VendorSheetRow; action: VendorPlanAction; id: string | null }[]; errors: string[] } {
  const idsByKey = new Map<string, string[]>();
  for (const e of existing) {
    const k = vendorNameKey(e.name);
    idsByKey.set(k, [...(idsByKey.get(k) ?? []), e.id]);
  }
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const actions = rows.map((row) => {
    const k = vendorNameKey(row.name);
    const first = seen.get(k);
    if (first !== undefined) errors.push(`${row.rowNum}행: 업체명 "${row.name}"이(가) ${first}행과 겹칩니다`);
    else seen.set(k, row.rowNum);
    const ids = idsByKey.get(k) ?? [];
    if (ids.length > 1) {
      errors.push(`${row.rowNum}행: "${row.name}" 이름의 업체가 이미 ${ids.length}곳 있어 어느 곳인지 알 수 없습니다 — 화면에서 이름을 구분해 주세요`);
      return { row, action: "ambiguous" as const, id: null };
    }
    if (ids.length === 0) return { row, action: "insert" as const, id: null };
    return { row, action: mode === "overwrite" ? ("update" as const) : ("skip" as const), id: ids[0]! };
  });
  return { actions, errors };
}
