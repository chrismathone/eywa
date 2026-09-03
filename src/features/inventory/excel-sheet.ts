/**
 * 엑셀 서식 규약 — 순수(서버 액션·라우트·Vitest가 함께 읽는다). 원장 2026-09-02:
 * *"엑셀 첨부 가능하도록 엑셀 기본 서식 작성해서 다운로드받게 해줘. 해당 엑셀에 작성 후 업로드시에 그대로 반영되게 —
 * 덮어쓰기 또는 추가 방식으로"*.
 *
 * 🔑 **내려받는 서식 = 올리는 서식**(같은 열·같은 라벨). 시트 두 장(자산·소모품) + 안내 한 장. 대여·실사는 이력이라
 *    엑셀로 넣지 않는다(화면 동작으로 기록 — 자산 상태·최종실사일이 함께 움직여야 해서).
 * 🔑 분류·상태는 **한글 라벨**로 적는다(키도 받아 준다). 빈 칸은 null(미기재 규약 — `미기재`·`—`를 적어도 null).
 * 🔑 매칭 키 = 자산ID / 품목ID. **추가**(append) = 이미 있는 키는 건너뜀 · **덮어쓰기**(overwrite) = 있는 키는 갱신.
 * 🔑 **모르는 분류는 오류가 아니다**(원장 2026-09-03) — 새 분류로 만들 후보로 접어 두고(`categoryKey: null`)
 *    서버 액션이 `planNewCategories`로 계획을 세운 뒤 사람 확인을 받는다. 상태는 코드 고정 enum이라 그대로 오류다.
 */
import { isValidAssetCode, normalizeAssetCode } from "./asset-code";
import type { CategoryMaps } from "./category";
import { ASSET_STATUS_LABEL, isAssetStatus, type AssetStatus } from "./status";
import { nullIfUnknown } from "./unknown-value";

export const ASSET_SHEET_NAME = "자산";
export const SUPPLY_SHEET_NAME = "소모품";
export const GUIDE_SHEET_NAME = "안내";

export type ExcelMode = "append" | "overwrite";
export const EXCEL_MODE_LABEL: Record<ExcelMode, string> = { append: "추가", overwrite: "덮어쓰기" };
export function isExcelMode(v: unknown): v is ExcelMode {
  return v === "append" || v === "overwrite";
}

export type AssetSheetKey =
  | "assetCode" | "category" | "maker" | "model" | "serialNo" | "acquiredOn" | "status"
  | "location" | "holderName" | "lastAuditedOn" | "disposedOn" | "note";
export const ASSET_SHEET_COLUMNS: ReadonlyArray<{ key: AssetSheetKey; header: string; width: number }> = [
  { key: "assetCode", header: "자산ID", width: 12 },
  { key: "category", header: "분류", width: 10 },
  { key: "maker", header: "제조사", width: 14 },
  { key: "model", header: "모델명", width: 24 },
  { key: "serialNo", header: "시리얼번호", width: 18 },
  { key: "acquiredOn", header: "입고일", width: 12 },
  { key: "status", header: "상태", width: 10 },
  { key: "location", header: "현위치", width: 16 },
  { key: "holderName", header: "사용자", width: 12 },
  { key: "lastAuditedOn", header: "최종실사", width: 12 },
  { key: "disposedOn", header: "폐기일", width: 12 },
  { key: "note", header: "비고", width: 32 },
];

export type SupplySheetKey = "itemCode" | "name" | "makerModel" | "qty" | "location" | "checkedOn" | "checkerName" | "note";
export const SUPPLY_SHEET_COLUMNS: ReadonlyArray<{ key: SupplySheetKey; header: string; width: number }> = [
  { key: "itemCode", header: "품목ID", width: 10 },
  { key: "name", header: "품목", width: 12 },
  { key: "makerModel", header: "제조사/모델", width: 22 },
  { key: "qty", header: "수량", width: 8 },
  { key: "location", header: "분배위치", width: 16 },
  { key: "checkedOn", header: "최종확인", width: 12 },
  { key: "checkerName", header: "확인자", width: 12 },
  { key: "note", header: "비고", width: 32 },
];

/** 1행(헤더) 텍스트 → 키별 열 번호(0-based). 라벨 또는 키 이름 둘 다 받는다. */
export function mapHeaders<K extends string>(
  headers: ReadonlyArray<string>,
  columns: ReadonlyArray<{ key: K; header: string }>,
): Map<K, number> {
  const out = new Map<K, number>();
  headers.forEach((raw, idx) => {
    const h = String(raw ?? "").trim().replace(/\s+/g, "");
    if (!h) return;
    const col = columns.find((c) => c.header.replace(/\s+/g, "") === h || c.key === h);
    if (col && !out.has(col.key)) out.set(col.key, idx);
  });
  return out;
}

