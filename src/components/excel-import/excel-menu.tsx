"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ImportKind } from "@/features/excel-import/kinds";
import { ExcelImportDialog } from "./excel-import-dialog";

/**
 * 엑셀 버튼 **한 벌** — 모든 탭이 이 부품만 쓴다(원장 2026-09-29 *"탭마다 엑셀 내보내기/가져오기 버튼 이름과 위치가 다 제각각임.
 * 엑셀 내보내기/가져오기 로 통일하고 위치도 검색과 같은 라인으로"*). 자리는 **검색(SearchToggle)과 같은 줄**.
 *
 * - 내보내기 + 가져오기 → '엑셀 내보내기/가져오기' 한 버튼 → 두 항목 메뉴
 * - 내보내기만(가져오기 권한 없음 등) → '엑셀 내보내기' 바로 내려받기
 * - 가져오기만(내보낼 목록이 없는 기록형 탭) → '엑셀 가져오기' 바로 창
 * 🔴 가져오기는 **서버가 권한으로 정한 값**이 있을 때만(`importKind`/`onImport`) — 올리기 주소도 같은 게이트([[#77]]).
 * 가져오기 창이 공용 창이 아닌 탭(성적·재고·시간표)은 `onImport`로 제 창을 연다. 내보내기는 다운로드라 맨 `<a>`.
 */
export const EXCEL_MENU_LABEL = "엑셀 내보내기/가져오기";

export function ExcelMenu({
  exportHref,
  exportLabel = "엑셀 내보내기",
  importKind,
  onImport,
  importLabel = "엑셀 가져오기",
}: {
  /** 없으면 내보내기 항목이 없다. */
  exportHref?: string | null;
  /** 내보내기 글자 — 강사뷰 영어 화면이면 사전 값을 넘긴다(가져오기는 관리자 전용이라 한국어). */
  exportLabel?: string;
  /** 공용 가져오기 창(features/excel-import)의 종류. */
  importKind?: ImportKind | null;
  /** 공용 창 대신 탭 고유의 가져오기 창을 여는 경우(성적·재고·시간표). */
  onImport?: (() => void) | null;
  importLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const canImport = !!importKind || !!onImport;
  const startImport = () => (onImport ? onImport() : setOpen(true));
  const dialog = importKind && !onImport ? <ExcelImportDialog kind={importKind} open={open} onOpenChange={setOpen} /> : null;

  if (!canImport) {
    if (!exportHref) return null;
    return (
      <Button variant="ghost" className="text-primary" render={<a href={exportHref} />} data-excel-menu="export">
        {exportLabel}
      </Button>
    );
  }
  if (!exportHref) {
    return (
      <>
        <Button variant="ghost" className="text-primary" onClick={startImport} data-excel-menu="import">
          {importLabel}
        </Button>
        {dialog}
      </>
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="text-primary" data-excel-menu="both" />}>
          {EXCEL_MENU_LABEL}
          <EyIcon name="chevronDown" size={16} className="opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<a href={exportHref} />}>
            <EyIcon name="download" size={16} /> {exportLabel}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={startImport}>
            <EyIcon name="upload" size={16} /> {importLabel}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog}
    </>
  );
}
