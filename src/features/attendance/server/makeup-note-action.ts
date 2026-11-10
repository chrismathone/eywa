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
 * ⚠️ 결석 칸은 **상태로 찾는다**(최신 1건이 아니라) — 하루 여러 교시를 도는 반에서는 최신 행이
 *    다른 교시의 출석이라 결석을 눈앞에 두고 못 찾았다(2026-08-19 수정, 실측 21건).
 * ⚠️ 메모를 붙이는 대상은 **실제 결석/공결 칸**뿐이다 — 아무 날짜·아무 반에 한 줄을 붙일 수 있으면
 *    쓰기 표면이 조용히 넓어진다(#77). 없는 칸은 만들지 않고 "없었다"고 돌려준다(선보강이 그 경우다).
 */

import { getCurrentUser } from "@/lib/auth/current-user";
import { logAction } from "@/features/audit/server/log";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { makeupDeadlineError } from "./makeup-deadline-gate";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "../edit-window";
import { userTaughtClassSet } from "@/features/attendance/live/server/write-policy";
import { fetchAbsenceCells, pickAbsenceNoteTarget } from "./absence-cell";
import { loadMakeupAnchorCandidates } from "@/features/onescreen/server/makeup-anchor-sync";
import {
  absenceMemo,
  appendMemo,
  hasMemoLine,
  makeupMemo,
} from "@/features/onescreen/makeup-absence-link";
import { explainDbError } from "@/lib/supabase/db-error";

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
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };
  const { studentId, makeupClassId, makeupDate, absentClassId, absentDate } = input;
  if (!studentId || !makeupClassId || !absentClassId) return { error: "필수 값이 누락되었습니다" };
  if (!YMD.test(makeupDate) || !YMD.test(absentDate)) return { error: "잘못된 날짜입니다" };
  if (absentDate === makeupDate) return { error: "결석한 날과 보강한 날이 같습니다" };
  // 보강 기한(결석한 달의 다음 달 말일) — 강사뷰 목록이 빼는 결석을 '직접 입력'으로 되살리지 못하게 같은 판정(#77).
  const deadlineError = await makeupDeadlineError(absentDate, makeupDate);
  if (deadlineError) return { error: deadlineError };

  const supabase = await createClient();

  // 게이트 — **보강을 한 반**이 내 담당인지만 본다(수강 여부는 안 본다: 보강생은 비수강이 정상).
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(makeupDate, kstToday())) {
      return { error: attendanceLockMessage(makeupDate, kstToday()) };
    }
    const teaching = await userTaughtClassSet(supabase, user.id, makeupDate);
    // 대신 보강(원장 결정 2, 2026-09-30) — 위임 없이 남의 반 학생을 보강하면 그 학생의 **원래 반**이 보강 반이다.
    // 그 반은 내 담당이 아니지만 보강 등록 문이 받은 반(학생이 다니는 반)이라 메모를 붙일 수 있어야 한다(같은 판정).
    if (!teaching.has(makeupClassId)) {
      const cands = await loadMakeupAnchorCandidates(supabase, {
        tenantId: user.tenantId,
        userId: user.id,
        studentId,
        date: makeupDate,
      }).catch(() => []);
      if (!cands.some((c) => c.id === makeupClassId && c.enrolled)) return { error: "담당 반이 아닙니다" };
    }
  }

  /** 보강 칸 — 방금 연 그 칸(그날 그 반의 최신 1건). */
  const makeupCellQuery = supabase
    .from("attendance_records")
    .select("id, status, note")
    .eq("class_id", makeupClassId)
    .eq("student_id", studentId)
    .eq("session_date", makeupDate)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 결석 칸 찾기는 두 경로가 공유하는 규약을 쓴다(absence-cell.ts — 정정 이력을 걷어낸 뒤 상태로 좁힌다).
  const [makeupCell, absentRes] = await Promise.all([
    makeupCellQuery.then((r) => r.data),
    fetchAbsenceCells(supabase, { studentId, classId: absentClassId, date: absentDate }),
  ]);
  // 🔴 조회 실패를 "결석 없음"으로 위장하지 않는다 — 그 위장이 이 기능이 고치려던 증상이다.
  if (!absentRes.ok) return { error: absentRes.error };
  const absentRows = absentRes.cells;

  const memoOnMakeup = makeupMemo(absentDate, makeupDate);
  const alreadyLinked = hasMemoLine(makeupCell?.note, memoOnMakeup);

  const memoOnAbsence = absenceMemo(makeupDate, absentDate);
  const absentTarget = pickAbsenceNoteTarget(absentRows, memoOnAbsence);

  const writes: PromiseLike<{ error: { message: string } | null }>[] = [];
  // ① 결석 칸 — 결석/공결 칸에만 붙는다(쿼리가 이미 좁혔다). 없으면 만들지 않는다(선보강).
  if (absentTarget && !hasMemoLine(absentTarget.note, memoOnAbsence)) {
    writes.push(
      supabase
        .from("attendance_records")
        .update({ note: appendMemo(absentTarget.note, memoOnAbsence) })
        .eq("id", absentTarget.id),
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
  if (failed?.error) return { error: explainDbError(failed.error, { scope: "attendance.makeup-note-action.noteMakeupAgainstAbsence", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };

  // 시수까지 고치는 연결(`linkMakeupToAbsence`)과 같은 키 — 이쪽은 메모만 붙였다(`memoOnly`). 붙인 칸이 없으면 남기지 않는다.
  if (writes.length > 0) {
    await logAction({
      action: "attendance_makeup_link",
      targetType: "attendance",
      metadata: {
        studentId,
        classId: makeupClassId,
        ...(absentClassId !== makeupClassId ? { absentClassId } : {}),
        absentDate,
        makeupDate,
        memoOnly: true,
        absenceNoted: !!absentTarget,
        ...(alreadyLinked ? { alreadyLinked: true } : {}),
      },
    });
  }

  // 🔑 "찾았다"와 "이번에 붙였다"를 구분하지 않는다 — 이미 붙어 있던 경우도 연결된 것이 사실이라,
  //    호출부가 "결석 기록이 없다"고 말하면 그게 거짓이 된다.
  return { ok: true, absenceNoted: !!absentTarget, alreadyLinked };
}
