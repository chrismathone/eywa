import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canAccessTenant } from "@/lib/auth/perm-matrix";
import { getSuperAdminIds, displayRoleFor, isCurrentUserSuperAdmin } from "@/lib/auth/super-admin";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { addDays, kstMonth, kstMonthStartIso, kstToday } from "@/lib/date-kst";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { isModuleEnabled } from "@/lib/modules";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import type { SystemRole } from "@/lib/permissions";
import { enrollmentPhaseOn } from "@/features/enrollments/eligibility";
import { formatDays, formatMinutes, slotPhase, summarizeSchedule } from "@/features/classes/schedule-summary";
import { getActiveAssistSlotClasses } from "@/features/staff/server/queries";
import { getStaffById } from "@/features/staff/server/queries";
import { roleMeta } from "@/features/staff/status-labels";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { DEFAULT_SECTOR, SECTOR_DEFS, monthDayKo, othersLabel, type ExploreSector, type ExploreTarget } from "../model";
import { NOT_FOUND, deniedSector, distinct, errorSector, forbidden, isScopedRead, makeSector, settle, type ExploreLoad } from "./shared";
import { teacherRuleAnalysis } from "./rule-analysis";

type UserRow = { id: string; display_name: string; english_name: string | null; subjects: string[] | null; system_role: string; status: string; job_title: string | null };
type ClassRow = { id: string; class_name: string; subject: string; closed_at: string | null; classroom: { name?: string } | { name?: string }[] | null };
type SlotRow = { id: string; class_id: string; day_of_week: string; start_time: string; end_time: string; valid_from: string | null; valid_to: string | null; teacher_id: string | null };
type StudentLite = { id: string; name: string; school: string | null; grade: string | null };
type EnrollRow = { id: string; class_id: string; start_date: string; end_date: string | null; is_transferred: boolean | null; on_hold: boolean | null; student: StudentLite | StudentLite[] | null };
const one = <T,>(v: T | T[] | null | undefined): T | undefined => (Array.isArray(v) ? v[0] : v ?? undefined);

/**
 * 강사 중심 — 담당 수업은 **담임(classes.teacher_id) · 교시 담당(class_schedules.teacher_id) · 임시 위임(class_delegations)** 세 관계로
 * 가른다(직원 상세 '수업이력' + 퇴사 경고의 `getActiveAssistSlotClasses`와 같은 축). 담당 원생은 그 수업을 거쳐 이어지며 **중복 없이** 센다.
 * 직원 정보(직원관리 권한)·수업보고서·시트는 각자의 메뉴 권한으로 가리고, 없으면 건수도 내리지 않는다.
 */
