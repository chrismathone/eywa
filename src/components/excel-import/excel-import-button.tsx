"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Button } from "@/components/ui/button";
import { IMPORT_META, type ImportKind } from "@/features/excel-import/kinds";
import { ExcelImportDialog } from "./excel-import-dialog";

/**
 * 탭 툴바의 '엑셀로 넣기' 버튼 — 창까지 함께. 🔴 보여 줄지는 **서버가 `canManageTenant`로 정한 값**을 넘겨받는다
 * (화면에서만 숨기는 건 게이트가 아니다 — 올리기 주소도 같은 판정을 한다, [[#77]]).
 */
export function ExcelImportButton({
  kind,
  label,
  short = false,
  variant = "outline",
}: {
  kind: ImportKind;
  label?: string;
  /** '엑셀로 넣기'만(탭 이름이 이미 보이는 자리). 🔑 사전 가드가 걸린 화면 파일은 한글 label 대신 이걸 쓴다. */
  short?: boolean;
  variant?: "outline" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant={variant} onClick={() => setOpen(true)} data-excel-import={kind}>
        <EyIcon name="upload" size={16} /> {label ?? (short ? "엑셀로 넣기" : `${IMPORT_META[kind].title} 엑셀로 넣기`)}
      </Button>
      <ExcelImportDialog kind={kind} open={open} onOpenChange={setOpen} />
    </>
  );
}
