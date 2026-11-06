import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstToday } from "@/lib/date-kst";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { attendanceStatusLabel, formatSlotStart } from "@/features/students/detail/attendance-tab";
import { isModuleEnabled } from "@/lib/modules";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { getClassAttendanceStats, getClassDetail, getClassStudents, type ClassScheduleSlot } from "@/features/classes/server/queries";
import { getClassDelegationList } from "@/features/classes/server/delegation";
import { classStatusMeta } from "@/features/classes/list-filters";
import { formatDays, formatMinutes, slotPhase, summarizeSchedule } from "@/features/classes/schedule-summary";
import { isLabSeparateSlot } from "@/features/timetable/lib/lab-separate";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { sheetDowLabel, sheetT } from "@/features/teacher-view/i18n";
import { DEFAULT_SECTOR, SECTOR_DEFS, monthDayKo, othersLabel, type ExploreRow, type ExploreSector, type ExploreTarget } from "../model";
import { NOT_FOUND, deniedSector, distinct, errorSector, forbidden, makeSector, settle, type ExploreLoad } from "./shared";
import { classRuleAnalysis } from "./rule-analysis";

type AttRow = {
  id: string; student_id: string; class_id: string; session_date: string; slot_start: string | null; recorded_at: string; status: string; note: string | null;
  student: { name?: string } | { name?: string }[] | null;
};

/**
 * 수업 중심 — 반 상세와 같은 조회(getClassDetail · getClassStudents · getClassAttendanceStats 30일 · getClassDelegationList).
 * 담임 · 교시 담당(class_schedules.teacher_id) · 임시 위임은 **다른 관계**라 각각의 이름표를 단다(`LIVE_RELATION_SCHEMA`와 같은 말).
 * 열람 스코프는 `getClassDetail`(강사 = 담임 ∪ 교시 담당 ∪ 임시 위임) 그대로.
 */
