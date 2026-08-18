"use client";

/**
 * ECS '+ 보강 학생 추가' — 출석부와 **같은 검색·같은 저장**.
 * 저장은 `setAttendanceCell({ status:"makeup", allowMakeup:true })`라 출석부·원스크린이
 * 같은 칸을 본다. 검색 게이트는 `searchMakeupStudents`(담당 반).
 */
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setAttendanceCell } from "@/features/attendance/server/actions";
import {
  AttendanceMakeupAdder,
  type MakeupPick,
} from "@/app/(shell)/attendance/[date]/[classId]/makeup-adder";

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

  async function add(s: MakeupPick) {
    if (existingIds.has(s.id)) {
      toast.message(`${s.name}은(는) 이미 이 반 명단에 있습니다`);
      return;
    }
    const res = await setAttendanceCell({
      classId,
      studentId: s.id,
      sessionDate: date,
      status: "makeup",
      allowMakeup: true,
    });
    if ("error" in res) {
      toast.error(res.error);
      return;
    }
    toast.success(`${s.name} 보강 추가 — 출석부·원스크린에도 같은 학생으로 보입니다`);
    router.refresh();
  }

  return <AttendanceMakeupAdder classId={classId} date={date} onAdd={add} />;
}
