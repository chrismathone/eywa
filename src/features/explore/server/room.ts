import "server-only";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canAccessTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { logDbError } from "@/lib/supabase/db-error";
import { fetchAllPaged, fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { kstToday } from "@/lib/date-kst";
import { enrollmentPhaseOn } from "@/features/enrollments/eligibility";
import { DAY_ORDER, slotPhase, summarizeSchedule, type DayKey } from "@/features/classes/schedule-summary";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ownerFaceMenu } from "@/features/owner/face-access";
import { sheetDowLabel } from "@/features/teacher-view/i18n";
import { DEFAULT_SECTOR, SECTOR_DEFS, othersLabel, type ExploreTarget } from "../model";
import { NOT_FOUND, distinct, errorSector, forbidden, isScopedRead, makeSector, settle, type ExploreLoad } from "./shared";
import { roomRuleAnalysis } from "./rule-analysis";

type Who = { display_name: string | null } | { display_name: string | null }[] | null;
type Slot = { id: string; class_id: string; day_of_week: string; start_time: string; end_time: string; valid_from: string | null; valid_to: string | null; teacher_id: string | null; teacher: Who };
type ClassRow = { id: string; class_name: string; subject: string; teacher_id: string | null; is_active: boolean; teacher: Who };
type EnrollRow = { class_id: string; start_date: string; end_date: string | null; is_transferred: boolean | null };

// 강사 이름은 교시·반 조회에 함께 싣는다(열 이름 힌트 — 반 조회와 같은 꼴 · 조회 한 단 줄임).
const SLOT_COLS = "id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, teacher:teacher_id ( display_name )";
const whoName = (w: Who) => (Array.isArray(w) ? w[0]?.display_name : w?.display_name) ?? null;
const hm = (t: string) => String(t).slice(0, 5);
const dayIdx = (d: string) => DAY_ORDER.indexOf(d as DayKey);

/**
 * 강의실 중심(원장 2026-11-05 시안 :3978 `roomCenter`) — 이 방에 **지금 배치된** 교시와 그 반들(지난 배치 제외 [[#88]]).
 * 🔴 교시의 강의실이 비어 있으면 **반 기본 강의실**로 센다 — 수업 중심 '강의실' 조각(class.ts)과 같은 규칙(같은 사실은 두 화면에서 같게).
 * 반 이름·담임·오늘 명단은 반 상세와 같은 판정(`enrollmentPhaseOn` — 시작 전 수강은 오늘 수에 안 섞는다).
 * 🔴 담당 반만 보는 계정(수업 '담당')은 열지 않는다 — 한 방의 모든 반을 늘어놓는 화면이라 담당 밖 반이 보인다.
 */
