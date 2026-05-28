"use client";

import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  EnrollmentAssignDialog,
  type AssignDialogClass,
  type AssignDialogStudent,
} from "@/components/enrollment-assign-dialog";

export function ClassAssignAction({
  klass,
  studentOptions,
}: {
  klass: AssignDialogClass;
  studentOptions: AssignDialogStudent[];
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
      />
    </>
  );
}
