"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ImportKind } from "@/features/excel-import/kinds";
import { ExcelImportDialog } from "./excel-import-dialog";

/**
 * '엑셀 가져오기/내보내기' 한 버튼 — 원장 2026-09-29 *"엑셀 내보내기와 엑셀 가져오기를 하나로 묶을것. 왠만하면 검색과 같은
 * 라인에. '엑셀 가져오기/내보내기'로 병합할것"*. 누르면 두 항목(내보내기 = 지금 화면 목록 파일 · 가져오기 = 공용 창).
 * 🔴 가져오기 항목은 **서버가 `canManageTenant`로 정한 `importKind`**가 있을 때만 — 없으면 내보내기만 남는다(올리기 주소도 같은 게이트).
 * 내보내기는 다운로드라 소프트 이동이 아니라 맨 `<a>`.
 */
export function ExcelMenu({
  exportHref,
  exportLabel = "엑셀 내보내기",
  importKind,
}: {
  exportHref: string;
  /** 내보내기 글자 — 강사뷰 영어 화면이면 사전 값을 넘긴다(가져오기는 관리자 전용이라 한국어). */
  exportLabel?: string;
  importKind?: ImportKind | null;
}) {
  const [open, setOpen] = useState(false);
  // 가져오기 권한이 없으면(강사 등) 항목 하나짜리 메뉴를 열게 하지 않는다 — 예전처럼 바로 내려받는 버튼.
  if (!importKind) {
    return (
      <Button variant="ghost" className="text-primary" render={<a href={exportHref} />}>
        {exportLabel}
      </Button>
    );
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" className="text-primary" />}>
          {importKind ? "엑셀 가져오기/내보내기" : exportLabel}
          <EyIcon name="chevronDown" size={16} className="opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem render={<a href={exportHref} />}>
            <EyIcon name="download" size={16} /> {exportLabel}
          </DropdownMenuItem>
          {importKind ? (
            <DropdownMenuItem onClick={() => setOpen(true)}>
              <EyIcon name="upload" size={16} /> 엑셀 가져오기
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {importKind ? <ExcelImportDialog kind={importKind} open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}
