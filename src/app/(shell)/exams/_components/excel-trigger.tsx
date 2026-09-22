"use client";

import { useState } from "react";
import { ToolbarButton } from "@/components/toolbar";
import { GradesExcelDialog } from "./grades-excel-dialog";

/**
 * 툴바의 '엑셀' — 지금 보고 있는 축 그대로 시트를 내려받고, 채워서 올린다.
 *
 * ⚠️ 다이얼로그는 **열렸을 때만 마운트**한다([[#67]]: 항상 마운트된 다이얼로그는 성공 부수효과가
 *    재오픈을 즉시 닫아 "클릭 무반응"이 된다).
 */
export function GradesExcelTrigger({ excelHref, canWrite }: { excelHref: string; canWrite: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToolbarButton className="ml-auto" onClick={() => setOpen(true)}>
        엑셀
      </ToolbarButton>
      {open ? (
        <GradesExcelDialog excelHref={excelHref} canWrite={canWrite} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}
