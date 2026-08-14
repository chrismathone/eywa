import "server-only";
import { cache } from "react";
/**
 * 당일 출결 보드 조회 — 화면 2면이 쓰는 조립기. 적재는 `load.ts` 단일 소스.
 *
 *  · `getLiveBoard`   = 강사별 오늘 수업(교시 카드) — 강사는 본인 것만, 사무실은 전원.
 *  · `getDeskQueue`   = 데스크 확인 큐(레인 A/B) — 위 보드에서 신호만 걸러 정렬.
 *
 * 두 면이 같은 적재를 쓰므로 "강사 화면엔 12명인데 데스크엔 14명" 같은 어긋남이 생기지 않는다.
 */
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { getTeachingClasses } from "@/features/classes/server/delegation";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { fetchInChunks } from "@/lib/supabase/batch";
import { kstMinutesOfDay, kstToday } from "@/lib/date-kst";
import { hhmmToMin, shouldQueue, slotPhase, type SlotPhase } from "../signals";
import { buildQueue, type DeskQueue, type FollowupBrief, type QueueClass, type QueueStudent } from "../queue";
import { loadLiveSlots } from "./load";
import type { LiveBoard, LiveBoardSlot, LiveSlot } from "../types";

export type { LiveBoard, LiveBoardSlot };

/** 지금 KST 분(그 날짜가 오늘이 아니면 국면 판정을 하지 않는다 — 지난 날짜에 '진행 중'은 거짓말). */
function phaseOf(slot: LiveSlot, isToday: boolean): SlotPhase {
  if (!isToday) return "ended";
  const nowMin = kstMinutesOfDay();
  const start = hhmmToMin(slot.slotStart);
  if (start == null) return "before";
  return slotPhase(nowMin, start, hhmmToMin(slot.slotEnd));
}

async function loadTeacherNames(ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, { name: string; phone: string | null }>();
  const supabase = await createClient();
  const rows = await fetchInChunks<{ id: string; display_name: string | null; phone: string | null }>(
    [...ids],
    (chunk) => supabase.from("users").select("id, display_name, phone").in("id", chunk),
  );
  return new Map(rows.map((r) => [r.id, { name: r.display_name ?? "", phone: r.phone }]));
}

/**
 * 강사별 당일 출결 보드.
 * @param date  기본 오늘(KST). 과거 날짜도 열 수 있다(놓친 날 메우기).
 *
 * ⚠️ React `cache` — 데스크 면은 이 보드와 큐를 **둘 다** 그리는데(탭 배지에 두 수치가 같이 필요하다),
 *    `getDeskQueue`가 내부에서 다시 이 함수를 부른다. 감싸지 않으면 한 요청에 슬롯·수강행·출결을
 *    **두 번** 읽는다(오늘만 슬롯 100여 개 × 학생 수백). 인자가 날짜 문자열 하나라 캐시가 그대로 맞는다.
 */
export const getLiveBoard = cache(async (date: string = kstToday()): Promise<LiveBoard> => {
  const user = await getCurrentUser();
  const empty: LiveBoard = {
    date,
    isToday: date === kstToday(),
    teachers: [],
    scopedToSelf: false,
    canEdit: false,
    totals: { expected: 0, recorded: 0, slots: 0 },
  };
  if (!user) return empty;

  const level = await accessLevelTenant(user.systemRole, "attendance");
  if (level === "none") return empty;
  const supabase = await createClient();

  // 강사(scoped)는 담당 반 ∪ 그날 위임받은 반으로 좁힌다 — 판정은 기존 단일 소스(getTeachingClasses).
  // 겸직 강사뷰도 같은 헬퍼를 쓰는 effectiveTeacherId로 스코프가 따라온다.
  const scopedTeacherId = level === "scoped" ? ((await effectiveTeacherId()) ?? user.id) : null;
  let classIds: string[] | undefined;
  if (scopedTeacherId) {
    const teaching = await getTeachingClasses(supabase, scopedTeacherId, date);
    classIds = teaching.map((c) => c.id);
    if (classIds.length === 0) {
      return { ...empty, scopedToSelf: true, canEdit: level === "scoped" || level === "full" };
    }
  }

  const slots = await loadLiveSlots(date, classIds);
  const isToday = date === kstToday();
  const teacherIds = [...new Set(slots.map((s) => s.teacherId).filter((v): v is string => !!v))];
  const nameById = await loadTeacherNames(teacherIds);

  const byTeacher = new Map<string, LiveBoardSlot[]>();
  for (const slot of slots) {
    const key = slot.teacherId ?? "";
    const withPhase: LiveBoardSlot = {
      ...slot,
      teacherName: slot.teacherId ? (nameById.get(slot.teacherId)?.name ?? null) : null,
      phase: phaseOf(slot, isToday),
    };
    (byTeacher.get(key) ?? byTeacher.set(key, []).get(key)!).push(withPhase);
  }

  const teachers = [...byTeacher.entries()]
    .map(([teacherId, list]) => {
      const expected = list.reduce((n, s) => n + s.students.length, 0);
      const recorded = list.reduce((n, s) => n + s.recordedCount, 0);
      return {
        teacherId: teacherId || null,
        // ⚠️ 담당 미지정 슬롯도 화면에서 사라지면 안 된다 — 그런 반이야말로 아무도 안 찍는다.
        teacherName: teacherId ? (nameById.get(teacherId)?.name || "이름 없음") : "담당 미지정",
        teacherPhone: teacherId ? (nameById.get(teacherId)?.phone ?? null) : null,
        slots: list,
        expected,
        recorded,
      };
    })
    // 덜 찍은 강사가 위로 — 이 화면이 답해야 할 질문은 "누가 아직 안 했나"다.
    .sort((a, b) => {
      const ra = a.expected === 0 ? 1 : a.recorded / a.expected;
      const rb = b.expected === 0 ? 1 : b.recorded / b.expected;
      if (ra !== rb) return ra - rb;
      return a.teacherName.localeCompare(b.teacherName, "ko");
    });

  return {
    date,
    isToday,
    teachers,
    scopedToSelf: !!scopedTeacherId,
    canEdit: level === "full" || level === "scoped",
    totals: {
      expected: teachers.reduce((n, t) => n + t.expected, 0),
      recorded: teachers.reduce((n, t) => n + t.recorded, 0),
      slots: slots.length,
    },
  };
});

