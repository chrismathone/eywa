import { createClient } from "@/lib/supabase/server";
import { fetchInChunks } from "@/lib/supabase/batch";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { koDayToEnum } from "../lib/periods";
import { dateOfDowInWeek, slotLiveOnDate, weekEndOf } from "../lib/week";
import type { StudentBusyWindow } from "../lib/student-busy";

/**
 * 끌고 있는 **그 학생 한 명**이 그 주에 이미 잡혀 있는 칸들 — 시간표에서 학생을 집는 순간 한 번 부른다
 * (원장 2026-09-09 *"영어를 듣는 학생이면 영어 스케줄 때문에 이동이 불가능한 곳은 … 차단시켜"*).
 *
 * 🔴 **왜 서버 왕복인가**: 재료는 "그 학생의 **전 과목** 주간 배치"인데, 화면은 지금 보는 과목만 갖고 있다.
 *    화면에 뜬 학생 전원 몫을 페이지 payload에 미리 실으면(수백 명 × 여러 칸) 매 로드마다 100KB급이 붙는다 —
 *    한 명분은 열 줄 남짓이라 **집을 때 한 번** 받는 편이 훨씬 싸다(반 블록 이동의 색인과 반대 선택인 이유:
 *    저쪽은 화면의 **모든** 반을 판정해야 해서 미리 접는 게 맞다).
 * 🔴 **떠나는 반은 뺀다**(`excludeClassId`) — 학생은 그 반을 나가면서 옮기는 것이라, 안 빼면 제 시간과
 *    부딪혀 모든 칸이 막힌다.
 * 🔴 **실패는 조용히 빈 배열**(fail-open) — 이 값은 표식이지 게이트가 아니다. 못 받아 오면 빗금이 안 서고
 *    종전과 똑같이 동작한다(거짓 차단이 표식 없는 것보다 나쁘다).
 * 🔴 **서버 액션이 아니라 라우트 핸들러**로 부른다(`/api/timetable/student-busy`) — 서버 액션의 응답은
 *    현재 라우트의 RSC 트리를 다시 적용하는데([[#102]]), 그게 드래그 도중에 오면 끌던 줄이 언마운트되어
 *    **드래그가 통째로 죽는다**. 이 파일은 그래서 `"use server"`가 아니다.
 * ⚠️ 권한은 세션 클라이언트(RLS)에 맡긴다 — 읽는 것은 **그 학생의 배치 시각**뿐이고 이름·성적이 없다.
 *    강사 스코핑이 걸린 계정이면 RLS·정책이 알아서 좁힌다.
 */
