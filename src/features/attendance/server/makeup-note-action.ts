"use server";

/**
 * 보강 ↔ 결석 **메모만** 잇는다 — 시수는 건드리지 않는다.
 *
 * 🔴 왜 `linkMakeupToAbsence`를 그대로 못 쓰나(적대 리뷰 치명 2건, 2026-08-19):
 *  ① **시수 이중 가산** — 그 액션의 `unitsAfterMakeup(current, add)`는 `current`가 **그날 이미 있던 정규
 *     출결**이라는 전제 위에 있다(정규 1 + 보강 1 = 2). 그런데 새 흐름은 보강 칸을 **방금 자기가**
 *     `units=addUnits`로 열고 곧바로 링크를 부르므로 `current`가 자기 값이 되어 1.5가 3.0이 된다.
 *     그래서 **칸을 여는 쪽이 시수를 소유**하고, 여기서는 메모만 남긴다.
 *  ② **강사(scoped) 전원 실패** — 그 액션은 `enrolled`(그 반 수강생)를 요구하는데 보강은 정의상
 *     그 반 수강생이 아니다. 여기서는 **담당 반에서 보강했는지**만 본다(setAttendanceCell allowMakeup와 같은 결).
 *
 * ⚠️ 메모를 붙이는 대상은 **실제 결석/공결 칸**뿐이다 — 아무 날짜·아무 반에 한 줄을 붙일 수 있으면
 *    쓰기 표면이 조용히 넓어진다(#77). 없는 칸은 만들지 않고 "없었다"고 돌려준다(선보강이 그 경우다).
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "../edit-window";
import { userTaughtClassSet } from "@/features/attendance/live/server/write-policy";
import {
  absenceMemo,
  appendMemo,
  hasMemoLine,
  makeupMemo,
} from "@/features/onescreen/makeup-absence-link";

export type MakeupNoteResult =
  | { ok: true; absenceNoted: boolean; alreadyLinked: boolean }
  | { error: string };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function noteMakeupAgainstAbsence(input: {
  studentId: string;
  /** 오늘 보강을 한 반 — 시수는 이미 이 칸에 적혀 있다(여기선 메모만 덧붙인다). */
  makeupClassId: string;
  makeupDate: string;
  /** 결석이 난 반 — 반을 옮겼으면 옛 반이다(이월 보강). */
  absentClassId: string;
  absentDate: string;
}): Promise<MakeupNoteResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  const { studentId, makeupClassId, makeupDate, absentClassId, absentDate } = input;
  if (!studentId || !makeupClassId || !absentClassId) return { error: "필수 값이 누락되었습니다" };
  if (!YMD.test(makeupDate) || !YMD.test(absentDate)) return { error: "잘못된 날짜입니다" };
  if (absentDate === makeupDate) return { error: "결석한 날과 보강한 날이 같습니다" };

  const supabase = await createClient();

  // 게이트 — **보강을 한 반**이 내 담당인지만 본다(수강 여부는 안 본다: 보강생은 비수강이 정상).
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(makeupDate, kstToday())) {
      return { error: attendanceLockMessage(makeupDate, kstToday()) };
    }
    const teaching = await userTaughtClassSet(supabase, user.id, makeupDate);
    if (!teaching.has(makeupClassId)) return { error: "담당 반이 아닙니다" };
  }

  const cell = (classId: string, date: string) =>
    supabase
      .from("attendance_records")
      .select("id, status, note")
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", date)
      .order("recorded_at", { ascending: false })
      .limit(1)
      .maybeSingle();

  const [{ data: absentCell }, { data: makeupCell }] = await Promise.all([
    cell(absentClassId, absentDate),
    cell(makeupClassId, makeupDate),
  ]);

  const memoOnMakeup = makeupMemo(absentDate, makeupDate);
  const alreadyLinked = hasMemoLine(makeupCell?.note, memoOnMakeup);

  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];
  // ① 결석 칸 — **결석/공결 칸에만** 메모를 붙인다. 없으면 만들지 않는다(선보강).
  const absentStatus = (absentCell?.status as string | null) ?? null;
  const canNote = !!absentCell?.id && (absentStatus === "absent" || absentStatus === "excused");
  if (canNote) {
    writes.push(
      supabase
        .from("attendance_records")
        .update({ note: appendMemo(absentCell!.note, absenceMemo(makeupDate, absentDate)) })
        .eq("id", absentCell!.id),
    );
  }
  // ② 보강 칸 — 메모만(시수는 칸을 연 쪽이 이미 적었다). 칸이 없으면 만들지 않는다.
  if (makeupCell?.id && !alreadyLinked) {
    writes.push(
      supabase
        .from("attendance_records")
        .update({ note: appendMemo(makeupCell.note, memoOnMakeup) })
        .eq("id", makeupCell.id),
    );
  }
  const results = await Promise.all(writes);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  return { ok: true, absenceNoted: canNote, alreadyLinked };
}