export async function loadTeacherCenter(id: string): Promise<ExploreLoad> {
  const user = await getCurrentUser();
  if (!user) return forbidden("로그인이 필요합니다.");
  const level = await accessLevelTenant(user.systemRole, "classes");
  if (level === "none") return forbidden("수업 정보를 볼 권한이 없습니다.");
  // 강사(scoped)는 자기 자신만 — 남의 담당 반 목록은 수업목록 권한 밖이다. 총괄은 새 제한을 자동 통과한다(강사뷰 중엔 안 통과).
  // 🔴 읽기 강사뷰는 담당을 읽기로 누르고(isScopedRead) '본인'은 보는 강사다(teacherView — #154 ①·③).
  if (await isScopedRead(user.systemRole, "classes")) {
    const me = await getCurrentUser({ teacherView: true });
    if (me?.id !== id && !(await isCurrentUserSuperAdmin())) return forbidden("다른 선생님의 담당 수업·원생은 열람할 수 없어요.");
  }
  const supabase = await createClient();
  const { data: u, error: uErr } = await supabase.from("users")
    .select("id, display_name, english_name, subjects, system_role, status, job_title").eq("id", id).maybeSingle<UserRow>();
  if (uErr) return forbidden("강사 정보를 읽지 못했습니다. 잠시 뒤 다시 열어 주세요.");
  if (!u) return NOT_FOUND;
  const today = kstToday();
  const [homeroom, assist, delegated, settings, superIds, canStaff, canReports, canEcs, canMcs, canTimetable, consultLevel] = await Promise.all([
    settle("explore.teacher.homeroom", supabase.from("classes").select("id, class_name, subject, closed_at, classroom:classroom_id ( name )")
      .eq("teacher_id", id).eq("is_active", true).order("class_name").then((r) => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as ClassRow[]; })),
    settle("explore.teacher.assist", getActiveAssistSlotClasses(id)),
    // ⚠️ `class_delegations.class_id`엔 FK가 없어 PostgREST 임베드가 안 된다 — 반 이름은 아래서 따로 읽는다(delegation.ts와 같은 방식).
    settle("explore.teacher.delegated", supabase.from("class_delegations").select("class_id, from_date, to_date")
      .eq("delegate_user_id", id).is("revoked_at", null).lte("from_date", today).gte("to_date", today)
      .then((r) => { if (r.error) throw new Error(r.error.message); return (r.data ?? []) as { class_id: string; from_date: string; to_date: string }[]; })),
    getTenantSettings(),
    getSuperAdminIds(),
    canAccessTenant(user.systemRole, "staff"),
    canAccessTenant(user.systemRole, "lesson_reports"),
    canAccessTenant(user.systemRole, "ecs"),
    canAccessTenant(user.systemRole, "mcs"),
    canAccessTenant(user.systemRole, "timetable"),
    accessLevelTenant(user.systemRole, "consultations"),
  ]);
  // '담당 원생' 상담 판정은 원생상담을 볼 수 있는 계정에게만(#77 — 원생상담 표 RLS는 지점 조건뿐이라 화면에서 가른다).
  const canConsult = consultLevel !== "none";
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 종강일이 지난 반은 담당 수업으로 세지 않는다(종강은 배치도 그날로 닫힌다).
  const homeroomRows = (homeroom.ok ? homeroom.value : []).filter((c) => !c.closed_at || c.closed_at.slice(0, 10) >= today);
  const assistRows = assist.ok ? assist.value : [];
  const classIds = distinct([...homeroomRows.map((c) => c.id), ...assistRows.map((c) => c.id)]);
  const delegatedIds = delegated.ok ? distinct(delegated.value.map((d) => d.class_id)) : [];
  const [slots, enrolls, reportCount, reportRows, staff, delegatedClasses, attRows, consultRows] = await Promise.all([
    settle("explore.teacher.slots", fetchAllPagedInChunks<SlotRow>(classIds, (chunk, from, to) =>
      supabase.from("class_schedules").select("id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id").in("class_id", chunk).order("id").range(from, to))),
    settle("explore.teacher.roster", fetchAllPagedInChunks<EnrollRow>(classIds, (chunk, from, to) =>
      supabase.from("enrollments").select("id, class_id, start_date, end_date, is_transferred, on_hold, student:student_id ( id, name, school, grade )")
        .in("class_id", chunk).or(`end_date.is.null,end_date.gte.${today}`).order("id").range(from, to))),
    canReports ? settle("explore.teacher.reportCount", supabase.from("lesson_reports").select("id", { count: "exact", head: true })
      .eq("created_by", id).gte("report_date", addDays(today, -6)).then((r) => { if (r.error) throw new Error(r.error.message); return r.count ?? 0; })) : Promise.resolve(null),
    canReports ? settle("explore.teacher.reports", supabase.from("lesson_reports").select("id, report_date, student_id").eq("created_by", id)
      .order("report_date", { ascending: false }).order("id", { ascending: false }).limit(5).then((r) => { if (r.error) throw new Error(r.error.message); return r.data ?? []; })) : Promise.resolve(null),
    canStaff ? settle("explore.teacher.staff", getStaffById(id)) : Promise.resolve(null),
    settle("explore.teacher.delegatedClasses", fetchInChunks<{ id: string; class_name: string; subject: string }>(delegatedIds, (chunk) =>
      supabase.from("classes").select("id, class_name, subject").in("id", chunk))),
    // 분석·판단 재료 — 담당 반 최근 30일 출결(수업 중심과 같은 창·같은 정정 접기) · 이번 달 이 선생님이 상담자인 원생상담.
    settle("explore.teacher.attendance", fetchAllPagedInChunks<{ id: string; student_id: string; class_id: string; session_date: string; slot_start: string | null; recorded_at: string; status: string }>(classIds, (chunk, from, to) =>
      supabase.from("attendance_records").select("id, student_id, class_id, session_date, slot_start, recorded_at, status").in("class_id", chunk).gte("session_date", addDays(today, -30)).order("id").range(from, to))),
    // 상담 시각(timestamptz)은 KST 1일 00:00의 절대시각과 견준다(날짜 글자와 견주면 1일 0~9시 상담이 빠진다).
    canConsult
      ? settle("explore.teacher.consultations", fetchAllPagedInChunks<{ student_id: string }>([id], (chunk, from, to) =>
          supabase.from("student_consultations").select("student_id").in("counselor_id", chunk).gte("consulted_at", kstMonthStartIso(kstMonth())).order("id").range(from, to)))
      : Promise.resolve(null),
  ]);
  const delegatedClass = new Map((delegatedClasses.ok ? delegatedClasses.value : []).map((c) => [c.id, c]));
  const studentNames = reportRows?.ok && reportRows.value.length > 0
    ? await settle("explore.teacher.reportStudents", fetchInChunks<{ id: string; name: string }>(distinct(reportRows.value.map((r) => r.student_id as string)), (chunk) => supabase.from("students").select("id, name").in("id", chunk)))
    : null;
  const nameOf = new Map((studentNames?.ok ? studentNames.value : []).map((s) => [s.id, s.name]));

  const homeroomIds = new Set(homeroomRows.map((c) => c.id));
  // 이 선생님의 교시 — 담임 반은 교시 담당이 비었거나 본인인 칸, 교시 담당 반은 본인 칸만. 지난 배치는 뺀다.
  const mySlots = (slots.ok ? slots.value : []).filter((s) => slotPhase({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, validFrom: s.valid_from, validTo: s.valid_to }, today) !== "past")
    .filter((s) => (homeroomIds.has(s.class_id) ? !s.teacher_id || s.teacher_id === id : s.teacher_id === id))
    .map((s) => ({ classId: s.class_id, dayOfWeek: s.day_of_week, startTime: String(s.start_time).slice(0, 5), endTime: String(s.end_time).slice(0, 5), validFrom: s.valid_from, validTo: s.valid_to }));
  const rosterByClass = new Map<string, EnrollRow[]>();
  for (const e of enrolls.ok ? enrolls.value : []) {
    const phase = enrollmentPhaseOn({ startDate: String(e.start_date), endDate: e.end_date, isTransferred: e.is_transferred ?? false }, today);
    if (phase !== "active" && phase !== "leaving") continue;
    rosterByClass.set(e.class_id, [...(rosterByClass.get(e.class_id) ?? []), e]);
  }
  const className = new Map<string, string>([...homeroomRows.map((c) => [c.id, c.class_name] as const), ...assistRows.map((c) => [c.id, c.className] as const)]);
  const scheduleText = (classId: string) => summarizeSchedule(mySlots.filter((s) => s.classId === classId), today).current.map((r) => `${formatDays(r.days)} ${r.startTime}~${r.endTime}`).join(", ");
  const classTarget = (c: { id: string; name: string; subject: string; room?: string | null }, meta: string): ExploreTarget => ({
    kind: "class", id: c.id, label: c.name, meta, detail: subjects.labelOf(c.subject),
    facts: [scheduleText(c.id) || "배치 없음", enrolls.ok ? `원생 ${rosterByClass.get(c.id)?.length ?? 0}명` : "원생 수 확인 불가", c.room ?? null].filter((x): x is string => !!x),
  });
  const [dClasses, dTimetable, dStudents, dSheet, dReports, dStaff] = SECTOR_DEFS.teacher;

  const sectors: ExploreSector[] = [
    (() => {
      if (!homeroom.ok) return errorSector(dClasses);
      const targets: ExploreTarget[] = [
        ...homeroomRows.map((c) => classTarget({ id: c.id, name: c.class_name, subject: c.subject, room: one(c.classroom)?.name ?? null }, "담임")),
        ...assistRows.map((c) => classTarget({ id: c.id, name: c.className, subject: c.subject }, `교시 담당 · ${c.slotCount}칸`)),
        ...(delegated.ok ? delegated.value.map((d) => {
          const cls = delegatedClass.get(d.class_id);
          return { kind: "class" as const, id: d.class_id, label: cls?.class_name ?? "반 확인 필요", meta: `임시 위임 ~${monthDayKo(d.to_date)}`, detail: cls?.subject ? subjects.labelOf(cls.subject) : null };
        }) : []),
      ];
      return makeSector(dClasses, {
        summary: targets.length > 0 ? othersLabel(targets.map((t) => t.label), "개") : "담당 수업 없음",
        state: targets.length > 0 ? "ready" : "empty",
        targets,
        note: [`담임 ${homeroomRows.length}개`, assist.ok ? `교시 담당 ${assistRows.length}개` : "교시 담당은 조회하지 못했습니다", delegated.ok ? (delegated.value.length ? `임시 위임 ${delegated.value.length}개` : null) : "임시 위임은 조회하지 못했습니다"].filter(Boolean).join(" · "),
      });
    })(),
    (() => {
      if (!slots.ok) return errorSector(dTimetable);
      const all = summarizeSchedule(mySlots, today);
      const first = all.current[0];
      return makeSector(dTimetable, {
        summary: first ? `${formatDays(all.days)} · 주 ${all.sessions}회` : "배치 없음",
        state: first ? "ready" : "empty",
        rows: classIds.map((cid) => ({ id: cid, title: className.get(cid) ?? cid, right: scheduleText(cid) || "—" })),
        links: canTimetable ? [{ href: `/timetable?view=teacher${homeroomRows[0] ? `&subject=${encodeURIComponent(homeroomRows[0].subject)}` : ""}`, label: "시간표 열기" }] : [],
        note: all.sessions > 0 ? `주 ${all.sessions}회 · ${formatMinutes(all.minutes)}` : null,
      });
    })(),
    (() => {
      if (!enrolls.ok) return errorSector(dStudents);
      const byStudent = new Map<string, { s: StudentLite; classes: string[]; onHold: boolean }>();
      for (const [cid, rows] of rosterByClass) for (const e of rows) {
        const s = one<StudentLite>(e.student);
        if (!s) continue;
        const hit = byStudent.get(s.id) ?? { s, classes: [], onHold: false };
        hit.classes.push(className.get(cid) ?? cid);
        hit.onHold ||= e.on_hold === true;
        byStudent.set(s.id, hit);
      }
      const targets: ExploreTarget[] = [...byStudent.values()].sort((a, b) => a.s.name.localeCompare(b.s.name, "ko")).map(({ s, classes, onHold }) => ({
        kind: "student", id: s.id, label: s.name, detail: schoolGradeLabel(s.school, s.grade) || null, meta: othersLabel(classes, "개"),
        badge: onHold ? { label: "휴원", color: "amber" } : null,
      }));
      return makeSector(dStudents, {
        summary: targets.length > 0 ? `담당 원생 ${targets.length}명` : "담당 원생 없음",
        state: targets.length > 0 ? "ready" : "empty",
        targets,
        note: "담임·교시 담당 반의 오늘 명단을 중복 없이 센 수입니다(임시 위임 반 제외).",
      });
    })(),
    (() => {
      const taught = new Set([...(u.subjects ?? []), ...homeroomRows.map((c) => c.subject), ...assistRows.map((c) => c.subject)]);
      const links = [
        taught.has("english") && isModuleEnabled(settings.modules.disabled, "ecs") && canEcs ? { href: "/ecs", label: "영어 강사 시트 열기" } : null,
        taught.has("math") && isModuleEnabled(settings.modules.disabled, "mcs") && canMcs ? { href: "/mcs", label: "수학 강사 시트 열기" } : null,
      ].filter((x): x is { href: string; label: string } => !!x);
      if (links.length === 0 && ((taught.has("english") && !canEcs) || (taught.has("math") && !canMcs))) return deniedSector(dSheet);
      return makeSector(dSheet, {
        summary: links.length > 0 ? `${links.map((l) => l.label.slice(0, 2)).join("·")} 수업 기록` : "해당 과목 시트 없음",
        state: links.length > 0 ? "ready" : "empty",
        links,
      });
    })(),
    (() => {
      if (reportCount === null || reportRows === null) return deniedSector(dReports);
      if (!reportCount.ok || !reportRows.ok) return errorSector(dReports);
      return makeSector(dReports, {
        summary: `최근 7일 ${reportCount.value}건`,
        state: reportRows.value.length > 0 ? "ready" : "empty",
        rows: reportRows.value.map((r) => ({ id: r.id as string, title: nameOf.get(r.student_id as string) ?? "학생 확인 필요", date: String(r.report_date).slice(0, 10) })),
        links: [{ href: "/lesson-reports", label: "수업보고서 열기" }],
        note: "작성자 기준 · 오늘 포함 7일 · 최근 5건",
      });
    })(),
    (() => {
      if (staff === null) return deniedSector(dStaff);
      if (!staff.ok) return errorSector(dStaff);
      const s = staff.value;
      if (!s) return deniedSector(dStaff);
      const role = roleMeta(displayRoleFor(s.id, s.systemRole, superIds));
      return makeSector(dStaff, {
        summary: s.jobTitle ? `${s.jobTitle} · 근무 정보` : "프로필 · 근무 정보",
        rows: [
          { id: "role", title: "역할", right: role.label },
          { id: "title", title: "직급", right: s.jobTitle ?? "—" },
          { id: "subjects", title: "담당 과목", right: s.subjects.map((k) => subjects.labelOf(k)).join("·") || "—" },
          { id: "dept", title: "근무부서", right: s.department ?? "—" },
          { id: "hire", title: "입사일", right: s.hireDate ?? "—" },
          { id: "room", title: "기본 강의실", right: s.defaultClassroom ?? "—" },
        ],
        links: [{ href: `/staff/${id}`, label: "직원 상세 열기" }],
      });
    })(),
  ];

  const subjectLabel = (u.subjects ?? []).map((k) => subjects.labelOf(k)).join("·");
  const role = roleMeta(displayRoleFor(u.id, u.system_role as SystemRole, superIds));
  return {
    state: "ready",
    model: {
      center: {
        kind: "teacher",
        id,
        name: u.display_name,
        subtitle: [u.english_name, u.job_title].filter(Boolean).join(" · ") || null,
        status: u.status === "active"
          ? { label: `${subjectLabel ? `${subjectLabel} ` : ""}${role.label}`, color: "green" }
          : { label: u.status === "pending" ? "대기" : "퇴사", color: "neutral" },
        icon: "user",
        detailHref: staff?.ok && staff.value ? `/staff/${id}` : null,
        detailLabel: "직원 상세 열기",
      },
      sectors,
      defaultSector: DEFAULT_SECTOR.teacher,
      asOf: today,
      // 오른쪽 아래 '분석·판단' — 규칙 판정(담당 반 · 담당 원생). 반·원생 수는 위 조각과 같은 명단(rosterByClass).
      // 담임 반을 못 읽었으면 반·원생 수가 줄어든 채 사실처럼 보인다 — 판정하지 않고 까닭을 밝힌다(같은 화면의 '담당 수업' 조각도 오류다).
      analysis: !homeroom.ok ? { state: "error", blocks: [], canRefresh: false, note: "담당 반을 조회하지 못해 판정할 수 없습니다." } : (() => {
        const att = attRows.ok
          ? (() => {
              const m = new Map<string, { total: number; present: number; late: number }>();
              for (const r of effectiveAttendanceRecords(attRows.value)) {
                const a = m.get(r.class_id) ?? { total: 0, present: 0, late: 0 };
                a.total += 1;
                if (r.status === "present") a.present += 1;
                if (r.status === "late") a.late += 1;
                m.set(r.class_id, a);
              }
              return m;
            })()
          : null;
        const rosterIds = new Set([...rosterByClass.values()].flat().map((e) => (Array.isArray(e.student) ? e.student[0]?.id : e.student?.id)).filter((x): x is string => !!x));
        const met = consultRows?.ok ? new Set(consultRows.value.map((c) => c.student_id).filter((sid) => rosterIds.has(sid))).size : null;
        return teacherRuleAnalysis({
          today,
          classes: classIds.map((cid) => ({ id: cid, name: className.get(cid) ?? "반" })),
          students: enrolls.ok ? rosterIds.size : null,
          attendance: att,
          consult: met === null || !enrolls.ok ? null : { met, of: rosterIds.size },
          reports7: reportCount && reportCount.ok ? reportCount.value : null,
        });
      })(),
      aside: {
        heading: "강사 정보",
        basics: { title: "강사 기본 정보", spacer: u.display_name, link: staff?.ok && staff.value ? { href: `/staff/${id}`, label: "직원 상세 열기" } : null, facts: [
          { label: "담당 과목", value: subjectLabel || "—" },
          { label: "역할", value: role.label },
          { label: "담임 반", value: `${homeroomRows.length}개` },
          { label: "교시 담당 반", value: assist.ok ? `${assistRows.length}개` : "확인 불가" },
          ...(u.english_name ? [{ label: "영어 이름", value: u.english_name }] : []),
        ] },
      },
    },
  };
}
