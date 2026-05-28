"use client";

import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { StaffForm } from "./staff-form";
import type { SystemRole } from "@/lib/permissions";

export function NewStaffTrigger({ assignableRoleOptions }: { assignableRoleOptions: SystemRole[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <Button onClick={() => setOpen(true)}>
        <EyIcon name="plus" size={13} className="mr-1" />
        직원 등록
      </Button>
      <SheetContent
        side="right"
        className="bg-background w-full max-w-[640px] sm:max-w-[640px] overflow-y-auto p-7"
      >
        <header className="border-line space-y-1 border-b pb-4">
          <p className="micro">직원 등록</p>
          <h2 className="text-foreground text-xl font-bold">새 직원 추가</h2>
          <p className="text-text-dim text-xs leading-relaxed">
            Supabase Auth 계정 자동 생성. 임시 비밀번호는 직원에게 직접 안내 후 첫 로그인 시 변경 요청.
          </p>
        </header>
        <div className="mt-5">
          <StaffForm mode="create" assignableRoleOptions={assignableRoleOptions} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
