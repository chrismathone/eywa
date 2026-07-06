"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIjwFirestore } from "@/lib/ijw/firestore";

/**
 * Eywa 2.0 → 구 Eywa(ijw-calander) 【수학 시간표】 동기화 (연동 면 버튼).
 *
 * 방향: Eywa 2.0 Supabase(자기 DB, service_role로 RLS 우회 읽기) → 구 Eywa Firestore(restore20260319, Admin 쓰기).
 * 범위: 순수 수학(classes.subject='math')의 반 구조 + 활성 수강명단 파리티.
 *   - 반: className(trim 매칭)으로 schedule/teacher/room/subject 갱신.
 *   - 명단: 추가(eywa 활성인데 ijw에 없음) + 종료(ijw 활성인데 eywa에 없음 → endDate). 반이동은 추가+종료로 자연 반영.
 *   - 학생 매칭: student_code ↔ ijw studentCode → (이름+학교+학년) 복합키 → 이름.
 * 안전: 종료는 **실제 활성 문서 ref**에 endDate만(soft) — 문서 삭제/유령 없음. 추가는 auto-id 문서 + classId 필드.
 *   (과거 퇴원이력 강제일치·중복정리는 1회성 작업이라 이 버튼엔 없음 — 활성 파리티만 반복 유지.)
 * 게이트: integrations 쓰기 권한(canWriteTenant).
 */

const DAY_MAP: Record<string, string> = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일" };
const WEEKEND = new Set(["토", "일"]);
// ijw 교시 시간표 startTime → periodId (평일 수학 55분 / 주말 시간별). components/Timetable/constants.ts와 동일.
const MATH_PERIODS: Record<string, string> = { "14:30": "1", "15:25": "2", "16:20": "3", "17:15": "4", "18:20": "5", "19:15": "6", "20:10": "7", "21:05": "8" };
const WEEKEND_PERIODS: Record<string, string> = { "09:00": "1", "10:00": "2", "11:00": "3", "12:00": "4", "13:00": "5", "14:00": "6", "15:00": "7", "16:00": "8" };

const hhmm = (t: string | null | undefined) => (t ?? "").slice(0, 5);
const norm = (s: unknown) => String(s ?? "").trim().replace(/\s+/g, "");
const normCls = (s: unknown) => String(s ?? "").trim();
const isEnded = (e: Record<string, unknown>) => Boolean(e.endDate || e.withdrawalDate || e.cancelledAt);
function toPeriodId(dayKo: string, start: string | null | undefined): string | null {
  const t = hhmm(start);
  return WEEKEND.has(dayKo) ? (WEEKEND_PERIODS[t] ?? null) : (MATH_PERIODS[t] ?? null);
}

