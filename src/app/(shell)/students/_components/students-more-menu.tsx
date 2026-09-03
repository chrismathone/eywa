"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { StudentImportDialog } from "./student-import-dialog";

/**
 * 학생목록 머리의 **텍스트 Secondary 하나** — '엑셀'(내보내기·가져오기). 지시서 §9·§10: 내보내기·가져오기는 상시
 * 버튼이 아니라 2차(더보기)로, 아이콘 온리 `⋮`가 아니라 읽히는 글자로. 상시 버튼은 '새 학생'(Primary) + 이것뿐이다.
 * 가져오기 다이얼로그는 메뉴 항목이 연다(다이얼로그 자체의 트리거 버튼은 이 자리에서 감춘다).
 */
export function StudentsMoreMenu({ exportHref, canImport }: { exportHref: string; canImport: boolean }) {
  const [importOpen, setImportOpen] = useState(false);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={`${CONTROL_H} ${CONTROL_LABEL} text-primary hover:bg-bg-soft inline-flex items-center gap-0.5 rounded-md px-1.5 font-medium whitespace-nowrap transition`}
            />
          }
        >
          엑셀
          {/* 아이콘은 라벨(18px)과 같은 크기(±10%). */}
          <EyIcon name="chevronDown" size={18} className="opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem render={<a href={exportHref} />}>엑셀 내보내기</DropdownMenuItem>
          {canImport ? <DropdownMenuItem onClick={() => setImportOpen(true)}>엑셀 가져오기</DropdownMenuItem> : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {canImport ? <StudentImportDialog open={importOpen} onOpenChange={setImportOpen} /> : null}
    </>
  );
}