export async function loadClassCenter(id: string): Promise<ExploreLoad> {
  const user = await getCurrentUser();
  if (!user) return forbidden("로그인이 필요합니다.");
  const klass = await getClassDetail(id);
  if (!klass) {
    if ((await accessLevelTenant(user.systemRole, "classes")) === "scoped") return forbidden("담당 반만 열람할 수 있어요. 이 반은 내가 담임·교시 담당·임시 위임으로 맡은 반이 아니에요.");
    return NOT_FOUND;
  }
  const today = kstToday();
  // 종강일이 지난 반은 **종강일** 기준(반 상세와 같다 — 종강이 배치를 그날로 닫아 오늘 기준이면 '현재' 배치가 빈다).
  const scheduleDay = klass.closedAt && klass.closedAt.slice(0, 10) < today ? klass.closedAt.slice(0, 10) : today;
  const liveSlots = klass.scheduleSlots.filter((s) => slotPhase(s, scheduleDay) !== "past");
  const slotTeacherIds = distinct(liveSlots.map((s) => s.teacherId)).filter((t) => t !== klass.teacherId);
  const roomIds = distinct(liveSlots.map((s) => s.classroomId));
  const supabase = await createClient();
  const [students, stats, delegations, settings, teacherRows, roomRows, canEcs, canMcs, canAttendance, canTimetable, attRows, classLevel] = await Promise.all([
    settle("explore.class.students", getClassStudents(id)),
    settle("explore.class.attendance", getClassAttendanceStats(id, 30)),
    settle("explore.class.delegations", getClassDelegationList(id)),
    getTenantSettings(),
    settle("explore.class.slotTeachers", fetchInChunks<{ id: string; display_name: string | null }>(slotTeacherIds, (chunk) => supabase.from("users").select("id, display_name").in("id", chunk))),
    settle("explore.class.rooms", fetchInChunks<{ id: string; name: string }>(roomIds, (chunk) => supabase.from("classrooms").select("id, name").in("id", chunk))),
    canAccessTenant(user.systemRole, "ecs"),
    canAccessTenant(user.systemRole, "mcs"),
    canAccessTenant(user.systemRole, "attendance"),
    canAccessTenant(user.systemRole, "timetable"),
    // 출결 내역(학생·날짜·상태) — 통계(getClassAttendanceStats)와 같은 30일 창·같은 정정 접기. 영역 중심의 요약함 재료.
    settle("explore.class.attendanceRows", fetchAllPaged<AttRow>((from, to) =>
      supabase.from("attendance_records").select("id, student_id, class_id, session_date, slot_start, recorded_at, status, note, student:student_id ( name )")
        .eq("class_id", id).gte("session_date", addDays(today, -30)).order("id").range(from, to))),
    // 강의실 중심은 수업 전체를 보는 계정만 연다(room.ts) — 담당 반만 보는 계정엔 강의실을 대상으로 올리지 않는다.
    accessLevelTenant(user.systemRole, "classes"),
  ]);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const [dStudents, dTeacher, dTimetable, dRoom, dAttendance, dSheet] = SECTOR_DEFS.class;
  const roomName = new Map((roomRows.ok ? roomRows.value : []).map((r) => [r.id, r.name]));
  const teacherName = new Map((teacherRows.ok ? teacherRows.value : []).map((r) => [r.id, r.display_name ?? "이름 확인 필요"]));
  const slotLabel = (s: ClassScheduleSlot) => `${sheetDowLabel(s.dayOfWeek, "ko")} ${s.startTime}~${s.endTime}`;

  const sectors: ExploreSector[] = [
    (() => {
      if (!students.ok) return errorSector(dStudents);
      const roster = students.value.filter((s) => s.phase !== "upcoming");
      const upcoming = students.value.filter((s) => s.phase === "upcoming");
      const toTarget = (s: (typeof roster)[number], meta: string | null): ExploreTarget => ({
        kind: "student", id: s.studentId, label: s.name,
        detail: schoolGradeLabel(s.school, s.grade) || null,
        meta,
        badge: s.onHold ? { label: "휴원", color: "amber" } : s.phase === "leaving" ? { label: "종료 예정", color: "neutral" } : null,
      });
      return makeSector(dStudents, {
        summary: roster.length > 0 ? othersLabel(roster.map((s) => s.name), "명") : upcoming.length > 0 ? `배정 예정 ${upcoming.length}명` : "수강 원생 없음",
        state: roster.length + upcoming.length > 0 ? "ready" : "empty",
        targets: roster.map((s) => toTarget(s, null)),
        groups: upcoming.length ? [{ label: "배정 예정", targets: upcoming.map((s) => toTarget(s, `${monthDayKo(s.enrolledAt)} 합류`)) }] : [],
        note: `오늘 명단 ${roster.length}명${upcoming.length ? ` · 배정 예정 ${upcoming.length}명(오늘 수와 섞어 세지 않음)` : ""}`,
      });
    })(),
    (() => {
      const targets: ExploreTarget[] = [];
      if (klass.teacherId) targets.push({ kind: "teacher", id: klass.teacherId, label: klass.teacherName ?? "이름 확인 필요", meta: "담임" });
      if (!teacherRows.ok && slotTeacherIds.length > 0) return errorSector(dTeacher);
      for (const tid of slotTeacherIds) {
        const n = liveSlots.filter((s) => s.teacherId === tid).length;
        targets.push({ kind: "teacher", id: tid, label: teacherName.get(tid) ?? "이름 확인 필요", meta: `교시 담당 · ${n}칸` });
      }
      if (delegations.ok) {
        for (const d of delegations.value) {
          const label = d.fromDate > today ? `임시 위임 예정 ${monthDayKo(d.fromDate)}~${monthDayKo(d.toDate)}` : `임시 위임 ~${monthDayKo(d.toDate)}`;
          targets.push({ kind: "teacher", id: d.delegateUserId, label: d.delegateName ?? "이름 확인 필요", meta: label });
        }
      }
      return makeSector(dTeacher, {
        summary: klass.teacherName ?? (targets[0] ? `${targets[0].label} (${targets[0].meta})` : "담임 미지정"),
        state: targets.length > 0 ? "ready" : "empty",
        targets,
        note: [
          !delegations.ok ? "임시 위임은 조회하지 못했습니다." : null,
          klass.pendingTeacherName ? `인수인계 예정: ${klass.pendingTeacherName}${klass.pendingTeacherDate ? ` (${monthDayKo(klass.pendingTeacherDate)}부터)` : ""}` : null,
        ].filter(Boolean).join(" ") || null,
      });
    })(),
    (() => {
      // '따로 수업(*LAB)' 교시는 산정에서 뺀다(반 상세 시간표 요약과 같은 규칙).
      const schedule = summarizeSchedule(liveSlots.filter((s) => !isLabSeparateSlot(s.slotTeacherLabel, s.labSeparate)), scheduleDay);
      const first = schedule.current[0];
      const firstUp = schedule.upcoming[0];
      return makeSector(dTimetable, {
        summary: first
          ? `${formatDays(first.days)} ${first.startTime}${schedule.current.length > 1 ? ` 외 ${schedule.current.length - 1}` : ""}`
          : firstUp ? `${formatDays(firstUp.days)} ${firstUp.startTime} (${monthDayKo(schedule.upcomingFrom)}부터)` : "배치 없음",
        state: first || firstUp ? "ready" : "empty",
        rows: [
          ...schedule.byDay.map((r, i) => ({ id: `d${i}`, title: formatDays(r.days), right: r.ranges.map((x) => `${x.start}~${x.end}`).join(", ") })),
          ...schedule.upcomingByDay.map((r, i) => ({ id: `u${i}`, title: `${formatDays(r.days)} (예정)`, right: r.ranges.map((x) => `${x.start}~${x.end}`).join(", ") })),
        ],
        links: canTimetable ? [{ href: `/timetable?subject=${encodeURIComponent(klass.subject)}`, label: "시간표 열기" }] : [],
        note: schedule.sessions > 0 ? `주 ${schedule.sessions}회 · ${formatMinutes(schedule.minutes)}` : null,
      });
    })(),
    (() => {
      const slotRooms = distinct(liveSlots.map((s) => (s.classroomId ? roomName.get(s.classroomId) ?? null : null)));
      const name = klass.classroomName ?? slotRooms[0] ?? null;
      // 등록된 강의실(배치에 이어진 방 + 반 기본 강의실) = 대상 — 더블클릭하면 그 강의실이 중심(시안 :3978 강의실 중심).
      const roomTargets: ExploreTarget[] =
        classLevel === "scoped"
          ? []
          : distinct([...liveSlots.map((s) => s.classroomId), klass.classroomId]).map((rid) => {
              const n = liveSlots.filter((s) => s.classroomId === rid).length;
              return { kind: "room" as const, id: rid, label: roomName.get(rid) ?? (rid === klass.classroomId ? klass.classroomName : null) ?? "강의실", meta: n > 0 ? `${n}칸` : "반 기본 강의실" };
            });
      return makeSector(dRoom, {
        targets: roomTargets,
        summary: name ? (slotRooms.length > 1 ? `${name} 외 ${slotRooms.length - 1}` : name) : "강의실 미지정",
        state: name ? "ready" : "empty",
        rows: liveSlots.map((s) => ({ id: s.id, title: slotLabel(s), right: (s.classroomId ? roomName.get(s.classroomId) : null) ?? klass.classroomName ?? "—" })),
        note: klass.classroomName ? `반 기본 강의실 ${klass.classroomName}` : null,
      });
    })(),
    (() => {
      if (!stats.ok) return errorSector(dAttendance);
      const a = stats.value;
      const recs = attRows.ok ? effectiveAttendanceRecords(attRows.value) : null;
      const item = (r: AttRow): ExploreRow => ({
        id: r.id,
        title: (Array.isArray(r.student) ? r.student[0] : r.student)?.name ?? "학생 확인 필요",
        date: r.session_date,
        right: attendanceStatusLabel(r.status),
        detail: [r.slot_start ? formatSlotStart(r.slot_start) : null, r.note].filter(Boolean).join(" · ") || null,
      });
      const pick = (pred: (s: string) => boolean) => (recs ? recs.filter((r) => pred(r.status)).sort((x, y) => y.session_date.localeCompare(x.session_date)).map(item) : undefined);
      return makeSector(dAttendance, {
        summary: a.total > 0 ? `최근 30일 ${a.rate.toFixed(0)}%` : "30일 기록 없음",
        state: a.total > 0 ? "ready" : "empty",
        rows: [
          { id: "total", title: "기록", right: `${a.total}건`, items: pick(() => true) },
          { id: "present", title: "출석", right: `${a.present}건`, items: pick((s) => s === "present") },
          { id: "late", title: "지각", right: `${a.late}건`, items: pick((s) => s === "late") },
          { id: "absent", title: "결석", right: `${a.absent}건`, items: pick((s) => s === "absent") },
          { id: "excused", title: "인정결석", right: `${a.excused}건`, items: pick((s) => s === "excused") },
        ],
        links: canAttendance ? [{ href: `/attendance/${today}/${klass.id}`, label: "오늘 출석부 열기" }] : [],
        note: canAttendance ? null : "출석부를 열 권한이 없어 통계만 보입니다.",
      });
    })(),
    (() => {
      const disabled = settings.modules.disabled;
      if (klass.subject === "english" && isModuleEnabled(disabled, "ecs")) {
        return canEcs
          ? makeSector(dSheet, { summary: "영어 수업 기록", links: [{ href: `/ecs/${klass.id}`, label: "영어 강사 시트 열기" }] })
          : deniedSector(dSheet);
      }
      if (klass.subject === "math" && isModuleEnabled(disabled, "mcs")) {
        return canMcs
          ? makeSector(dSheet, { summary: "수학 수업 기록", links: [{ href: `/mcs/${klass.id}/month`, label: "수학 강사 시트 열기" }] })
          : deniedSector(dSheet);
      }
      return makeSector(dSheet, { summary: "해당 과목 시트 없음", state: "empty" });
    })(),
  ];

  const status = classStatusMeta(klass);
  return {
    state: "ready",
    model: {
      center: {
        kind: "class",
        id,
        name: klass.className,
        subtitle: klass.teacherName ? `담임 ${klass.teacherName}` : null,
        status: { label: `${subjects.labelOf(klass.subject)} · ${sheetT("ko", status.key)}`, color: status.color },
        icon: "graduationCap",
        detailHref: `/classes/${id}`,
        detailLabel: "수업 상세 열기",
      },
      sectors,
      defaultSector: DEFAULT_SECTOR.class,
      asOf: today,
      // 오른쪽 아래 '분석·판단' — 규칙 판정(출결 · 구성). 숫자는 위 조각과 같은 조회 결과(30일 통계 · 정정 접은 출결 · 오늘 명단).
      analysis: classRuleAnalysis({
        today,
        stats: stats.ok ? stats.value : null,
        recs: attRows.ok ? effectiveAttendanceRecords(attRows.value) : null,
        roster: students.ok
          ? (() => {
              const roster = students.value.filter((s) => s.phase !== "upcoming");
              const by = new Map<string, number>();
              for (const s of roster) {
                const g = schoolGradeLabel(s.school, s.grade) || "학교 미입력";
                by.set(g, (by.get(g) ?? 0) + 1);
              }
              return {
                count: roster.length,
                upcoming: students.value.length - roster.length,
                onHold: roster.filter((s) => s.onHold).length,
                groups: [...by.entries()].sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}명`),
              };
            })()
          : null,
      }),
      aside: {
        heading: "수업 정보",
        basics: { title: "수업 기본 정보", spacer: klass.className, link: { href: `/classes/${id}`, label: "수업 상세 열기" }, facts: [
          { label: "과목", value: subjects.labelOf(klass.subject) },
          { label: "담임", value: klass.teacherName ?? "미지정" },
          { label: "강의실", value: klass.classroomName ?? "미지정" },
          { label: "오늘 명단", value: `${klass.studentCount}명${klass.upcomingCount ? ` · 배정 예정 ${klass.upcomingCount}명` : ""}` },
          ...(klass.closedAt ? [{ label: "종강일", value: klass.closedAt.slice(0, 10) }] : []),
        ] },
      },
    },
  };
}