async function fetchAllEywa<T = Record<string, unknown>>(
  sb: ReturnType<typeof createAdminClient>,
  table: string,
  columns: string,
): Promise<T[]> {
  const PAGE = 1000;
  let from = 0;
  let out: T[] = [];
  for (;;) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`eywa ${table} 조회 실패: ${error.message}`);
    const rows = (data ?? []) as T[];
    out = out.concat(rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export type IjwSyncSummary = {
  eywaMathClasses: number;
  eywaActiveEnrollments: number;
  classUpdate: number;
  classMissingInIjw: number;
  enrollCreate: number;
  enrollEnd: number;
  studentUnresolved: number;
};
export type IjwSyncResult = { error?: string; ok?: boolean; mode?: "dry-run" | "commit"; summary?: IjwSyncSummary };

export async function syncIjwMathTimetable(mode: "dry-run" | "commit"): Promise<IjwSyncResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "integrations"))) {
    return { error: "구 Eywa 동기화 권한이 없습니다 — 학원 설정 › 역할·권한의 '연동'에서 조정할 수 있습니다" };
  }

  try {
    const sb = createAdminClient();
    const [eClassesAll, eRooms, eUsers, eSched, eStudents, eEnrollAll] = await Promise.all([
      fetchAllEywa(sb, "classes", "id,class_name,subject,teacher_id,classroom_id,is_active"),
      fetchAllEywa(sb, "classrooms", "id,name"),
      fetchAllEywa(sb, "users", "id,display_name"),
      fetchAllEywa(sb, "class_schedules", "id,class_id,day_of_week,start_time,slot_teacher_label,slot_room_label,valid_to"),
      fetchAllEywa(sb, "students", "id,name,student_code,school,grade"),
      fetchAllEywa(sb, "enrollments", "id,student_id,class_id,start_date,end_date,on_hold,attendance_days"),
    ]);

    const roomById = new Map(eRooms.map((r) => [r.id as string, r.name as string]));
    const userById = new Map(eUsers.map((u) => [u.id as string, u.display_name as string]));
    const eStuById = new Map(eStudents.map((s) => [s.id as string, s]));
    const mathClasses = eClassesAll.filter((c) => c.subject === "math");
    const mathClassIds = new Set(mathClasses.map((c) => c.id as string));

    const schedByClass = new Map<string, Record<string, unknown>[]>();
    for (const s of eSched) {
      if (s.valid_to || !mathClassIds.has(s.class_id as string)) continue;
      const arr = schedByClass.get(s.class_id as string) ?? [];
      arr.push(s);
      schedByClass.set(s.class_id as string, arr);
    }

    // eywa 수학반 → ijw 형식
    type Built = { eywaId: string; className: string; subject: string; teacher: string; room: string; legacySchedule: string[]; schedule: { day: string; periodId: string }[]; slotTeachers: Record<string, string>; slotRooms: Record<string, string>; isActive: boolean };
    const built: Built[] = mathClasses.map((c) => {
      const legacySchedule: string[] = [];
      const schedule: { day: string; periodId: string }[] = [];
      const slotTeachers: Record<string, string> = {};
      const slotRooms: Record<string, string> = {};
      for (const s of schedByClass.get(c.id as string) ?? []) {
        const day = DAY_MAP[s.day_of_week as string] ?? (s.day_of_week as string);
        const p = toPeriodId(day, s.start_time as string);
        if (!p) continue;
        const key = `${day} ${p}`;
        if (!legacySchedule.includes(key)) {
          legacySchedule.push(key);
          schedule.push({ day, periodId: p });
        }
        if (s.slot_teacher_label) slotTeachers[`${day}-${p}`] = s.slot_teacher_label as string;
        if (s.slot_room_label) slotRooms[`${day}-${p}`] = s.slot_room_label as string;
      }
      return {
        eywaId: c.id as string,
        className: c.class_name as string,
        subject: "math",
        teacher: c.teacher_id ? (userById.get(c.teacher_id as string) ?? "") : "",
        room: c.classroom_id ? (roomById.get(c.classroom_id as string) ?? "") : "",
        legacySchedule,
        schedule,
        slotTeachers,
        slotRooms,
        isActive: c.is_active !== false,
      };
    });

    // ijw Firestore 현재
    const db = getIjwFirestore();
    const [clsSnap, stuSnap, enrSnap] = await Promise.all([
      db.collection("classes").get(),
      db.collection("students").get(),
      db.collectionGroup("enrollments").get(),
    ]);
    const ijwClassByName = new Map<string, { id: string; data: Record<string, unknown> }>();
    clsSnap.forEach((d) => {
      const n = normCls((d.data() as Record<string, unknown>).className);
      if (n && !ijwClassByName.has(n)) ijwClassByName.set(n, { id: d.id, data: d.data() as Record<string, unknown> });
    });
    const byCode = new Map<string, string>();
    const byComp = new Map<string, string[]>();
    const byName = new Map<string, string[]>();
    stuSnap.forEach((d) => {
      const s = d.data() as Record<string, unknown>;
      if (s.studentCode != null) byCode.set(String(s.studentCode), d.id);
      const n = norm(s.name);
      if (!n) return;
      const comp = `${n}|${norm(s.school)}|${norm(s.grade)}`;
      (byComp.get(comp) ?? byComp.set(comp, []).get(comp)!).push(d.id);
      (byName.get(n) ?? byName.set(n, []).get(n)!).push(d.id);
    });
    const matchStudentId = (es: Record<string, unknown>): string | null => {
      if (es.student_code != null && byCode.has(String(es.student_code))) return byCode.get(String(es.student_code))!;
      const comp = byComp.get(`${norm(es.name)}|${norm(es.school)}|${norm(es.grade)}`) ?? [];
      if (comp.length === 1) return comp[0];
      const nm = byName.get(norm(es.name)) ?? [];
      return nm.length === 1 ? nm[0] : null;
    };

    // ── 반 구조 diff ──
    const eToIjw = new Map<string, { ijwClassId: string; className: string }>();
    let classMissingInIjw = 0;
    type ClassWrite = { ijwClassId: string; data: Record<string, unknown> };
    const classWrites: ClassWrite[] = [];
    const sortedEq = (a: unknown[], b: unknown[]) => JSON.stringify([...(a ?? [])].map(String).sort()) === JSON.stringify([...(b ?? [])].map(String).sort());
    for (const b of built) {
      const ijw = ijwClassByName.get(normCls(b.className));
      if (!ijw) { classMissingInIjw++; continue; }
      eToIjw.set(b.eywaId, { ijwClassId: ijw.id, className: ijw.data.className as string });
      const cur = ijw.data;
      const changed =
        (b.teacher && cur.teacher !== b.teacher) ||
        (b.room && cur.room !== b.room) ||
        cur.subject !== "math" ||
        !sortedEq(cur.legacySchedule as unknown[], b.legacySchedule);
      if (changed) {
        const data: Record<string, unknown> = {
          subject: "math",
          teacher: b.teacher,
          schedule: b.schedule,
          legacySchedule: b.legacySchedule,
          isActive: true,
          updatedAt: new Date().toISOString(),
        };
        if (b.room) data.room = b.room;
        if (Object.keys(b.slotTeachers).length) data.slotTeachers = b.slotTeachers;
        if (Object.keys(b.slotRooms).length) data.slotRooms = b.slotRooms;
        classWrites.push({ ijwClassId: ijw.id, data });
      }
    }

    // ── ijw 활성 수학 배정 인덱스 (실제 doc ref 보존) ──
    const ijwActive = new Set<string>();
    const ijwActiveDocs: { key: string; ref: FirebaseFirestore.DocumentReference }[] = [];
    enrSnap.forEach((d) => {
      const e = d.data() as Record<string, unknown>;
      if (e.subject !== "math" || isEnded(e)) return;
      const cn = normCls(e.className);
      if (!cn) return;
      const sid = d.ref.parent.parent?.id;
      if (!sid) return;
      const key = `${sid}::${cn}`;
      ijwActive.add(key);
      ijwActiveDocs.push({ key, ref: d.ref as unknown as FirebaseFirestore.DocumentReference });
    });

    // ── 명단 파리티 계획 ──
    type CreatePlan = { sid: string; classId: string; className: string; teacher: string; schedule: string[]; startDate: string | null; onHold: boolean; attendanceDays: string[] };
    const creates: CreatePlan[] = [];
    const targetKeys = new Set<string>();
    let studentUnresolved = 0;
    const legacyByClassName = new Map(built.map((b) => [normCls(b.className), b.legacySchedule]));
    for (const e of eEnrollAll) {
      if (e.end_date) continue;
      const cm = eToIjw.get(e.class_id as string);
      const es = eStuById.get(e.student_id as string);
      if (!cm || !es) continue;
      const sid = matchStudentId(es);
      if (!sid) { studentUnresolved++; continue; }
      const key = `${sid}::${normCls(cm.className)}`;
      targetKeys.add(key);
      if (ijwActive.has(key)) continue; // 이미 배정됨
      creates.push({
        sid,
        classId: cm.ijwClassId,
        className: cm.className,
        teacher: (ijwClassByName.get(normCls(cm.className))?.data.teacher as string) ?? "",
        schedule: legacyByClassName.get(normCls(cm.className)) ?? [],
        startDate: (e.start_date as string) ?? null,
        onHold: Boolean(e.on_hold),
        attendanceDays: (e.attendance_days as string[]) ?? [],
      });
    }
    const ends = ijwActiveDocs.filter((x) => !targetKeys.has(x.key));

    const summary: IjwSyncSummary = {
      eywaMathClasses: mathClasses.length,
      eywaActiveEnrollments: eEnrollAll.filter((e) => !e.end_date && mathClassIds.has(e.class_id as string)).length,
      classUpdate: classWrites.length,
      classMissingInIjw,
      enrollCreate: creates.length,
      enrollEnd: ends.length,
      studentUnresolved,
    };

    if (mode === "dry-run") return { ok: true, mode, summary };

    // ── 반영 (Firestore 배치, 500개 제한 → 400마다 커밋) ──
    const NOW = new Date().toISOString();
    const TODAY = NOW.slice(0, 10);
    let batch = db.batch();
    let pending = 0;
    const commits: Promise<unknown>[] = [];
    const bump = () => {
      if (++pending >= 400) { commits.push(batch.commit()); batch = db.batch(); pending = 0; }
    };
    for (const w of classWrites) {
      batch.set(db.collection("classes").doc(w.ijwClassId), w.data, { merge: true });
      bump();
    }
    for (const c of creates) {
      const ref = db.collection("students").doc(c.sid).collection("enrollments").doc();
      batch.set(ref, {
        className: c.className, classId: c.classId, staffId: c.teacher, teacher: c.teacher, subject: "math",
        schedule: c.schedule, startDate: c.startDate ?? TODAY, enrollmentDate: c.startDate ?? TODAY,
        onHold: c.onHold, attendanceDays: c.attendanceDays, createdAt: NOW, createdBy: "eywa-ijw-sync",
      });
      bump();
    }
    for (const x of ends) {
      batch.update(x.ref, { endDate: TODAY, updatedAt: NOW, lastAction: "eywa-ijw-sync-end" });
      bump();
    }
    if (pending > 0) commits.push(batch.commit());
    await Promise.all(commits);

    revalidatePath("/owner");
    return { ok: true, mode, summary };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "ijw 동기화 중 오류" };
  }
}
