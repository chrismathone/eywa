"use client";

import { useState } from "react";

import { absentParentRide } from "../server/parent-ride-actions";
import { ReasonDialog } from "./reason-dialog";

/**
 * 학부모 [결석] — 사유를 받아 그날 **등원·하원 둘 다** 타지 않게 한다(사용자 2026-09-29).
 * 다시 타려면 [등하원 수정] → [등원 수정하기]에서 시간을 고른다(등원을 살리면 하원도 살아난다).
 * 🔑 자녀가 둘 이상이면 창 안에서 누구인지 고른다(한 명이면 고르지 않는다).
 * ⚠️ 셔틀만이다 — 출석부의 결석은 학원이 따로 처리한다.
 */
export function AbsentButton({
  kids,
  onDate,
  className,
}: {
  kids: { id: string; name: string }[];
  onDate: string;
  className: string;
}) {
  const [kidId, setKidId] = useState(kids[0]?.id ?? "");
  return (
    <ReasonDialog
      triggerClassName={className}
      trigger="결석"
      title="결석 — 등원·하원 모두 타지 않기"
      description="이유를 짧게 남겨 주세요. 학원 선생님이 확인해요. 다시 타려면 [등원 수정하기]에서 시간을 고르면 돼요."
      confirmLabel="결석으로 저장"
      placeholder="예: 감기로 집에서 쉬어요"
      extra={
        kids.length > 1 ? (
          <div role="group" aria-label="자녀 선택" className="flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={k.id === kidId}
                onClick={() => setKidId(k.id)}
                className={`h-8 rounded-full px-3 text-sm font-bold ${
                  k.id === kidId ? "bg-primary text-primary-foreground" : "bg-bg-soft text-foreground"
                }`}
              >
                {k.name}
              </button>
            ))}
          </div>
        ) : null
      }
      onSubmit={(reason) => absentParentRide({ studentId: kidId, onDate, reason })}
    />
  );
}
