"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { saveAttendanceShowActualSalary } from "@/features/attendance/server/prefs-actions";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * '실급여 보이기' 토글 — 원장 2026-09-21 *"관리자 출석부 우측에 토글 두고 '실급여 보이기' 추가해줘. 체크하면
 * 해당 선생님 출석부에 '실급여' 열이 추가되서 보이는걸로"*.
 *
 * ⚠️ 계정 귀속 설정(`users.ui_prefs.attendance.showActualSalary`, 원장 2026-08-04 "모든 뷰 세팅은 계정 귀속")이다.
 *    열은 **서버가** 실급여 값을 실어야 서므로 저장 후 `router.refresh()`(퇴직자 숨김·기간 토글과 같은 규약).
 * ⚠️ 이 토글은 권한이 아니다 — 페이지가 **관리자 + 프리랜서 강사 전체 보기**일 때만 이 부품을 마운트한다.
 */
export function ActualSalaryToggle({ checked }: { checked: boolean }) {
  const router = useRouter();
  const t = useSheetT();
  const [pending, startTransition] = useTransition();
  // 누르는 즉시 체크가 바뀌게(서버 왕복 동안 옛 상태로 보이면 두 번 누른다). 새로 그려지면 서버 값이 이긴다.
  const [local, setLocal] = useState(checked);
  const [lastChecked, setLastChecked] = useState(checked);
  if (lastChecked !== checked) {
    setLastChecked(checked);
    setLocal(checked);
  }

  return (
    <label
      className={`border-line bg-card inline-flex cursor-pointer items-center gap-1.5 rounded border px-2 py-0.5 text-xs whitespace-nowrap ${pending ? "opacity-60" : ""}`}
      title={t("att.actualSalary.toggleTitle")}
    >
      <input
        type="checkbox"
        checked={local}
        disabled={pending}
        onChange={(e) => {
          const next = e.target.checked;
          setLocal(next);
          // 실패하면 체크를 되돌리고 **알린다** — 말없이 되돌아가면 "눌렀는데 안 먹는다"로 읽힌다.
          // 액션이 던지는 경우(네트워크 끊김)도 같은 갈래로 받는다(안 받으면 저장 안 된 체크가 남고 오류가 경계로 샌다).
          startTransition(async () => {
            let ok = false;
            try {
              ok = (await saveAttendanceShowActualSalary(next)).ok;
            } catch {
              ok = false;
            }
            if (!ok) {
              setLocal(!next);
              toast.error(t("att.actualSalary.saveFailed"));
              return;
            }
            router.refresh();
          });
        }}
      />
      {t("att.actualSalary.toggle")}
    </label>
  );
}
