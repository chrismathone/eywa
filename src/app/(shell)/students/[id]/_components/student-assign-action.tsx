"use client";

import { useState } from "react";
import { Plus } from "@/components/icons/eywa-icon-compat";
import {
  EnrollmentAssignDialog,
  type AssignDialogClass,
  type AssignDialogStudent,
} from "@/components/enrollment-assign-dialog";

export function StudentAssignAction({
  student,
  classes,
}: {
  student: AssignDialogStudent;
  classes: AssignDialogClass[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-chart-1 hover:underline inline-flex items-center gap-1 text-xs"
      >
        <Plus className="size-3" />
        반 배정
      </button>
      <EnrollmentAssignDialog
        open={open}
        onClose={() => setOpen(false)}
        mode="add-class-to-student"
        student={student}
        classes={classes}
      />
    </>
  );
}
