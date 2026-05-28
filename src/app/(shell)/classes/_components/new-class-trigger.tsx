"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { ClassroomOption } from "@/features/enrollments/server/queries";
import { ClassForm } from "./class-form";

export function NewClassTrigger({
  teacherOptions,
  classroomOptions,
}: {
  teacherOptions: { id: string; name: string }[];
  classroomOptions: ClassroomOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition"
      >
        <EyIcon name="plus" size={13} />
        새 반
      </button>
      <SheetContent
        side="right"
        className="bg-background w-full max-w-[800px] sm:max-w-[800px] overflow-y-auto p-7"
      >
        <header className="border-line space-y-1 border-b pb-4">
          <p className="micro">새 반 생성</p>
          <h2 className="text-foreground text-xl font-bold">반 정보</h2>
          <p className="text-text-dim text-xs leading-relaxed">
            기본 정보 입력 후 주간 스케줄을 설정하세요.
          </p>
        </header>
        <div className="mt-5">
          <ClassForm mode="create" teacherOptions={teacherOptions} classroomOptions={classroomOptions} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