export async function loadStudentBusyWindows(input: {
  studentId: string;
  /** 그 주 월요일(`YYYY-MM-DD`) — 화면이 보고 있는 주. */
  weekMonday: string;
  /** 지금 그 학생이 있는 반(그 반의 칸은 창에서 뺀다). */
  excludeClassId?: string | null;
}): Promise<{ windows: StudentBusyWindow[] }> {
  const { studentId, weekMonday } = input;
  if (!studentId || !/^\d{4}-\d{2}-\d{2}$/.test(weekMonday)) return { windows: [] };
  const weekEnd = weekEndOf(weekMonday);
  try {
    const supabase = await createClient();
    const { data: ens, error } = await supabase
      .from("enrollments")
      .select("class_id, start_date, end_date, on_hold, is_transferred, attendance_days, class:class_id ( class_name, is_active )")
      .eq("student_id", studentId);
    if (error || !ens) return { windows: [] };

    type EnrollRow = {
      class_id: string;
      start_date: string | null;
      end_date: string | null;
      on_hold: boolean | null;
      is_transferred: boolean | null;
      attendance_days: string[] | null;
      class: { class_name?: string | null; is_active?: boolean | null } | { class_name?: string | null; is_active?: boolean | null }[] | null;
    };
    const alive = (ens as EnrollRow[]).filter((e) => {
      if (e.class_id === input.excludeClassId) return false;
      if (e.on_hold) return false; // 휴원 중이면 그 시간에 실제로 오지 않는다
      const klass = Array.isArray(e.class) ? e.class[0] : e.class;
      if (klass?.is_active === false) return false;
      const start = e.start_date ? String(e.start_date).slice(0, 10) : null;
      if (start && start > weekEnd) return false;
      // 종료 규약은 [eligibility](@/features/enrollments/eligibility) 하나 — 반이동은 적용일 당일부터 새 반이다.
      if (e.end_date && isEnrollmentEndedOn(String(e.end_date).slice(0, 10), weekMonday, e.is_transferred ?? false))
        return false;
      return true;
    });
    if (alive.length === 0) return { windows: [] };

    const nameOf = new Map<string, string>();
    const daysOf = new Map<string, string[]>();
    /** 반 → 그 수강의 구간(요일 칸의 **실제 날짜**로 다시 판정하려고 든다). */
    const spanOf = new Map<string, { start: string | null; end: string | null; transferred: boolean }>();
    for (const e of alive) {
      const klass = Array.isArray(e.class) ? e.class[0] : e.class;
      nameOf.set(e.class_id, klass?.class_name ?? "다른 반");
      // 분리등원(요일 제한)은 한글 요일로 저장돼 있다 — enum으로 맞춰야 배치의 `day_of_week`와 비교된다.
      // ⚠️ 이미 enum(`mon`)으로 든 저장분도 있어 `?? d`로 그대로 통과시킨다.
      const days = (e.attendance_days ?? []).map((d) => koDayToEnum(d) ?? d).filter(Boolean);
      if (days.length > 0) daysOf.set(e.class_id, days);
      spanOf.set(e.class_id, {
        start: e.start_date ? String(e.start_date).slice(0, 10) : null,
        end: e.end_date ? String(e.end_date).slice(0, 10) : null,
        transferred: e.is_transferred ?? false,
      });
    }

    const rows = await fetchInChunks([...nameOf.keys()], (chunk) =>
      supabase
        .from("class_schedules")
        .select("class_id, day_of_week, start_time, end_time, valid_from, valid_to")
        .in("class_id", chunk),
    ).catch(() => null);
    if (!rows) return { windows: [] };

    const windows: StudentBusyWindow[] = [];
    for (const r of rows as { class_id: string; day_of_week: string; start_time: string; end_time: string; valid_from: string | null; valid_to: string | null }[]) {
      // ⚠️ `class_schedules`는 운영 이력을 함께 담는다([[#88]]) — 그 주에 실제로 도는 줄만 본다.
      if (!slotLiveOnDate({ dayOfWeek: r.day_of_week, validFrom: r.valid_from, validTo: r.valid_to }, weekMonday))
        continue;
      const only = daysOf.get(r.class_id);
      if (only && !only.includes(r.day_of_week)) continue; // 그 요일엔 안 오는 학생
      // 🔴 수강 구간은 **그 요일 칸의 실제 날짜**로 본다 — 주 시작 하나로 판정하면 주중에 끝나는 수강이
      //    남은 요일까지 막고(거짓 차단), 주 끝으로 판정하면 실제로 다닌 요일이 통째로 빠진다(놓침).
      //    날짜로 보면 둘 다 안 생긴다(위 필터는 값싼 예비 거르기일 뿐이다).
      const span = spanOf.get(r.class_id);
      const cellDate = dateOfDowInWeek(weekMonday, r.day_of_week);
      if (span && cellDate) {
        if (span.start && span.start > cellDate) continue;
        if (isEnrollmentEndedOn(span.end, cellDate, span.transferred)) continue;
      }
      windows.push({
        classId: r.class_id,
        className: nameOf.get(r.class_id) ?? "다른 반",
        day: r.day_of_week,
        start: String(r.start_time).slice(0, 5),
        end: String(r.end_time).slice(0, 5),
      });
    }
    return { windows };
  } catch {
    return { windows: [] };
  }
}
