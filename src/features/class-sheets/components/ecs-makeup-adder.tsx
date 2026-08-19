"use client";

/**
 * ECS '+ 보강 학생 추가' — 원스크린과 **같은 질문, 같은 저장**(원장 2026-08-19: *"영어도 보강추가시 같은
 * 동작으로 하게 해주고"*). 검색 → 확인창(며칠자 결석분·시수) → `setAttendanceCell(status:"makeup")`
 * (+ 고른 결석분이 있으면 연결)까지 [`MakeupAddFlow`](@/features/attendance/components/makeup-add-flow)가 맡는다.
 * 저장 축이 출석부와 같아 세 화면이 같은 칸을 본다.
 */
import { useRouter } from "next/navigation";
import { MakeupAddFlow } from "@/features/attendance/components/makeup-add-flow";

export function EcsMakeupAdder({
  classId,
  date,
  existingIds,
  canAdd,
}: {
  classId: string;
  date: string;
  existingIds: ReadonlySet<string>;
  canAdd: boolean;
}) {
  const router = useRouter();
  if (!canAdd) return null;
  return (
    <MakeupAddFlow
      classId={classId}
      date={date}
      alreadyIn={existingIds}
      onDone={() => router.refresh()}
    />
  );
}