export async function loadRoomCenter(id: string): Promise<ExploreLoad> {
  const user = await getCurrentUser();
  if (!user) return forbidden("로그인이 필요합니다.");
  // 주소의 id가 uuid 모양이 아니면 없는 강의실(다른 중심과 같은 404 — DB 형식 오류로 오류 화면이 뜨지 않게).
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return NOT_FOUND;
  if (await isScopedRead(user.systemRole, "classes")) return forbidden("강의실은 모든 수업을 볼 수 있는 계정만 열람할 수 있어요.");
  const supabase = await createClient();
  const today = kstToday();
  const live = `valid_to.is.null,valid_to.gte.${today}`;
  const [roomRes, slotsRes, defaultRes, settings, canTimetable, canOwner] = await Promise.all([
    supabase.from("classrooms").select("id, name, capacity, archived_at").eq("id", id).maybeSingle(),
    settle("explore.room.slots", fetchAllPaged<Slot>((from, to) => supabase.from("class_schedules").select(SLOT_COLS).eq("classroom_id", id).or(live).order("id").range(from, to))),
    // 반 기본 강의실이 이 방인 반 — 강의실이 비어 있는 교시를 이 방으로 센다.
    settle("explore.room.defaultClasses", fetchAllPaged<{ id: string }>((from, to) => supabase.from("classes").select("id").eq("classroom_id", id).eq("is_active", true).order("id").range(from, to))),
    getTenantSettings(),
    canAccessTenant(user.systemRole, "timetable"),
    canAccessTenant(user.systemRole, ownerFaceMenu("operations")),
  ]);
  if (roomRes.error) {
    logDbError(roomRes.error, "explore.room.room");
    return forbidden("강의실을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.");
  }
  const room = roomRes.data as { id: string; name: string; capacity: number | null; archived_at: string | null } | null;
  if (!room) return NOT_FOUND;

  const defaultIds = defaultRes.ok ? defaultRes.value.map((c) => c.id) : [];
  const classIds = distinct([...(slotsRes.ok ? slotsRes.value.map((s) => s.class_id) : []), ...defaultIds]);
  const [fallbackRes, classRes, enrollRes] = await Promise.all([
    settle("explore.room.fallbackSlots", fetchAllPagedInChunks<Slot>(defaultIds, (chunk, from, to) =>
      supabase.from("class_schedules").select(SLOT_COLS).in("class_id", chunk).is("classroom_id", null).or(live).order("id").range(from, to))),
    settle("explore.room.classes", fetchInChunks<ClassRow>(classIds, (chunk) => supabase.from("classes").select("id, class_name, subject, teacher_id, is_active, teacher:teacher_id ( display_name )").in("id", chunk))),
    settle("explore.room.enrollments", fetchAllPagedInChunks<EnrollRow>(classIds, (chunk, from, to) =>
      supabase.from("enrollments").select("class_id, start_date, end_date, is_transferred").in("class_id", chunk).or(`end_date.is.null,end_date.gte.${today}`).order("id").range(from, to))),
  ]);
  const failed = !slotsRes.ok || !defaultRes.ok || !fallbackRes.ok || !classRes.ok;
  const classes = new Map((classRes.ok ? classRes.value : []).filter((c) => c.is_active).map((c) => [c.id, c]));
  const allSlots = [...(slotsRes.ok ? slotsRes.value : []), ...(fallbackRes.ok ? fallbackRes.value : [])];
  // 지금 도는 배치만(시작 전 = 예정으로 따로) · 폐지된 반의 배치는 뺀다.
  const liveSlots = allSlots.filter((s) => classes.has(s.class_id));
  const current = liveSlots.filter((s) => slotPhase({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, validFrom: s.valid_from, validTo: s.valid_to }, today) === "current");
  const upcoming = liveSlots.length - current.length;
  // 안내 줄의 수 = 조각에 실제로 선 줄(지금 배치) 중 반 기본 강의실로 센 것.
  const fallbackIds = new Set((fallbackRes.ok ? fallbackRes.value : []).map((s) => s.id));
  const fallbackCount = current.filter((s) => fallbackIds.has(s.id)).length;
  const teacherName = new Map<string, string>();
  for (const c of classes.values()) if (c.teacher_id) teacherName.set(c.teacher_id, whoName(c.teacher) ?? "이름 확인 필요");
  for (const s of allSlots) if (s.teacher_id) teacherName.set(s.teacher_id, whoName(s.teacher) ?? "이름 확인 필요");
  const teacherIds = distinct([...current.map((s) => s.teacher_id ?? classes.get(s.class_id)?.teacher_id ?? null)]);
  const subjects = buildSubjectMaps(settings.operations.subjects);

  const roster = new Map<string, number>();
  for (const e of enrollRes.ok ? enrollRes.value : []) {
    const phase = enrollmentPhaseOn({ startDate: String(e.start_date), endDate: e.end_date ?? null, isTransferred: e.is_transferred ?? false }, today);
    if (phase === "active" || phase === "leaving") roster.set(e.class_id, (roster.get(e.class_id) ?? 0) + 1);
  }
  const usedClassIds = distinct(current.map((s) => s.class_id)).sort((a, b) => (classes.get(a)?.class_name ?? "").localeCompare(classes.get(b)?.class_name ?? "", "ko"));
  const slotsOf = (cid: string) => current.filter((s) => s.class_id === cid).sort((a, b) => dayIdx(a.day_of_week) - dayIdx(b.day_of_week) || hm(a.start_time).localeCompare(hm(b.start_time)));
  // 주 N회 = 반마다 `summarizeSchedule().sessions`(이어진 교시는 한 번 — 수업·강사 중심과 같은 셈) · 반을 더한다.
  const sessionsOf = (cid: string) => summarizeSchedule(slotsOf(cid).map((s) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time, validFrom: s.valid_from, validTo: s.valid_to })), today).sessions;
  const weekly = usedClassIds.reduce((n, cid) => n + sessionsOf(cid), 0);
  const slotText = (s: Slot) => `${sheetDowLabel(s.day_of_week, "ko")} ${hm(s.start_time)}~${hm(s.end_time)}`;
  const [dClasses, dTeachers, dTimetable, dInfo] = SECTOR_DEFS.room;

  const classTargets: ExploreTarget[] = usedClassIds.map((cid) => {
    const c = classes.get(cid)!;
    const days = [...new Set(slotsOf(cid).map((s) => sheetDowLabel(s.day_of_week, "ko")))].join("·");
    return {
      kind: "class", id: cid, label: c.class_name, detail: subjects.labelOf(c.subject), meta: c.teacher_id ? `담임 ${teacherName.get(c.teacher_id) ?? "이름 확인 필요"}` : null,
      facts: [days ? `${days} · 주 ${sessionsOf(cid)}회` : null, enrollRes.ok ? `원생 ${roster.get(cid) ?? 0}명` : null].filter((x): x is string => !!x),
    };
  });
  const teacherTargets: ExploreTarget[] = teacherIds.map((tid) => {
    const mine = distinct(current.filter((s) => (s.teacher_id ?? classes.get(s.class_id)?.teacher_id) === tid).map((s) => classes.get(s.class_id)?.class_name ?? null));
    return { kind: "teacher", id: tid, label: teacherName.get(tid) ?? "이름 확인 필요", meta: othersLabel(mine, "개") || null };
  });
  const timetableRows = [...current]
    .sort((a, b) => dayIdx(a.day_of_week) - dayIdx(b.day_of_week) || hm(a.start_time).localeCompare(hm(b.start_time)))
    .map((s) => ({ id: s.id, title: slotText(s), detail: classes.get(s.class_id)?.class_name ?? null, right: teacherName.get(s.teacher_id ?? classes.get(s.class_id)?.teacher_id ?? "") ?? null }));

  const sectors = [
    failed ? errorSector(dClasses) : makeSector(dClasses, {
      summary: classTargets.length > 0 ? `${classTargets.length}개` : "배치된 수업 없음",
      state: classTargets.length > 0 ? "ready" : "empty",
      targets: classTargets,
      links: [{ href: "/classes", label: "수업목록 열기" }],
      note: upcoming > 0 ? `시작 전 배치 ${upcoming}칸은 세지 않았습니다.` : null,
    }),
    failed ? errorSector(dTeachers) : makeSector(dTeachers, {
      summary: teacherTargets.length > 0 ? othersLabel(teacherTargets.map((t) => t.label), "명") : "강사 없음",
      state: teacherTargets.length > 0 ? "ready" : "empty",
      targets: teacherTargets,
    }),
    failed ? errorSector(dTimetable) : makeSector(dTimetable, {
      summary: current.length > 0 ? `주 ${weekly}회` : "배치 없음",
      state: current.length > 0 ? "ready" : "empty",
      rows: timetableRows,
      links: canTimetable ? [{ href: "/timetable", label: "시간표 열기" }] : [],
      note: fallbackCount > 0 ? `교시에 강의실이 비어 반 기본 강의실로 센 배치 ${fallbackCount}칸 포함` : null,
    }),
    makeSector(dInfo, {
      summary: room.capacity ? `${room.capacity}석` : "정원 미입력",
      state: "ready",
      rows: [
        { id: "name", title: room.name, detail: "이름" },
        { id: "capacity", title: room.capacity ? `${room.capacity}석` : "정원 미입력", detail: "정원" },
        ...(room.archived_at ? [{ id: "archived", title: "보관됨", detail: "새 배치 후보에서 빠진 강의실" }] : []),
      ],
      links: canOwner ? [{ href: "/owner?tab=operations", label: "강의실 관리 열기" }] : [],
    }),
  ];

  return {
    state: "ready",
    model: {
      center: {
        kind: "room", id, name: room.name, subtitle: room.capacity ? `정원 ${room.capacity}석` : null,
        status: room.archived_at ? { label: "보관됨", color: "neutral" } : current.length > 0 ? { label: "사용 중", color: "green" } : { label: "배치 없음", color: "amber" },
        icon: "doorOpen", detailHref: canOwner ? "/owner?tab=operations" : null, detailLabel: "강의실 관리 열기",
      },
      sectors,
      defaultSector: DEFAULT_SECTOR.room,
      asOf: today,
      analysis: failed
        ? { state: "error", blocks: [], canRefresh: false, note: "배치·수업을 조회하지 못해 판정할 수 없습니다." }
        : roomRuleAnalysis({
            today,
            capacity: room.capacity,
            weekly,
            slots: current.map((s) => ({ day: s.day_of_week, start: hm(s.start_time), end: hm(s.end_time), className: classes.get(s.class_id)?.class_name ?? "반" })),
            classes: usedClassIds.map((cid) => ({ name: classes.get(cid)?.class_name ?? "반", roster: enrollRes.ok ? (roster.get(cid) ?? 0) : null })),
          }),
      aside: {
        heading: "강의실 정보",
        basics: {
          title: "강의실 기본 정보",
          spacer: room.name,
          link: canOwner ? { href: "/owner?tab=operations", label: "강의실 관리 열기" } : null,
          facts: [
            { label: "정원", value: room.capacity ? `${room.capacity}석` : "미입력" },
            { label: "수업", value: `${usedClassIds.length}개` },
            { label: "주간 사용", value: `${weekly}회` },
            ...(room.archived_at ? [{ label: "상태", value: "보관됨" }] : []),
          ],
        },
      },
    },
  };
}
