import "server-only";
import ExcelJS from "exceljs";
import { buildCategoryMaps, type InventoryCategory } from "../category";
import {
  ASSET_SHEET_COLUMNS,
  ASSET_SHEET_NAME,
  GUIDE_SHEET_NAME,
  SUPPLY_SHEET_COLUMNS,
  SUPPLY_SHEET_NAME,
} from "../excel-sheet";
import { ASSET_STATUS_LABEL, assetStatusLabel } from "../status";
import type { InventoryAsset, InventorySupply } from "../types";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
const VALIDATION_ROWS = 2000;
/** 엑셀 인라인 목록(`"a,b,c"`)의 실질 한도 — 넘치면 드롭다운을 아예 안 건다(안내 시트가 목록을 적는다). */
const INLINE_LIST_MAX = 250;

/**
 * 재고관리 엑셀 서식 — **현재 자산·소모품이 그대로 들어간 파일**. 비어 있는 서식이 아니라 실제 행을 담아 주는 이유:
 * 같은 파일을 고쳐 다시 올리면(덮어쓰기) 그대로 반영되고, 새 행을 아래에 적어 올리면(추가) 그것만 들어간다.
 * 분류·상태 칸엔 드롭다운(데이터 유효성)을 걸어 라벨을 틀리게 적을 일을 줄인다.
 * 🔴 빈 값은 빈 칸으로 낸다(`—`·`미기재`를 적지 않는다) — 다시 올릴 때 null로 돌아가야 한다(적어도 규약이 null로 접는다).
 * 🔴 **분류 드롭다운은 거절하지 않는다**(`showErrorMessage:false`) — 목록에 없는 분류를 적으면 새 분류가 되는 게
 *    이 화면의 기능인데(원장 2026-09-03), 엑셀이 입력을 막으면 그 길이 통째로 닫힌다. 상태는 코드 고정 enum이라 그대로 잠근다.
 */
export async function buildInventoryWorkbook(
  assets: InventoryAsset[],
  supplies: InventorySupply[],
  categories: ReadonlyArray<InventoryCategory>,
): Promise<ExcelJS.Workbook> {
  const cats = buildCategoryMaps(categories);
  const wb = new ExcelJS.Workbook();
  wb.creator = "aywa";
  wb.created = new Date();

  const ws = wb.addWorksheet(ASSET_SHEET_NAME);
  ws.columns = ASSET_SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const a of assets) {
    ws.addRow({
      assetCode: a.assetCode,
      category: cats.labelOf(a.category),
      maker: a.maker ?? "",
      model: a.model ?? "",
      serialNo: a.serialNo ?? "",
      acquiredOn: a.acquiredOn ?? "",
      status: assetStatusLabel(a.status),
      location: a.location ?? "",
      holderName: a.holderName ?? "",
      lastAuditedOn: a.lastAuditedOn ?? "",
      disposedOn: a.disposedOn ?? "",
      note: a.note ?? "",
    });
  }
  const colLetter = (key: string) => {
    const idx = ASSET_SHEET_COLUMNS.findIndex((c) => c.key === key);
    return String.fromCharCode(65 + idx);
  };
  // 분류·상태 드롭다운 — 이 exceljs 타입엔 시트 단위 dataValidations가 없어 칸마다 건다(2~2000행).
  // 🔑 쉼표·따옴표가 든 라벨은 인라인 목록(`"a,b,c"`)을 쪼개므로 뺀다(그 분류는 드롭다운에 안 뜰 뿐
  //    직접 적으면 그대로 통한다 — 서식이 깨지는 것보다 낫다).
  const listOf = (labels: string[], strict: boolean): ExcelJS.DataValidation | null => {
    const safe = labels.filter((l) => !/[",]/.test(l));
    const joined = safe.join(",");
    if (safe.length === 0 || joined.length > INLINE_LIST_MAX) return null;
    return { type: "list", allowBlank: true, showErrorMessage: strict, formulae: [`"${joined}"`] };
  };
  const categoryList = listOf(cats.labels, false);
  const statusList = listOf(Object.values(ASSET_STATUS_LABEL), true);
  for (let r = 2; r <= VALIDATION_ROWS; r++) {
    if (categoryList) ws.getCell(`${colLetter("category")}${r}`).dataValidation = categoryList;
    if (statusList) ws.getCell(`${colLetter("status")}${r}`).dataValidation = statusList;
  }

  const sp = wb.addWorksheet(SUPPLY_SHEET_NAME);
  sp.columns = SUPPLY_SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  sp.getRow(1).font = { bold: true };
  sp.getRow(1).fill = HEADER_FILL;
  sp.views = [{ state: "frozen", ySplit: 1 }];
  for (const s of supplies) {
    sp.addRow({
      itemCode: s.itemCode ?? "",
      name: s.name,
      makerModel: s.makerModel ?? "",
      qty: s.qty,
      location: s.location ?? "",
      checkedOn: s.checkedOn ?? "",
      checkerName: s.checkerName ?? "",
      note: s.note ?? "",
    });
  }

  const guide = wb.addWorksheet(GUIDE_SHEET_NAME);
  guide.columns = [{ header: "재고관리 엑셀 서식 안내", key: "t", width: 110 }];
  guide.getRow(1).font = { bold: true };
  const lines = [
    "· 시트 '자산'과 '소모품'을 고치거나 아래에 새 행을 적은 뒤 재고관리 화면의 [엑셀] → 파일 선택 → [반영]으로 올립니다.",
    "· 매칭 키 = 자산ID / 품목ID. '추가' 방식은 이미 있는 키를 건너뛰고, '덮어쓰기' 방식은 있는 키의 칸을 파일 값으로 바꿉니다.",
    "· 분류: " + cats.labels.join(" · ") + "  /  상태: " + Object.values(ASSET_STATUS_LABEL).join(" · "),
    "· 목록에 없는 분류를 적으면 새 분류로 추가됩니다 — [반영]을 누를 때 무엇이 생기는지 확인 창이 한 번 뜹니다(오타 방지).",
    "· 새 분류의 자산ID를 'HS-001'처럼 적으면 그 머리글자(HS)를 그 분류의 번호 체계로 씁니다. 안 적으면 자동으로 매깁니다.",
    "· 상태는 위 목록 밖 값을 적을 수 없습니다(분류와 달리 고정입니다).",
    "· 날짜는 YYYY-MM-DD(2026-09-02). 빈 칸은 '모름/해당 없음'으로 저장됩니다 — '미기재'·'—'를 적을 필요가 없습니다.",
    "· 폐기 상태는 폐기일이 함께 있어야 하고, 폐기일이 있으면 상태도 폐기여야 합니다.",
    "· 대여 중인 자산(대여이력에 '대여중'이 열려 있음)은 덮어쓰기여도 상태·사용자 칸을 파일 값으로 바꾸지 않습니다 — 반납은 대여 면에서.",
    "· 대여이력·실사이력은 이 파일로 넣지 않습니다(화면의 '대여 시작'·'실사 기록'으로 — 자산 상태가 함께 움직여야 합니다).",
    "· 파일 안에 같은 자산ID/품목ID가 두 번 있으면 반영하지 않습니다(어느 행이 맞는지 알 수 없어서). 오류가 하나라도 있으면 아무 것도 바꾸지 않습니다.",
  ];
  for (const t of lines) guide.addRow({ t });
  return wb;
}
