"use client";

import { createContext, useContext, type ReactNode } from "react";
import { riderAttendanceText, type RiderAttendance } from "@/features/shuttle/today/rider-attendance";
import { EyIcon } from "@/components/icons/aywa-icons";

/**
 * 하원 줄 이름·학교 **아래** "출석함 · 박소선 선생님 · 중등 수학 A반 16:00~17:50 · 본원302"(사용자 2026-10-30 — 관리자 뷰).
 * 페이지가 셔틀 관리자일 때만 싣고(`getRiderAttendance`), 줄은 컨텍스트로 읽는다(전화번호 줄과 같은 결).
 * 출석이 안 찍혔으면 아무것도 안 그린다.
 */
const Ctx = createContext<Readonly<Record<string, RiderAttendance[]>>>({});

export function RiderAttendanceProvider({ value, children }: { value: Readonly<Record<string, RiderAttendance[]>>; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function RiderAttendanceLine({ studentId }: { studentId: string }) {
  const list = useContext(Ctx)[studentId];
  if (!list?.length) return null;
  return (
    <span className="basis-full">
      {list.map((a, i) => (
        <span key={i} className={a.late ? "text-amber block text-xs font-bold break-keep" : "text-green block text-xs font-bold break-keep"}>
          <EyIcon name="check" size={12} className="mr-0.5 inline align-text-bottom" />{riderAttendanceText(a)}
        </span>
      ))}
    </span>
  );
}
