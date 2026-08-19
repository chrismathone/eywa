"use client";

/**
 * ECS '+ 보강 학생 추가' — 원스크린과 **같은 질문, 같은 저장**(원장 2026-08-19: *"영어도 보강추가시 같은
 * 동작으로 하게 해주고"*). 검색 → 확인창(며칠자 결석분·시수) → `setAttendanceCell(status:"makeup")`
 * (+ 고른 결석분이 있으면 연결)까지 [`MakeupAddFlow`](@/features/attendance/components/makeup-add-flow)가 맡는다.
 * 저장 축이 출석부와 같아 세 화면이 같은 칸을 본다.
 */
import { useRouter } from "next/navigation";
import { MakeupAddFlow } from "@/features/attendance/components/makeup-add-flow";
import { buildMakeupSlotOptions, type MakeupSlotSource } from "@/features/attendance/makeup-slot";

export function EcsMakeupAdder({
  classId,
  date,
  existingIds,
  canAdd,
  slots,
}: {
  classId: string;
  date: string;
  existingIds: ReadonlySet<string>;
  canAdd: boolean;
  /**
   * 그 반 그날의 교시들 — 확인창이 "어느 교시에 왔나요"를 묻고 그 교시 칸에 저장한다.
   * 🔴 **화면에 보이는 교시만** 넘긴다(숨긴 자리는 이미 빠져 있다) — 보이지 않는 교시를 고르게 하면
   *    그 칸은 저장 뒤에도 어디에도 안 보인다("보이는 교시 = 세는 교시" 규약).
   */
  slots?: readonly MakeupSlotSource[];
}) {
  const router = useRouter();
  if (!canAdd) return null;
  return (
    <MakeupAddFlow
      classId={classId}
      date={date}
      alreadyIn={existingIds}
      slotOptions={slots ? buildMakeupSlotOptions(slots) : undefined}
      onDone={() => router.refresh()}
    />
  );
}
