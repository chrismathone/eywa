"use client";

/**
 * '결석 통보 접수' 진입 버튼 — 출석부(월별)와 당일 출결 **양쪽 상단**에 같은 버튼을 둔다
 * (원장 2026-08-19 선택). 데스크가 실제로 열어 두는 화면이 그 둘이라, 어느 쪽에서 전화를 받든
 * 같은 자리에서 끝난다.
 *
 * ⚠️ 다이얼로그는 **열릴 때만 마운트**한다(항상 마운트 + 가드 없는 성공 부수효과 = 재오픈 즉시닫힘, [[#67]]).
 *    `key`로 열 때마다 새 인스턴스를 만들어 이전 입력이 남지 않게 한다.
 */
import { useState } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import { AbsenceIntakeDialog } from "./absence-intake-dialog";

export function AbsenceIntakeButton({ today }: { today: string }) {
  const [open, setOpen] = useState(0); // 0=닫힘, 그 외=열림(값이 곧 인스턴스 key)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(Date.now())}
        className="border-line text-text-dim hover:bg-bg-soft flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-bold transition"
        title="학부모 전화로 받은 결석을 한 번에 등록합니다"
      >
        <EyIcon name="calendarOff" size={14} />
        결석 통보 접수
      </button>
      {open ? <AbsenceIntakeDialog key={open} today={today} onClose={() => setOpen(0)} /> : null}
    </>
  );
}
