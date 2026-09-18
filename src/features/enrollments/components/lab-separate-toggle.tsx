"use client";

import { useState, useTransition } from "react";
import { setEnrollmentLabSeparate } from "@/features/enrollments/server/lab-separate-actions";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { LAB_SEPARATE_LABEL, LAB_SEPARATE_TEXT_CLASS } from "@/features/timetable/lib/lab-separate";

/**
 * 반 상세 학생 줄의 **EiE 토글** — 이 학생을 LAB '따로 수업(*LAB)' 교시에 배정한다(0271b, 원장 2026-09-17).
 *
 * 모양은 반 수정 폼 교시 편집기의 '따로 수업' 토글과 같은 스위치다(같은 표식을 켜는 두 자리가 달라 보이지 않게).
 * 🔑 누르면 바로 저장한다(즉시 적용 — 날짜 없음). 화면은 먼저 바뀌고, 저장이 실패하면 되돌리고 이유를 적는다.
 * 노출·권한은 호출부가 정한다(서버 액션이 같은 판정을 다시 본다, #77).
 */
export function LabSeparateToggle({
  enrollmentId,
  studentName,
  initialOn,
}: {
  enrollmentId: string;
  studentName: string;
  initialOn: boolean;
}) {
  const t = useSheetT();
  const [on, setOn] = useState(initialOn);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const toggle = () => {
    const next = !on;
    setOn(next);
    setErr(null);
    start(async () => {
      const res = await setEnrollmentLabSeparate(enrollmentId, next);
      if ("error" in res) {
        setOn(!next);
        setErr(res.error);
      }
    });
  };

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${studentName} ${t("cls.d.labSepAria")}`}
        title={t("cls.d.labSepTitle")}
        disabled={pending}
        onClick={toggle}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-bold transition disabled:opacity-60 ${
          on ? "border-blue bg-blue-soft text-blue" : "border-line text-foreground hover:bg-muted"
        }`}
      >
        <span
          aria-hidden
          className={`relative inline-block h-3.5 w-6 rounded-full transition ${on ? "bg-blue" : "bg-neutral-fill"}`}
        >
          <span
            className={`absolute top-0.5 size-2.5 rounded-full bg-white transition-all ${on ? "left-3" : "left-0.5"}`}
          />
        </span>
        <span className={on ? LAB_SEPARATE_TEXT_CLASS : "opacity-50"}>{LAB_SEPARATE_LABEL}</span>
      </button>
      {err ? (
        <span className="text-danger text-xs" role="alert">
          {err}
        </span>
      ) : null}
    </span>
  );
}
