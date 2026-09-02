import "server-only";
import ExcelJS from "exceljs";
import { ASSET_CATEGORY_LABEL, assetCategoryLabel } from "../category";
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

/**
 * 재고관리 엑셀 서식 — **현재 자산·소모품이 그대로 들어간 파일**. 비어 있는 서식이 아니라 실제 행을 담아 주는 이유:
 * 같은 파일을 고쳐 다시 올리면(덮어쓰기) 그대로 반영되고, 새 행을 아래에 적어 올리면(추가) 그것만 들어간다.
 * 분류·상태 칸엔 드롭다운(데이터 유효성)을 걸어 라벨을 틀리게 적을 일을 줄인다.
 * 🔴 빈 값은 빈 칸으로 낸다(`—`·`미기재`를 적지 않는다) — 다시 올릴 때 null로 돌아가야 한다(적어도 규약이 null로 접는다).
 */
export async function buildInventoryWorkbook(assets: InventoryAsset[], supplies: InventorySupply[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "eywa";
  wb.created = new Date();

  const ws = wb.addWorksheet(ASSET_SHEET_NAME);
  ws.columns = ASSET_SHEET_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const a of assets) {
    ws.addRow({
      assetCode: a.assetCode,
      category: assetCategoryLabel(a.category),
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
  const listOf = (labels: string[]): ExcelJS.DataValidation => ({ type: "list", allowBlank: true, formulae: [`"${labels.join(",")}"`] });
  const categoryList = listOf(Object.values(ASSET_CATEGORY_LABEL));
  const statusList = listOf(Object.values(ASSET_STATUS_LABEL));
  for (let r = 2; r <= VALIDATION_ROWS; r++) {
    ws.getCell(`${colLetter("category")}${r}`).dataValidation = categoryList;
    ws.getCell(`${colLetter("status")}${r}`).dataValidation = statusList;
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
    "· 분류: " + Object.values(ASSET_CATEGORY_LABEL).join(" · ") + "  /  상태: " + Object.values(ASSET_STATUS_LABEL).join(" · "),
    "· 날짜는 YYYY-MM-DD(2026-09-02). 빈 칸은 '모름/해당 없음'으로 저장됩니다 — '미기재'·'—'를 적을 필요가 없습니다.",
    "· 폐기 상태는 폐기일이 함께 있어야 하고, 폐기일이 있으면 상태도 폐기여야 합니다.",
    "· 대여 중인 자산(대여이력에 '대여중'이 열려 있음)은 덮어쓰기여도 상태·사용자 칸을 파일 값으로 바꾸지 않습니다 — 반납은 대여 면에서.",
    "· 대여이력·실사이력은 이 파일로 넣지 않습니다(화면의 '대여 시작'·'실사 기록'으로 — 자산 상태가 함께 움직여야 합니다).",
    "· 파일 안에 같은 자산ID/품목ID가 두 번 있으면 반영하지 않습니다(어느 행이 맞는지 알 수 없어서). 오류가 하나라도 있으면 아무 것도 바꾸지 않습니다.",
  ];
  for (const t of lines) guide.addRow({ t });
  return wb;
}