/** 날짜 문자열 정규화 — 빈 값 null · `YYYY-MM-DD`/`YYYY.MM.DD`/`YYYY/MM/DD`/`YYYYMMDD` → ISO · 그 외 undefined(오류). */
export function normalizeDate(raw: string | null | undefined): string | null | undefined {
  const s = nullIfUnknown(raw);
  if (s === null) return null;
  const m = /^(\d{4})[-./]?(\d{1,2})[-./]?(\d{1,2})$/.exec(s.replace(/\s+/g, ""));
  if (!m) return undefined;
  const iso = `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  return Number.isNaN(Date.parse(iso)) ? undefined : iso;
}

const STATUS_BY_LABEL = new Map(Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => [v, k as AssetStatus]));

/**
 * 분류 칸 → 등록된 분류 키. 빈 값 null · 라벨/키(공백 무시) → 키 · **모르는 값 undefined**(= 새 분류 후보).
 * 목록은 학원별 분류(0247a)라 맵을 받는다 — 라벨 표를 여기 다시 적지 말 것.
 */
export function categoryKeyOf(raw: string | null | undefined, maps: CategoryMaps): string | null | undefined {
  const s = nullIfUnknown(raw);
  if (s === null) return null;
  return maps.keyOfInput(s);
}

export function statusKeyOf(raw: string | null | undefined): AssetStatus | null | undefined {
  const s = nullIfUnknown(raw);
  if (s === null) return null;
  if (isAssetStatus(s)) return s;
  return STATUS_BY_LABEL.get(s.replace(/\s+/g, "")) ?? STATUS_BY_LABEL.get(s);
}

export type AssetSheetRow = {
  rowNum: number;
  assetCode: string;
  /** 이미 등록된 분류면 그 키, **새 분류 후보면 null**(그때 키는 `planNewCategories`가 도출한다). */
  categoryKey: string | null;
  /** 사람이 읽는 분류 이름 — 등록된 분류면 그 라벨, 새 후보면 파일에 적힌 글자 그대로(trim). */
  categoryLabel: string;
  maker: string | null;
  model: string | null;
  serialNo: string | null;
  acquiredOn: string | null;
  status: AssetStatus;
  /** 상태 칸을 실제로 적었는가 — 비워 두면 새 행은 사용중, **있는 행은 그대로 둔다**(덮어쓰기가 조용히 사용중으로 바꾸지 않게). */
  statusGiven: boolean;
  location: string | null;
  holderName: string | null;
  lastAuditedOn: string | null;
  disposedOn: string | null;
  note: string | null;
};

type Parsed<T> = { ok: true; row: T } | { ok: false; error: string };

export function isBlankCells(cells: Record<string, string | undefined>): boolean {
  return Object.values(cells).every((v) => !String(v ?? "").trim());
}

/**
 * 자산 시트 한 행 → 저장 가능한 값(라벨→키, 빈 칸→null, 날짜 정규화, 폐기일↔상태 짝 검사).
 * 🔑 **모르는 분류는 오류가 아니다** — `categoryKey: null`로 접어 두고 라벨만 들고 나간다(새 분류 후보).
 *    빈 분류는 여전히 오류다(무엇으로 만들지 알 수 없다).
 */
export function parseAssetSheetRow(
  cells: Partial<Record<AssetSheetKey, string>>,
  rowNum: number,
  maps: CategoryMaps,
): Parsed<AssetSheetRow> {
  const at = (msg: string) => ({ ok: false as const, error: `${rowNum}행: ${msg}` });
  const assetCode = normalizeAssetCode(cells.assetCode ?? "");
  if (!assetCode) return at("자산ID가 비어 있습니다");
  if (!isValidAssetCode(assetCode)) return at(`자산ID "${assetCode}"는 영문 대문자·숫자·하이픈 2~32자여야 합니다`);
  const categoryKey = categoryKeyOf(cells.category, maps);
  if (categoryKey === null) return at("분류가 비어 있습니다");
  const categoryRaw = String(cells.category ?? "").trim();
  if (categoryKey === undefined && categoryRaw.length > 40) return at(`분류 "${categoryRaw.slice(0, 20)}…"는 40자까지입니다`);
  const categoryLabel = categoryKey ? maps.labelOf(categoryKey) : categoryRaw;
  const statusRaw = statusKeyOf(cells.status);
  if (statusRaw === undefined) return at(`상태 "${cells.status}"를 모릅니다 (${Object.values(ASSET_STATUS_LABEL).join("·")})`);
  const status: AssetStatus = statusRaw ?? "in_use";
  const dates = { acquiredOn: normalizeDate(cells.acquiredOn), lastAuditedOn: normalizeDate(cells.lastAuditedOn), disposedOn: normalizeDate(cells.disposedOn) };
  if (dates.acquiredOn === undefined) return at(`입고일 "${cells.acquiredOn}"이 날짜가 아닙니다 (YYYY-MM-DD)`);
  if (dates.lastAuditedOn === undefined) return at(`최종실사 "${cells.lastAuditedOn}"이 날짜가 아닙니다 (YYYY-MM-DD)`);
  if (dates.disposedOn === undefined) return at(`폐기일 "${cells.disposedOn}"이 날짜가 아닙니다 (YYYY-MM-DD)`);
  if (dates.disposedOn && status !== "disposed") return at("폐기일이 있는데 상태가 폐기가 아닙니다");
  if (status === "disposed" && !dates.disposedOn) return at("상태가 폐기인데 폐기일이 없습니다");
  const text = (k: AssetSheetKey, max: number, label: string): string | null | { error: string } => {
    const v = nullIfUnknown(cells[k]);
    return v && v.length > max ? { error: `${label}은(는) ${max}자까지입니다` } : v;
  };
  const fields = {
    maker: text("maker", 80, "제조사"), model: text("model", 120, "모델명"), serialNo: text("serialNo", 120, "시리얼번호"),
    location: text("location", 120, "현위치"), holderName: text("holderName", 80, "사용자"), note: text("note", 500, "비고"),
  };
  for (const v of Object.values(fields)) if (v && typeof v === "object") return at(v.error);
  return {
    ok: true,
    row: {
      rowNum, assetCode, categoryKey: categoryKey ?? null, categoryLabel, status, statusGiven: statusRaw !== null,
      maker: fields.maker as string | null, model: fields.model as string | null, serialNo: fields.serialNo as string | null,
      location: fields.location as string | null, holderName: fields.holderName as string | null, note: fields.note as string | null,
      acquiredOn: dates.acquiredOn, lastAuditedOn: dates.lastAuditedOn, disposedOn: dates.disposedOn,
    },
  };
}

export type SupplySheetRow = {
  rowNum: number;
  itemCode: string;
  name: string;
  makerModel: string | null;
  qty: number;
  location: string | null;
  checkedOn: string | null;
  checkerName: string | null;
  note: string | null;
};

export function parseSupplySheetRow(cells: Partial<Record<SupplySheetKey, string>>, rowNum: number): Parsed<SupplySheetRow> {
  const at = (msg: string) => ({ ok: false as const, error: `${rowNum}행(소모품): ${msg}` });
  const itemCode = String(cells.itemCode ?? "").trim().toUpperCase();
  if (!itemCode) return at("품목ID가 비어 있습니다(매칭 키라 필수)");
  if (itemCode.length > 32) return at("품목ID는 32자까지입니다");
  const name = nullIfUnknown(cells.name);
  if (!name) return at("품목이 비어 있습니다");
  if (name.length > 80) return at("품목은 80자까지입니다");
  const qtyRaw = String(cells.qty ?? "").trim();
  if (!/^\d{1,9}$/.test(qtyRaw)) return at(`수량 "${qtyRaw}"은(는) 0 이상의 정수여야 합니다`);
  const checkedOn = normalizeDate(cells.checkedOn);
  if (checkedOn === undefined) return at(`최종확인 "${cells.checkedOn}"이 날짜가 아닙니다 (YYYY-MM-DD)`);
  const makerModel = nullIfUnknown(cells.makerModel);
  const location = nullIfUnknown(cells.location);
  const checkerName = nullIfUnknown(cells.checkerName);
  const note = nullIfUnknown(cells.note);
  if ((makerModel?.length ?? 0) > 120) return at("제조사/모델은 120자까지입니다");
  if ((location?.length ?? 0) > 120) return at("분배위치는 120자까지입니다");
  if ((checkerName?.length ?? 0) > 80) return at("확인자는 80자까지입니다");
  if ((note?.length ?? 0) > 500) return at("비고는 500자까지입니다");
  return { ok: true, row: { rowNum, itemCode, name, makerModel, qty: Number(qtyRaw), location, checkedOn, checkerName, note } };
}

/** 파일 안에서 같은 키가 두 번 나오면 어느 행을 믿을지 알 수 없다 — 오류로 세운다. */
export function duplicateKeyErrors<T extends { rowNum: number }>(rows: ReadonlyArray<T>, keyOf: (r: T) => string, label: string): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    const first = seen.get(k);
    if (first !== undefined) out.push(`${r.rowNum}행: ${label} "${k}"가 ${first}행과 겹칩니다`);
    else seen.set(k, r.rowNum);
  }
  return out;
}