/**
 * 데스크 확인 큐 — 보드에서 **신호만** 걸러 두 레인으로.
 *
 * 🔴 유예를 넘긴 것만 올린다(`shouldQueue`) — 시작 직후를 올리면 매 교시 "지각생 전원"이 뜬다.
 *    단 `absent`(강사가 찍은 결석)는 유예와 무관하게 즉시.
 */
export async function getDeskQueue(date: string = kstToday()): Promise<DeskQueue & { date: string }> {
  const user = await getCurrentUser();
  const blank = { lanes: { classes: [], students: [] }, done: [], counts: { classes: 0, students: 0, done: 0 }, date };
  if (!user) return blank;
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "none") return blank;

  const board = await getLiveBoard(date);
  const followups = await loadFollowups(date);

  const students: QueueStudent[] = [];
  const classes: QueueClass[] = [];
  for (const teacher of board.teachers) {
    for (const slot of teacher.slots) {
      if (slot.phase === "before") continue; // 시작 전 = 안 온 게 정상
      // 레인 A는 "출석부가 안 열렸다"는 신호라 유예를 기다린다(grace 중엔 아직 열 시간이다).
      if (!slot.hasAnyRecord && (slot.phase === "due" || slot.phase === "ended")) {
        // 레인 A — 반 통째로 미체크. 학생을 개별로 쏟지 않는다(영어 91.6% 공백이 여기로 접힌다).
        classes.push({
          classId: slot.classId,
          className: slot.className,
          subject: slot.subject,
          slotStart: slot.slotStart,
          teacherId: teacher.teacherId,
          teacherName: teacher.teacherName,
          teacherPhone: teacher.teacherPhone,
          slotTeacherLabel: slot.slotTeacherLabel,
          expected: slot.students.length,
          phase: slot.phase,
        });
      }
      for (const s of slot.students) {
        if (!s.signal || s.signal === "class_unmarked") continue;
        // 🔴 `absent`는 유예를 기다리지 않는다 — 강사가 결석을 찍은 순간이 가장 확실한 신호이고,
        //    하원·셔틀 시간을 감안하면 15분을 더 흘려보낼 이유가 없다(signals.shouldQueue와 같은 규약).
        if (!shouldQueue(s.signal, slot.phase)) continue;
        students.push({
          studentId: s.studentId,
          studentName: s.studentName,
          schoolGrade: s.schoolGrade,
          classId: slot.classId,
          className: slot.className,
          slotStart: slot.slotStart,
          teacherName: teacher.teacherName,
          signal: s.signal,
          phase: slot.phase,
          note: s.note,
          parentPhone: s.parentPhone,
          studentPhone: s.studentPhone,
          // 교시별 기록이 먼저, 없으면 "그날 전체"로 남긴 조치(교시 없이 저장된 세대).
          followup: followups.get(`${s.studentId}|${slot.slotStart}`) ?? followups.get(`${s.studentId}|`) ?? null,
        });
      }
    }
  }
  return { ...buildQueue(students, classes), date };
}

/** 그날 조치 기록 — 키는 `${studentId}|${slotStart}`(교시 null 기록은 모든 교시에 붙는다). */
async function loadFollowups(date: string): Promise<Map<string, FollowupBrief>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("attendance_followups")
    .select("id, student_id, slot_start, state, outcome, note, handled_at, handler:handled_by ( display_name )")
    .eq("session_date", date);
  // 표가 아직 없거나(마이그레이션 미적용) 조회가 실패해도 **화면은 살아야 한다** — 큐는 파생이라
  // 조치 기록이 없으면 "아직 아무도 안 만졌다"로 보이는 게 맞다(#95: 옛 스키마에서도 도는 배포).
  if (error || !data) return new Map();
  const out = new Map<string, FollowupBrief>();
  for (const row of data) {
    const handler = (Array.isArray(row.handler) ? row.handler[0] : row.handler) as
      | { display_name?: string }
      | undefined;
    const brief: FollowupBrief = {
      id: row.id as string,
      state: row.state as string,
      outcome: (row.outcome as string) ?? null,
      note: (row.note as string) ?? null,
      handledByName: handler?.display_name ?? null,
      handledAt: (row.handled_at as string) ?? null,
    };
    const slot = row.slot_start ? String(row.slot_start).slice(0, 5) : null;
    out.set(`${row.student_id}|${slot ?? ""}`, brief);
    if (!slot) out.set(`${row.student_id}|`, brief);
  }
  return out;
}
