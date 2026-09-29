"use client";

import { useState } from "react";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { GradesExcelDialog } from "./grades-excel-dialog";

/**
 * 툴바의 '엑셀 내보내기/가져오기'(원장 2026-09-29 탭 통일 — 이름·모양은 공용 `ExcelMenu` 한 곳) — 내보내기 = 지금 보고 있는
 * 축 그대로의 성적 시트, 가져오기 = 채운 시트를 올리는 성적 전용 창. 성적 화면엔 검색이 없어 툴바 오른쪽 끝.
 * 🔴 가져오기는 쓰기 권한(`canWrite`)이 있을 때만 — 없으면 내보내기 버튼만 선다.
 *
 * ⚠️ 다이얼로그는 **열렸을 때만 마운트**한다([[#67]]: 항상 마운트된 다이얼로그는 성공 부수효과가
 *    재오픈을 즉시 닫아 "클릭 무반응"이 된다).
 */
export function GradesExcelTrigger({ excelHref, canWrite }: { excelHref: string; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="ml-auto">
      <ExcelMenu exportHref={excelHref} onImport={canWrite ? () => setOpen(true) : null} />
      {open ? (
        <GradesExcelDialog excelHref={excelHref} canWrite={canWrite} onClose={() => setOpen(false)} />
      ) : null}
    </span>
  );
}
