"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { StudentOption } from "@/features/consultations/server/queries";
import type { TeacherOption } from "@/features/students/server/queries";
import { ConsultationForm } from "./consultation-form";

export function NewConsultationTrigger({
  students,
  counselors,
}: {
  students: StudentOption[];
  counselors: TeacherOption[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <EyIcon name="plus" size={13} className="mr-1" />
        상담 추가
      </Button>
      <SheetContent
        side="right"
        className="bg-background w-full max-w-[720px] sm:max-w-[720px] overflow-y-auto p-7"
      >
        <header className="border-line space-y-1 border-b pb-4">
          <p className="micro">새 학생상담</p>
          <h2 className="text-foreground text-xl font-bold">상담 기록 추가</h2>
          <p className="text-text-dim text-xs leading-relaxed">
            학생/학부모 면담을 기록합니다. 후속 조치 날짜를 지정하면 기한이 다가올수록 색상으로 알려드립니다.
          </p>
        </header>
        <div className="mt-5">
          <ConsultationForm mode="create" students={students} counselors={counselors} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
