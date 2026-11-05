"use client";

import { useState } from "react";
import { UserPlus } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  EnrollmentAssignDialog,
  type AssignDialogClass,
  type AssignDialogStudent,
} from "@/components/enrollment-assign-dialog";

export function ClassAssignAction({
  klass,
  studentOptions,
  allowTransfer,
}: {
  klass: AssignDialogClass;
  studentOptions: AssignDialogStudent[];
  /** '반이동' 토글 — 서버 `moveEnrollmentsBatch`와 같은 판정(classes full)을 반 상세 page.tsx가 내린다. */
  allowTransfer: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        학생 배정
      </Button>
      <EnrollmentAssignDialog
        open={open}
        onClose={() => setOpen(false)}
        mode="add-student-to-class"
        fixedClass={klass}
        studentOptions={studentOptions}
        allowTransfer={allowTransfer}
      />
    </>
  );
}
