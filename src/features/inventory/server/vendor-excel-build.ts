import "server-only";
import ExcelJS from "exceljs";
import type { InventoryVendor } from "../types";
import { VENDOR_GUIDE_SHEET_NAME, VENDOR_SHEET_COLUMNS, VENDOR_SHEET_NAME } from "../vendor-sheet";

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE9E9EE" } };
/** 번호 칸은 글자 서식으로 — 숫자로 적으면 엑셀이 맨 앞 0을 지운다(가져오기가 되붙이긴 하지만 처음부터 막는다). */
const TEXT_KEYS = new Set(["phone", "contactPhone", "bizNo"]);

/**
 * 업체리스트 엑셀 서식 — **지금 업체가 그대로 들어간 파일**(재고 엑셀과 같은 이유: 고쳐 올리면 덮어쓰기, 아래에 적어 올리면 추가).
 * 🔴 빈 값은 빈 칸으로 낸다(`—`를 적지 않는다) — 다시 올릴 때 null로 돌아가야 한다.
 */
export async function buildVendorWorkbook(vendors: ReadonlyArray<InventoryVendor>): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "에이와";
  wb.created = new Date();

  const ws = wb.addWorksheet(VENDOR_SHEET_NAME);
  ws.columns = VENDOR_SHEET_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
    style: TEXT_KEYS.has(c.key) ? { numFmt: "@" } : {},
  }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = HEADER_FILL;
  ws.views = [{ state: "frozen", ySplit: 1 }];
  for (const v of vendors) {
    ws.addRow(Object.fromEntries(VENDOR_SHEET_COLUMNS.map((c) => [c.key, v[c.key] ?? ""])));
  }

  const guide = wb.addWorksheet(VENDOR_GUIDE_SHEET_NAME);
  guide.columns = [{ header: "업체리스트 엑셀 서식 안내", key: "t", width: 110 }];
  guide.getRow(1).font = { bold: true };
  const lines = [
    "· 시트 '업체리스트'를 고치거나 아래에 새 행을 적은 뒤 업체리스트 화면의 [엑셀 내보내기/가져오기] → [엑셀 가져오기]로 올립니다.",
    "· 매칭 키 = 업체명(띄어쓰기·대소문자 무시). '추가'는 이미 있는 업체명을 건너뛰고, '덮어쓰기'는 있는 업체의 칸을 파일 값으로 바꿉니다.",
    "· 덮어쓰기에서 빈 칸은 그 칸을 지웁니다 — 이 파일엔 지금 값이 모두 들어 있으니 지울 칸만 비우세요. 열을 통째로 지우면 그 칸은 바꾸지 않습니다.",
    "· 업체명은 꼭 적어야 합니다. 나머지 칸은 비워도 됩니다. 분류는 자유롭게 적습니다(예: 서점 · 출판사 · 정수기 · 인테리어).",
    "· 전화번호·사업자등록번호는 숫자만 적어도 저장할 때 하이픈이 들어갑니다.",
    "· 업체명을 바꾸려면 화면에서 수정하세요 — 파일에서 이름을 바꾸면 새 업체로 추가됩니다.",
    "· 파일 안에 같은 업체명이 두 번 있으면 반영하지 않습니다. 오류가 하나라도 있으면 아무 것도 바꾸지 않습니다.",
  ];
  for (const t of lines) guide.addRow({ t });
  return wb;
}
