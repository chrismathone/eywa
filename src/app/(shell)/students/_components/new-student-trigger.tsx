"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { TeacherOption } from "@/features/students/server/queries";
import { StudentForm } from "./student-form";

/**
 * /students 목록 페이지에서 "새 학생" 우측 슬라이드 패널 트리거.
 * 폼 제출 성공 시 createStudent server action이 /students/[id]로 redirect →
 * sheet은 자동 unmount.
 */
export function NewStudentTrigger({ teachers }: { teachers: TeacherOption[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <EyIcon name="plus" size={13} className="mr-1" />새 학생
      </Button>
      <SheetContent
        side="right"
        className="bg-background w-full max-w-[760px] sm:max-w-[760px] overflow-y-auto p-7"
      >
        <header className="border-line space-y-1 border-b pb-4">
          <p className="micro">학생 등록</p>
          <h2 className="text-foreground text-xl font-bold">새 학생 추가</h2>
          <p className="text-text-dim text-xs leading-relaxed">
            기본 정보 + 담임 배정. 등록 후 상세에서 수강 반·출결·AI 케어 인사이트가 따라옵니다.
          </p>
        </header>
        <div className="mt-5">
          <StudentForm mode="create" teachers={teachers} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
