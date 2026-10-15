import "server-only";
import { logAction } from "@/features/audit/server/log";
import { normalizeClassName, reservedClassNameReason } from "@/features/classes/class-name";
import { enrollmentAssignBlockReason } from "@/features/enrollments/eligibility";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { specialSlotLabel } from "@/features/timetable/lib/teacher-label";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { canManageStudentStatusNow } from "@/features/students/server/status-access";
import { STUDENT_STATUS_DENIED } from "@/features/students/status-access";
import { createClient } from "@/lib/supabase/server";
import { IMPORT_META } from "../kinds";
import type { RowReader } from "../rows";
import { colLetter, splitList, parseWeekday, type ColumnSpec, type ImportPreviewRow, type SheetSpec } from "../spec";
import { ClassIndex, StaffIndex, StudentIndex } from "../server/lookups";
import type { ImporterDef, ImportCtx } from "../server/types";
import {
  DOW_LABEL,
  addDays,
  detectSlotConflicts,
  dowKeyOf,
  isLiveOn,
  normalizeDays,
  periodsOverlap,
  planScheduleReplace,
  sameSchedule,
  slotKey,
  type DowKey,
  type SlotShape,
  type TargetSlot,
} from "./classes-plan";

/**
 * 반 가져오기 — 체크리스트 5·6·7번(반 목록 · 정기 시간표 · 원생별 반 배정)을 한 파일 세 시트로.
 * 반영 순서 = 반 → 시간표 → 반배정(같은 파일 '반' 시트에 적은 새 반을 뒤 시트가 가리킬 수 있다).
 *
 * 🔑 반 매칭 = 반 이름 + 과목(DB 유일 키 — 폐지된 반도 이름을 붙든다, [[#120]]).
 * 🔴 **폐지·종강은 파일로 하지 않는다** — 그 반 활성 수강을 함께 닫아야 해서(archiveClass·endClassTerm) 반 상세에서만.
 *    새 반은 '운영 아니오'·종강일을 적어 만들 수 있다(아직 수강이 없으니 닫을 것도 없다 — 과거 반 이관용).
 * 🔴 시간표는 **행을 고쳐 쓰지 않는다**([[#88]]) — 적용 시작일 전날로 옛 구간을 닫고 새 구간을 넣는다(옛 배치는 이력).
 *    적용 시작일은 오늘~180일(과거 금지 — 이미 찍힌 출결의 앵커를 옮기지 않게, [[#126]]).
 *    파일의 시간표가 지금과 **같으면 아무것도 안 쓴다**(같은 서식을 다시 올려도 이력이 쪼개지지 않게).
 *    합반(merge_group)·따로 수업(*LAB) 표식은 같은 요일·시작 시각의 옛 행에서 이어받는다.
 * 🔴 반배정은 한 명 배정과 같은 규칙: 재원·휴원 원생만(휴원이면 수강도 휴원으로 — 승계), 같은 반 기간 겹침 금지(GiST).
 *    이미 끝난 수강(종료일이 오늘 이전)은 과거 이력 이관이라 상태를 묻지 않는다. 담임 알림은 보내지 않는다(대량이라).
 */
type ClassKey = "className" | "subject" | "teacher" | "classroom" | "active" | "special" | "kind" | "status" | "closedAt" | "notes";
type SlotKey = "className" | "subject" | "day" | "start" | "end" | "period" | "teacher" | "classroom" | "validFrom";
type EnrollKey = "code" | "student" | "school" | "grade" | "className" | "subject" | "startDate" | "endDate" | "days" | "onHold";

const CLASS_SHEET = "반";
const SLOT_SHEET = "시간표";
const ENROLL_SHEET = "반배정";
const MAX_AHEAD_DAYS = 180;

function specs(subjectLabels: readonly string[]) {
  const classCols: ColumnSpec<ClassKey>[] = [
    { key: "className", header: "반이름", width: 18, required: true, aliases: ["반명", "반", "수업명"] },
    { key: "subject", header: "과목", width: 8, required: true, options: subjectLabels, strictOptions: true, hint: "학원 설정의 과목 이름" },
    { key: "teacher", header: "담당강사", width: 12, aliases: ["담임", "강사"], hint: "직원관리의 이름(또는 로그인 이메일)" },
    { key: "classroom", header: "강의실", width: 10 },
    { key: "active", header: "운영", width: 6, options: ["예", "아니오"], hint: "비우면 예. 기존 반의 폐지는 반 상세에서(수강 종료가 함께 움직여야 해서)." },
    { key: "special", header: "특강", width: 6, options: ["예", "아니오"] },
    { key: "closedAt", header: "종강일", width: 12, hint: "새 반에만 씁니다(기존 반의 종강은 반 상세에서)." },
    { key: "notes", header: "메모", width: 24 },
    // ↓ **엑셀 내보내기**(수업목록) 파일의 열 — 서식엔 안 싣지만 그 파일을 고쳐 올리면 알아본다(원장 2026-09-29 *"전부다 맞추기도 맞출것"*).
    //    요일·학생 수는 읽기 전용 표시라 무시한다(시간표는 '시간표' 시트로).
    { key: "kind", header: "구분", exportOnly: true, hint: "내보내기 파일의 정규/특강 — 새 반의 특강 여부로만 씁니다." },
    { key: "status", header: "상태", exportOnly: true, hint: "내보내기 파일의 운영/종강/폐지 — '운영' 열과 같은 뜻(폐지 = 운영 아니오)." },
  ];
  const slotCols: ColumnSpec<SlotKey>[] = [
    { key: "className", header: "반이름", width: 18, required: true, aliases: ["반명", "반"] },
    { key: "subject", header: "과목", width: 8, options: subjectLabels, hint: "이름이 같은 반이 과목별로 있을 때만" },
    { key: "day", header: "요일", width: 6, required: true, options: ["월", "화", "수", "목", "금", "토", "일"], strictOptions: true },
    { key: "start", header: "시작", width: 7, required: true, aliases: ["시작시각", "시작시간"], hint: "16:20" },
    { key: "end", header: "종료", width: 7, required: true, aliases: ["종료시각", "종료시간"], hint: "17:20" },
    { key: "period", header: "교시", width: 7, hint: "표시용(예: 3교시). 시각이 진짜 기준입니다." },
    { key: "teacher", header: "강사", width: 10, hint: "이 교시만 다른 강사일 때. 비우면 반 담당강사. LAB·JJ(자리)도 됩니다." },
    { key: "classroom", header: "강의실", width: 10, hint: "이 교시만 다른 강의실일 때. 비우면 반 강의실." },
    { key: "validFrom", header: "적용시작일", width: 12, aliases: ["적용일"], hint: "비우면 내일. 내일~180일 뒤(오늘은 안 됩니다 — 오늘 찍힌 출결이 엉킵니다). 한 반의 줄은 같은 날이어야 합니다." },
  ];
  const enrollCols: ColumnSpec<EnrollKey>[] = [
    { key: "code", header: "원생번호", width: 10 },
    { key: "student", header: "원생이름", width: 10, required: true, aliases: ["이름", "원생", "학생", "학생명"] },
    { key: "school", header: "학교", width: 12 },
    { key: "grade", header: "학년", width: 6 },
    { key: "className", header: "반이름", width: 18, required: true, aliases: ["반명", "반"] },
    { key: "subject", header: "과목", width: 8, options: subjectLabels },
    { key: "startDate", header: "수강시작일", width: 12, required: true, aliases: ["시작일"] },
    { key: "endDate", header: "수강종료일", width: 12, aliases: ["종료일"] },
    { key: "days", header: "등원요일", width: 10, hint: "일부 요일만 올 때 '월,수'. 비우면 반의 모든 요일." },
    { key: "onHold", header: "휴원", width: 6, options: ["예", "아니오"] },
  ];
  return {
    classSpec: { name: CLASS_SHEET, columns: classCols, keyHint: "반이름 + 과목", optional: true, aliases: ["수업목록"] } satisfies SheetSpec<ClassKey>,
    slotSpec: { name: SLOT_SHEET, columns: slotCols, keyHint: "반 + 요일 + 시작", optional: true } satisfies SheetSpec<SlotKey>,
    enrollSpec: { name: ENROLL_SHEET, columns: enrollCols, keyHint: "원생 + 반 + 수강시작일", optional: true } satisfies SheetSpec<EnrollKey>,
  };
}

// ── 계획 ─────────────────────────────────────────────────────────────────────────
/** 반 참조 — 이미 있는 반(id) 또는 이 파일이 만드는 반(ref). */
type ClassRef = { id: string } | { ref: string };
type NewClass = {
  ref: string; rowNum: number; className: string; subject: string; teacherId: string | null; classroomId: string | null;
  isActive: boolean; isSpecial: boolean; closedAt: string | null; notes: string | null;
};
type ClassUpdate = {
  id: string; className: string; patch: Record<string, unknown>;
  /** 감사로그용 — 이름은 **바뀌는 시점에** 박아 둔다(반 수정과 같은 규약). */
  teacherChange: { from: string | null; to: string | null; fromName: string | null; toName: string | null } | null;
  roomChange: { fromName: string | null; toName: string | null } | null;
};
type SlotInsert = {
  day: DowKey; start: string; end: string; teacherId: string | null; classroomId: string | null;
  teacherLabel: string | null; roomLabel: string | null; periodLabel: string | null; mergeGroup: string | null; labSeparate: boolean | null;
};
type ScheduleOp = { cls: ClassRef; className: string; validFrom: string; replace: { close: string[]; remove: string[] } | null; inserts: SlotInsert[] };
type EnrollInsert = { cls: ClassRef; studentId: string; startDate: string; endDate: string | null; days: DowKey[]; onHold: boolean };
type EnrollUpdate = { id: string; patch: Record<string, unknown> };
type Plan = { newClasses: NewClass[]; classUpdates: ClassUpdate[]; schedules: ScheduleOp[]; enrollInserts: EnrollInsert[]; enrollUpdates: EnrollUpdate[] };

type SlotRow = {
  id: string; class_id: string; day_of_week: string; start_time: string; end_time: string; valid_from: string; valid_to: string | null;
  teacher_id: string | null; classroom_id: string | null; slot_teacher_label: string | null; slot_room_label: string | null;
  period_label: string | null; merge_group: string | null; lab_separate?: boolean | null;
};
type EnrollRow = { id: string; student_id: string; class_id: string; start_date: string; end_date: string | null; attendance_days: string[] | null; on_hold: boolean };
type RoomRow = { id: string; name: string; archived_at?: string | null };

const hhmm = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");
const squash = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/\s+/g, "");

/**
 * 이름+과목이 같은 반이 여럿이면(종강한 반 + 지금 운영 중인 반) **운영 중인 반**을 고른다(적대 리뷰 2026-09-29) —
 * 목록 순서가 고르게 두면 종강 반의 담당이 바뀌고 운영 반은 그대로다. 운영 중 → 종강 → 폐지 순.
 */
function pickClass<T extends { class_name: string; subject: string | null; is_active: boolean; closed_at: string | null }>(rows: readonly T[], name: string, subject: string): T | undefined {
  const rank = (c: T) => (c.is_active && !c.closed_at ? 0 : c.is_active ? 1 : 2);
  return rows.filter((c) => squash(c.class_name) === squash(name) && c.subject === subject).sort((a, b) => rank(a) - rank(b))[0];
}

async function loadAll(db: Awaited<ReturnType<typeof createClient>>, tenantId: string, today: string) {
  const [classes, staff, rooms, slots] = await Promise.all([
    ClassIndex.load(db, tenantId),
    StaffIndex.load(db, tenantId),
    fetchAllPaged<RoomRow>((from, to) => db.from("classrooms").select("*").eq("tenant_id", tenantId).order("id").range(from, to)),
    // 지금·앞으로 유효한 배치(만료 이력은 건드리지도 비교하지도 않는다 — [[#88]]).
    fetchAllPaged<SlotRow>((from, to) =>
      db.from("class_schedules").select("*").eq("tenant_id", tenantId).or(`valid_to.is.null,valid_to.gte.${today}`).order("id").range(from, to),
    ),
  ]);
  return { classes, staff, rooms, slots };
}

const def: ImporterDef<Plan> = {
  kind: "classes",
  title: IMPORT_META.classes.title,
  menu: "classes",
  sheets: Object.values(specs([])),
  singleSheet: false,
  modeHelp: IMPORT_META.classes.modeHelp,
  guide: [
    "· 시트 세 장: '반'(반 목록) · '시간표'(요일·시각) · '반배정'(원생이 어느 반에). 필요한 시트만 채워도 됩니다.",
    "· 수업목록의 '엑셀 내보내기'로 받은 파일을 고쳐 올려도 됩니다 — 그 파일의 시트는 '반'으로 읽고, 상태(운영/종강/폐지)·구분(정규/특강)도 알아봅니다. 요일·학생 수 열은 읽지 않습니다(시간표는 '시간표' 시트로).",
    "· 순서대로 들어갑니다: 반 → 시간표 → 반배정. 같은 파일 '반' 시트에 적은 새 반을 뒤 시트에서 바로 쓸 수 있습니다.",
    "· '추가' = 이미 있는 반·수업 시각·반 배정은 건너뜀. '덮어쓰기' = 반의 담당강사·강의실·특강·메모를 바꾸고, 시간표가 적힌 반은 그 반 시간표 전체를 파일대로 바꿉니다.",
    "· 시간표를 바꿀 때 이전 시간표는 지워지지 않고 적용시작일 전날까지로 닫혀 이력으로 남습니다. 파일이 지금 시간표와 같으면 아무것도 바꾸지 않습니다.",
    "· 적용시작일은 내일부터 180일 안(비우면 내일). 오늘은 안 됩니다 — 오늘 이미 찍힌 출결이 엉킵니다.",
    "· 시간표는 반영 전에 충돌을 확인합니다: 한 강사가 같은 시각 다른 강의실 · 한 강의실에 같은 시각 다른 강사 · 한 반이 같은 시각 두 칸이면 반영하지 않습니다. 같은 강사·같은 강의실은 합반으로 보고 알리기만 합니다.",
    "· 기존 반의 폐지·종강, 반 이름·과목 변경은 반 상세에서 합니다(수강 종료가 함께 움직여야 해서).",
    "· 반배정은 재원·휴원 원생만 됩니다(이미 끝난 과거 수강은 예외). 같은 반에 기간이 겹치는 배정은 만들 수 없습니다.",
    "· 날짜 2026-09-01 · 시각 16:20 · 요일 월~일.",
  ],
  revalidate: ["/classes", "/timetable", "/attendance", "/students"],

  async template(ctx) {
    const today = kstToday();
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const subjects = buildSubjectMaps(settings.operations.subjects);
    const s = specs(settings.operations.subjects.map((x) => x.label));
    const { classes, staff, rooms, slots } = await loadAll(db, ctx.tenantId, today);
    const staffName = new Map(staff.rows.map((u) => [u.id, u.display_name ?? u.email ?? ""]));
    const roomName = new Map(rooms.map((r) => [r.id, r.name]));
    const active = classes.rows.filter((c) => c.is_active).sort((a, b) => a.class_name.localeCompare(b.class_name, "ko"));
    const activeIds = new Set(active.map((c) => c.id));
    const clsById = new Map(classes.rows.map((c) => [c.id, c]));
    const liveSlots = slots
      .filter((r) => activeIds.has(r.class_id) && isLiveOn(r, today))
      .sort((a, b) => (clsById.get(a.class_id)!.class_name.localeCompare(clsById.get(b.class_id)!.class_name, "ko")) || DOW_ORDER_IDX(a.day_of_week) - DOW_ORDER_IDX(b.day_of_week) || a.start_time.localeCompare(b.start_time));
    const [students, enrolls] = await Promise.all([
      StudentIndex.load(db, ctx.tenantId, { includeWithdrawn: true }),
      fetchAllPaged<EnrollRow>((from, to) =>
        db.from("enrollments").select("id, student_id, class_id, start_date, end_date, attendance_days, on_hold").eq("tenant_id", ctx.tenantId).or(`end_date.is.null,end_date.gte.${today}`).order("id").range(from, to),
      ),
    ]);
    const stuById = new Map(students.rows.map((x) => [x.id, x]));
    return [
      {
        spec: s.classSpec,
        rows: active.map((c) => ({
          className: c.class_name, subject: subjects.labelOf(c.subject ?? ""), teacher: c.teacher_id ? (staffName.get(c.teacher_id) ?? "") : "",
          classroom: c.classroom_id ? (roomName.get(c.classroom_id) ?? "") : "", active: "예", special: "", closedAt: "", notes: "",
        })),
      },
      {
        spec: s.slotSpec,
        rows: liveSlots.map((r) => {
          const c = clsById.get(r.class_id)!;
          return {
            className: c.class_name, subject: subjects.labelOf(c.subject ?? ""), day: DOW_LABEL[r.day_of_week as DowKey] ?? "",
            start: hhmm(r.start_time), end: hhmm(r.end_time), period: r.period_label ?? "",
            teacher: r.teacher_id ? (staffName.get(r.teacher_id) ?? "") : (r.slot_teacher_label ?? ""),
            classroom: r.classroom_id ? (roomName.get(r.classroom_id) ?? "") : (r.slot_room_label ?? ""), validFrom: "",
          };
        }),
      },
      {
        spec: s.enrollSpec,
        rows: enrolls
          .filter((e) => activeIds.has(e.class_id) && stuById.has(e.student_id))
          .map((e) => {
            const st = stuById.get(e.student_id)!;
            const c = clsById.get(e.class_id)!;
            return {
              code: st.student_code ?? "", student: st.name, school: st.school ?? "", grade: st.grade ?? "", className: c.class_name,
              subject: subjects.labelOf(c.subject ?? ""), startDate: e.start_date, endDate: e.end_date ?? "",
              days: (e.attendance_days ?? []).map((d) => DOW_LABEL[d as DowKey] ?? d).join(","), onHold: e.on_hold ? "예" : "",
            };
          })
          .sort((a, b) => a.className.localeCompare(b.className, "ko") || a.student.localeCompare(b.student, "ko")),
      },
    ];
  },

  async plan({ ctx, mode, sheets, issues }) {
    const today = kstToday();
    const [settings, db] = await Promise.all([getTenantSettings(), createClient()]);
    const subjectOpts = settings.operations.subjects.map((x) => ({ label: x.label, value: x.key }));
    const subjects = buildSubjectMaps(settings.operations.subjects);
    const { classes, staff, rooms, slots } = await loadAll(db, ctx.tenantId, today);
    const liveRooms = rooms.filter((r) => !r.archived_at);
    const tomorrow = addDays(today, 1);
    const knownTeacherLabels = new Set(slots.map((r) => squash(r.slot_teacher_label)).filter(Boolean));
    const knownRoomLabels = new Map(slots.filter((r) => r.slot_room_label).map((r) => [squash(r.slot_room_label), r.slot_room_label!]));

    /**
     * 강의실 이름 → 행. 보관된 강의실은 **그 반이 지금 쓰고 있는 것**(`keepIds`)일 때만 받는다 — 서식을 그대로 다시 올려도
     * 실패하지 않게(서식이 지금 강의실 이름을 적는다). 보관된 강의실로 **새로** 옮기는 것은 거절([[#122]]).
     */
    const findRoom = <K extends string>(row: RowReader<K>, key: K, keepIds: ReadonlySet<string | null>): RoomRow | null | undefined => {
      const label = row.text(key, { max: 40 });
      if (!label) return null;
      const hit = liveRooms.filter((r) => squash(r.name) === squash(label));
      if (hit.length === 1) return hit[0]!;
      if (hit.length === 0) {
        const kept = rooms.filter((r) => r.archived_at && keepIds.has(r.id) && squash(r.name) === squash(label));
        if (kept.length === 1) return kept[0]!;
      }
      return undefined;
    };

    const plan: Plan = { newClasses: [], classUpdates: [], schedules: [], enrollInserts: [], enrollUpdates: [] };
    const preview: ImportPreviewRow[] = [];
    const notes: string[] = [];
    /** 이 파일이 만든 새 반(반이름+과목 → ref). */
    const fileClasses = new Map<string, NewClass>();
    const finalTeacher = new Map<string, string | null>(); // 반 id/ref → 반영 뒤 담당강사
    const finalRoom = new Map<string, string | null>();
    const refId = (c: ClassRef) => ("id" in c ? c.id : c.ref);

    // ── 반 ──────────────────────────────────────────────────────────────────────
    const classCount = { label: "반", total: 0, insert: 0, update: 0, skip: 0 };
    const seenClass = new Map<string, number>();
    for (const row of (sheets[CLASS_SHEET]?.rows ?? []) as RowReader<ClassKey>[]) {
      classCount.total += 1;
      const rawName = row.text("className", { required: true, max: 60 });
      const name = rawName ? normalizeClassName(rawName) : null;
      const reservedName = name ? reservedClassNameReason(name) : null;
      if (reservedName) row.fail("className", reservedName);
      const subject = row.option("subject", subjectOpts, true);
      const teacher = staff.resolve(row, "teacher");
      const curForRoom = rawName && subject ? pickClass(classes.rows, normalizeClassName(rawName), subject) : undefined;
      const room = findRoom(row, "classroom", new Set([curForRoom?.classroom_id ?? null]));
      if (room === undefined) row.fail("classroom", "등록된 강의실이 아닙니다(보관된 강의실은 새로 배정할 수 없습니다) — 강의실을 먼저 만들거나(강의실 엑셀) 이름을 확인하세요");
      // '운영'·'특강' 열이 우선, 없으면 내보내기 파일의 '상태'·'구분'(같은 뜻의 사람 글자).
      const statusActive = row.option("status", [
        { label: "운영", value: true },
        { label: "종강", value: true },
        { label: "폐지", value: false },
      ]);
      const active = row.yesNo("active") ?? statusActive;
      const kindSpecial = row.option("kind", [
        { label: "특강", value: true },
        { label: "정규", value: false },
      ]);
      const specialCell = row.yesNo("special");
      const closedAt = row.date("closedAt");
      const notesText = row.text("notes", { max: 2000 });
      if (!row.ok || !name || !subject) continue;
      const key = `${squash(name)}|${subject}`;
      const dupAt = seenClass.get(key);
      if (dupAt) {
        row.fail("className", `같은 반(반이름+과목)이 ${dupAt}행에도 있습니다`);
        continue;
      }
      seenClass.set(key, row.rowNum);
      const cur = pickClass(classes.rows, name, subject);
      // 🔑 '구분'은 화면 판정(`classKindMeta` — 표식 + 이름에 '특강')을 적은 글자라, 기존 반의 표식으로 되쓰지 않는다
      //    (이름으로 특강인 반에 표식을 박으면 뜻이 바뀐다). 새 반에서만 특강 여부로 쓴다.
      const special = specialCell ?? (cur ? null : kindSpecial);
      const label = `${name} (${subjects.labelOf(subject)})`;
      if (!cur) {
        const nc: NewClass = {
          ref: `new:${row.rowNum}`, rowNum: row.rowNum, className: name, subject, teacherId: teacher?.id ?? null, classroomId: room?.id ?? null,
          isActive: active ?? true, isSpecial: special ?? false, closedAt, notes: notesText,
        };
        plan.newClasses.push(nc);
        fileClasses.set(key, nc);
        finalTeacher.set(nc.ref, nc.teacherId);
        finalRoom.set(nc.ref, nc.classroomId);
        classCount.insert += 1;
        preview.push({ sheet: CLASS_SHEET, rowNum: row.rowNum, key: label, action: "insert", summary: [teacher?.display_name, room?.name, nc.isActive ? null : "운영 안 함", closedAt ? `종강 ${closedAt}` : null].filter(Boolean).join(" · ") || "새 반" });
        continue;
      }
      finalTeacher.set(cur.id, cur.teacher_id);
      finalRoom.set(cur.id, cur.classroom_id);
      if (mode === "append") {
        classCount.skip += 1;
        preview.push({ sheet: CLASS_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "이미 있는 반" });
        continue;
      }
      const patch: Record<string, unknown> = {};
      let teacherChange: ClassUpdate["teacherChange"] = null;
      let roomChange: ClassUpdate["roomChange"] = null;
      if (teacher && teacher.id !== cur.teacher_id) {
        patch.teacher_id = teacher.id;
        teacherChange = { from: cur.teacher_id, to: teacher.id, fromName: staff.rows.find((u) => u.id === cur.teacher_id)?.display_name ?? null, toName: teacher.display_name };
        finalTeacher.set(cur.id, teacher.id);
      }
      if (room && room.id !== cur.classroom_id) {
        patch.classroom_id = room.id;
        roomChange = { fromName: rooms.find((r) => r.id === cur.classroom_id)?.name ?? null, toName: room.name };
        finalRoom.set(cur.id, room.id);
      }
      if (special !== null && special !== (cur.is_special ?? false)) patch.is_special = special;
      if (notesText && notesText !== (cur.notes ?? "")) patch.notes = notesText;
      if (active === false && cur.is_active) notes.push(`${CLASS_SHEET} ${row.rowNum}행 ${label}: 폐지는 반 상세의 '반 폐지'로 해 주세요(수강 종료가 함께 움직입니다) — 파일에서는 바꾸지 않았습니다`);
      if (active === true && !cur.is_active) notes.push(`${CLASS_SHEET} ${row.rowNum}행 ${label}: 폐지된 반의 재운영은 반 상세에서 해 주세요 — 파일에서는 바꾸지 않았습니다`);
      if (closedAt) notes.push(`${CLASS_SHEET} ${row.rowNum}행 ${label}: 기존 반의 종강일은 반 상세의 '종강'으로 — 파일에서는 바꾸지 않았습니다`);
      if (Object.keys(patch).length === 0) {
        classCount.skip += 1;
        preview.push({ sheet: CLASS_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "바뀐 칸 없음" });
        continue;
      }
      plan.classUpdates.push({ id: cur.id, className: cur.class_name, patch, teacherChange, roomChange });
      classCount.update += 1;
      preview.push({ sheet: CLASS_SHEET, rowNum: row.rowNum, key: label, action: "update", summary: [teacherChange ? `담당 → ${teacher?.display_name ?? ""}` : null, roomChange ? `강의실 → ${room?.name ?? ""}` : null, "is_special" in patch ? `특강 ${special ? "예" : "아니오"}` : null, "notes" in patch ? "메모" : null].filter(Boolean).join(" · ") });
    }

    /** 반 참조 풀기 — 이 파일의 새 반 먼저, 다음 기존 반. 못 찾으면 그 칸 위치로 오류. */
    const resolveClass = <K extends string>(row: RowReader<K>, nameKey: K, subjectKey: K): { cls: ClassRef; subject: string; label: string } | null => {
      const rawName = row.text(nameKey, { required: true, max: 60 });
      const subject = row.option(subjectKey, subjectOpts);
      if (!rawName) return null;
      const name = normalizeClassName(rawName);
      const fromFile = [...fileClasses.entries()].filter(([k]) => k.startsWith(`${squash(name)}|`) && (!subject || k.endsWith(`|${subject}`)));
      const fromDb = classes.match(name, subject);
      const hits = [
        ...fromFile.map(([, nc]) => ({ cls: { ref: nc.ref } as ClassRef, subject: nc.subject })),
        ...fromDb.filter((c) => !fromFile.some(([k]) => k === `${squash(c.class_name)}|${c.subject}`)).map((c) => ({ cls: { id: c.id } as ClassRef, subject: c.subject ?? "" })),
      ];
      if (hits.length === 1) return { ...hits[0]!, label: `${name} (${subjects.labelOf(hits[0]!.subject)})` };
      row.fail(nameKey, hits.length === 0 ? `'${name}' 반을 찾지 못했습니다 — 수업목록의 반 이름 그대로 적거나 '반' 시트에 새 반으로 적어 주세요` : `'${name}' 반이 과목별로 ${hits.length}개입니다 — 과목 칸을 채워 주세요`);
      return null;
    };

    // ── 시간표 ──────────────────────────────────────────────────────────────────
    const slotCount = { label: "시간표(교시)", total: 0, insert: 0, update: 0, skip: 0 };
    type FileSlot = { rowNum: number; shape: SlotShape; ins: Omit<SlotInsert, "mergeGroup" | "labSeparate">; validFrom: string };
    const byClass = new Map<string, { cls: ClassRef; label: string; rows: FileSlot[] }>();
    const slotSeen = new Map<string, number>();
    for (const row of (sheets[SLOT_SHEET]?.rows ?? []) as RowReader<SlotKey>[]) {
      slotCount.total += 1;
      const c = resolveClass(row, "className", "subject");
      const dayIdx = row.weekday("day", true);
      const start = row.time("start", true);
      const end = row.time("end", true);
      const period = row.text("period", { max: 20 });
      // 🔴 내일부터 — 오늘 적용하면 오늘 이미 찍힌 출결의 앵커(교시 시작 시각)가 옮겨진다([[#126]]).
      const validFrom = row.date("validFrom") ?? tomorrow;
      if (validFrom < tomorrow) row.fail("validFrom", "적용시작일은 내일 이후여야 합니다 — 오늘·지난 날짜의 시간표를 바꾸면 이미 찍힌 출결이 엉킵니다");
      else if (validFrom > addDays(today, MAX_AHEAD_DAYS)) row.fail("validFrom", `적용시작일은 ${MAX_AHEAD_DAYS}일 안이어야 합니다`);
      if (start && end && start >= end) row.fail("end", "종료 시각이 시작 시각보다 늦어야 합니다");
      // 강사 칸: 직원 → 자리(LAB·JJ) → 이미 쓰는 표시 라벨(영문 닉네임 등) 순. 모르는 글자는 오류(오타가 조용히 라벨로 남지 않게).
      let teacherId: string | null = null;
      let teacherLabel: string | null = null;
      const tText = row.text("teacher", { max: 40 });
      if (tText) {
        const seat = specialSlotLabel(tText);
        const hits = seat ? [] : staff.match(tText);
        if (seat) teacherLabel = seat;
        else if (hits.length === 1) teacherId = hits[0]!.id;
        else if (hits.length === 0 && knownTeacherLabels.has(squash(tText))) teacherLabel = tText;
        else row.fail("teacher", hits.length === 0 ? `'${tText}' 직원을 찾지 못했습니다 — 직원관리의 이름, 또는 LAB·JJ` : `'${tText}' 이름의 직원이 ${hits.length}명입니다 — 로그인 이메일로 적어 주세요`);
      }
      let classroomId: string | null = null;
      let roomLabel: string | null = null;
      const rText = row.text("classroom", { max: 40 });
      if (rText) {
        // 보관된 강의실은 이 반이 지금 쓰는 것일 때만(서식 재업로드) — 반 상세 저장과 같은 결.
        const keep = new Set<string | null>(c && "id" in c.cls ? [classes.rows.find((x) => x.id === (c.cls as { id: string }).id)?.classroom_id ?? null, ...slots.filter((r) => r.class_id === (c.cls as { id: string }).id).map((r) => r.classroom_id)] : []);
        const hit = liveRooms.filter((r) => squash(r.name) === squash(rText));
        const kept = hit.length === 0 ? rooms.filter((r) => r.archived_at && keep.has(r.id) && squash(r.name) === squash(rText)) : [];
        if (hit.length === 1) classroomId = hit[0]!.id;
        else if (kept.length === 1) classroomId = kept[0]!.id;
        else if (knownRoomLabels.has(squash(rText))) roomLabel = knownRoomLabels.get(squash(rText))!;
        else row.fail("classroom", "등록된 강의실이 아닙니다 — 강의실 이름을 확인하세요");
      }
      if (!row.ok || !c || dayIdx === null || !start || !end) continue;
      const day = dowKeyOf(dayIdx);
      const id = refId(c.cls);
      const dupKey = `${id}|${day}|${start}`;
      const dupAt = slotSeen.get(dupKey);
      if (dupAt) {
        row.fail("start", `같은 반·요일·시작 시각이 ${dupAt}행에도 있습니다`);
        continue;
      }
      slotSeen.set(dupKey, row.rowNum);
      const g = byClass.get(id) ?? { cls: c.cls, label: c.label, rows: [] };
      g.rows.push({
        rowNum: row.rowNum,
        validFrom,
        shape: { day, start, end, teacher: teacherId, room: classroomId, teacherLabel, roomLabel },
        ins: { day, start, end, teacherId, classroomId, teacherLabel, roomLabel, periodLabel: period },
      });
      byClass.set(id, g);
    }
    const slotsByClass = new Map<string, typeof slots>();
    for (const r of slots) slotsByClass.set(r.class_id, [...(slotsByClass.get(r.class_id) ?? []), r]);
    /** 충돌 검사 재료 — 이 파일이 넣는 칸(반별 적용시작일·교체 여부와 함께). */
    const fileTargets: { classId: string; validFrom: string; replaces: boolean; slots: TargetSlot[] }[] = [];
    const classLabel = new Map<string, string>();
    for (const [id, g] of byClass) {
      classLabel.set(id, g.label);
      const froms = new Set(g.rows.map((r) => r.validFrom));
      if (froms.size > 1) {
        for (const r of g.rows) issues.push({ sheet: SLOT_SHEET, row: r.rowNum, col: null, header: "적용시작일", value: r.validFrom, message: `${g.label}의 줄들이 적용시작일이 서로 다릅니다(${[...froms].join(", ")}) — 한 반은 한 날짜로` });
        continue;
      }
      const validFrom = g.rows[0]!.validFrom;
      const existing = "id" in g.cls ? (slotsByClass.get(id) ?? []) : [];
      const teacherOf = finalTeacher.get(id) ?? (("id" in g.cls && classes.rows.find((c) => c.id === id)?.teacher_id) || null);
      const roomOf = finalRoom.get(id) ?? (("id" in g.cls && classes.rows.find((c) => c.id === id)?.classroom_id) || null);
      // 실효값(칸 값 ?? 반 기본)으로 비교 — 칸을 비운 줄과 반 담당을 그대로 적은 줄은 같은 배치다.
      const eff = (s: SlotShape): SlotShape => ({ ...s, teacher: s.teacherLabel ? null : (s.teacher ?? teacherOf), room: s.roomLabel ? null : (s.room ?? roomOf) });
      const liveAtStart = existing.filter((r) => isLiveOn(r, validFrom));
      const liveShape = liveAtStart.map((r) => eff({ day: r.day_of_week, start: hhmm(r.start_time), end: hhmm(r.end_time), teacher: r.teacher_id, room: r.classroom_id, teacherLabel: r.slot_teacher_label, roomLabel: r.slot_room_label }));
      const oldBySlot = new Map(liveAtStart.map((r) => [slotKey({ day: r.day_of_week, start: hhmm(r.start_time) }), r]));
      const toInsert = (f: FileSlot): SlotInsert => {
        const old = oldBySlot.get(slotKey(f.shape));
        return {
          ...f.ins,
          // 반 기본과 같으면 칸 override를 비운다(반 담당이 바뀌면 따라가게).
          teacherId: f.ins.teacherId && f.ins.teacherId !== teacherOf ? f.ins.teacherId : null,
          classroomId: f.ins.classroomId && f.ins.classroomId !== roomOf ? f.ins.classroomId : null,
          periodLabel: f.ins.periodLabel ?? old?.period_label ?? null,
          mergeGroup: old?.merge_group ?? null,
          labSeparate: old && "lab_separate" in old ? (old.lab_separate ?? false) : null,
        };
      };
      // 충돌 검사용 실효 칸 — 자리(LAB·JJ)·표시 라벨 칸은 강사·강의실을 비교하지 않는다(conflicts.ts와 같은 규약).
      const targets: TargetSlot[] = [];
      const addTarget = (f: FileSlot) => {
        const e = eff(f.shape);
        targets.push({ classId: id, day: e.day, start: e.start, end: e.end, teacherId: e.teacher, roomId: e.room, rowNum: f.rowNum });
      };
      if (mode === "append") {
        const liveKeys = new Set(liveAtStart.map((r) => slotKey({ day: r.day_of_week, start: hhmm(r.start_time) })));
        const adds: SlotInsert[] = [];
        for (const f of g.rows) {
          if (liveKeys.has(slotKey(f.shape))) {
            slotCount.skip += 1;
            preview.push({ sheet: SLOT_SHEET, rowNum: f.rowNum, key: g.label, action: "skip", summary: `${DOW_LABEL[f.shape.day as DowKey]} ${f.shape.start} 이미 있음` });
          } else {
            adds.push(toInsert(f));
            addTarget(f);
            slotCount.insert += 1;
            preview.push({ sheet: SLOT_SHEET, rowNum: f.rowNum, key: g.label, action: "insert", summary: `${DOW_LABEL[f.shape.day as DowKey]} ${f.shape.start}~${f.shape.end} · ${validFrom}부터` });
          }
        }
        if (adds.length) plan.schedules.push({ cls: g.cls, className: g.label, validFrom, replace: null, inserts: adds });
        if (targets.length) fileTargets.push({ classId: id, validFrom, replaces: false, slots: targets });
        continue;
      }
      const futureRows = existing.filter((r) => r.valid_from > validFrom);
      const fileShape = g.rows.map((f) => eff(f.shape));
      if (futureRows.length === 0 && sameSchedule(liveShape, fileShape)) {
        slotCount.skip += g.rows.length;
        for (const f of g.rows) preview.push({ sheet: SLOT_SHEET, rowNum: f.rowNum, key: g.label, action: "skip", summary: "지금 시간표와 같음" });
        continue;
      }
      const replace = planScheduleReplace(existing, validFrom);
      plan.schedules.push({ cls: g.cls, className: g.label, validFrom, replace, inserts: g.rows.map(toInsert) });
      for (const f of g.rows) addTarget(f);
      fileTargets.push({ classId: id, validFrom, replaces: true, slots: targets });
      const verb = existing.length ? "update" : "insert";
      if (verb === "update") slotCount.update += g.rows.length;
      else slotCount.insert += g.rows.length;
      for (const f of g.rows) {
        preview.push({ sheet: SLOT_SHEET, rowNum: f.rowNum, key: g.label, action: verb, summary: `${DOW_LABEL[f.shape.day as DowKey]} ${f.shape.start}~${f.shape.end} · ${validFrom}부터${existing.length ? ` (이전 ${liveAtStart.length}교시는 ${addDays(validFrom, -1)}까지로 닫음)` : ""}` });
      }
      if (futureRows.length) notes.push(`${g.label}: ${validFrom} 뒤에 예약돼 있던 시간표 ${futureRows.length}줄은 파일의 시간표로 대신합니다`);
    }

    // ── 시간표 충돌 확인(적용 전) ─────────────────────────────────────────────────
    // 시간표 가져오기의 "충돌 확인 체크리스트를 통과해야 적용"과 같은 규칙 — 반별 적용시작일 날의 **목표 배치**
    // (다른 반의 그날 유효 칸 + 이 파일의 칸 − 교체되는 반의 옛 칸)에서 겹침을 찾아 파일 줄 위치로 알린다.
    if (fileTargets.length) {
      const slotMap = sheets[SLOT_SHEET]?.map;
      const colOf = (k: SlotKey) => {
        const idx = slotMap?.get(k);
        return idx === undefined ? null : colLetter(idx);
      };
      const staffName = new Map(staff.rows.map((u) => [u.id, u.display_name ?? u.email ?? ""]));
      const roomNameOf = new Map(rooms.map((r) => [r.id, r.name]));
      const clsById = new Map(classes.rows.map((c) => [c.id, c]));
      const labelOf = (classId: string) => classLabel.get(classId) ?? (clsById.get(classId) ? `${clsById.get(classId)!.class_name} (${subjects.labelOf(clsById.get(classId)!.subject ?? "")})` : "다른 반");
      const existingTarget = (r: SlotRow): TargetSlot => {
        const c = clsById.get(r.class_id);
        const seat = !!specialSlotLabel(r.slot_teacher_label) || (!r.teacher_id && !!r.slot_teacher_label);
        const clsTeacher = finalTeacher.get(r.class_id) ?? c?.teacher_id ?? null;
        const clsRoom = finalRoom.get(r.class_id) ?? c?.classroom_id ?? null;
        return {
          classId: r.class_id, day: r.day_of_week, start: hhmm(r.start_time), end: hhmm(r.end_time),
          teacherId: seat ? null : (r.teacher_id ?? clsTeacher),
          roomId: r.classroom_id ?? (r.slot_room_label ? null : clsRoom),
          rowNum: null,
        };
      };
      const seen = new Set<string>();
      for (const D of new Set(fileTargets.map((t) => t.validFrom))) {
        const replaced = new Set(fileTargets.filter((t) => t.replaces && t.validFrom <= D).map((t) => t.classId));
        const target: TargetSlot[] = [
          ...slots.filter((r) => clsById.get(r.class_id)?.is_active && !replaced.has(r.class_id) && isLiveOn(r, D)).map(existingTarget),
          ...fileTargets.filter((t) => t.validFrom <= D).flatMap((t) => t.slots),
        ];
        for (const c of detectSlotConflicts(target)) {
          const mine = c.a.rowNum !== null ? c.a : c.b;
          const other = mine === c.a ? c.b : c.a;
          const dedupe = `${c.kind}|${[c.a.rowNum ?? `${c.a.classId}${c.a.start}`, c.b.rowNum ?? `${c.b.classId}${c.b.start}`].sort().join("|")}|${mine.day}`;
          if (seen.has(dedupe)) continue;
          seen.add(dedupe);
          const when = `${DOW_LABEL[mine.day as DowKey] ?? mine.day} ${other.start}~${other.end}`;
          const otherWhere = other.rowNum !== null ? `이 파일 ${other.rowNum}행` : "지금 시간표";
          const base = { sheet: SLOT_SHEET, row: mine.rowNum };
          if (c.kind === "merged") {
            notes.push(`${SLOT_SHEET} ${mine.rowNum}행: ${labelOf(mine.classId)}와 ${labelOf(other.classId)}(${otherWhere})가 ${when}에 같은 강사·같은 강의실 — 합반으로 보고 그대로 반영합니다`);
          } else if (c.kind === "duplicate") {
            issues.push({ ...base, col: colOf("start"), header: "시작", value: mine.start, message: `같은 반이 ${when}에 이미 수업이 있습니다(${otherWhere}) — 한 반이 같은 시각에 두 칸일 수 없습니다` });
          } else if (c.kind === "teacher") {
            issues.push({ ...base, col: colOf("teacher"), header: "강사", value: staffName.get(mine.teacherId ?? "") ?? null, message: `이 강사는 ${when}에 ${labelOf(other.classId)}(${roomNameOf.get(other.roomId ?? "") ?? "다른 강의실"}, ${otherWhere}) 수업이 있습니다 — 한 강사가 같은 시각 두 강의실에 있을 수 없습니다(적용일 ${D})` });
          } else {
            issues.push({ ...base, col: colOf("classroom"), header: "강의실", value: roomNameOf.get(mine.roomId ?? "") ?? null, message: `이 강의실은 ${when}에 ${labelOf(other.classId)}(${staffName.get(other.teacherId ?? "") ?? "다른 강사"}, ${otherWhere})가 씁니다 — 한 강의실에 같은 시각 다른 강사일 수 없습니다(적용일 ${D})` });
          }
        }
      }
    }

    // ── 반배정 ──────────────────────────────────────────────────────────────────
    const enrollRows = (sheets[ENROLL_SHEET]?.rows ?? []) as RowReader<EnrollKey>[];
    const enrollCount = { label: "반배정", total: enrollRows.length, insert: 0, update: 0, skip: 0 };
    if (enrollRows.length) {
      const [students, enrolls] = await Promise.all([
        StudentIndex.load(db, ctx.tenantId, { includeWithdrawn: true }),
        fetchAllPaged<EnrollRow>((from, to) =>
          db.from("enrollments").select("id, student_id, class_id, start_date, end_date, attendance_days, on_hold").eq("tenant_id", ctx.tenantId).order("id").range(from, to),
        ),
      ]);
      const daysOf = (id: string, cls: ClassRef): Set<string> => {
        const fromFile = byClass.get(id);
        if (fromFile && (mode === "overwrite" || !("id" in cls))) return new Set(fromFile.rows.map((r) => r.shape.day));
        const s = new Set((slotsByClass.get(id) ?? []).filter((r) => isLiveOn(r, today) || r.valid_from > today).map((r) => r.day_of_week));
        for (const r of fromFile?.rows ?? []) s.add(r.shape.day);
        return s;
      };
      const pending: { studentId: string; id: string; start: string; end: string | null; rowNum: number }[] = [];
      for (const row of enrollRows) {
        const st = students.resolve(row, { code: "code", name: "student", school: "school", grade: "grade" });
        const c = resolveClass(row, "className", "subject");
        const startDate = row.date("startDate", true);
        const endDate = row.date("endDate");
        const onHoldCell = row.yesNo("onHold");
        const picked: DowKey[] = [];
        for (const t of splitList(row.raw("days"))) {
          const d = parseWeekday(t);
          if (d === undefined || d === null) row.fail("days", `'${t}'은(는) 요일이 아닙니다 — '월,수'처럼 적어 주세요`);
          else picked.push(dowKeyOf(d));
        }
        if (startDate && endDate && endDate < startDate) row.fail("endDate", "수강종료일이 수강시작일보다 빠릅니다");
        if (!row.ok || !st || !c || !startDate) continue;
        const id = refId(c.cls);
        const classDays = daysOf(id, c.cls);
        const nd = normalizeDays(picked, classDays);
        if (nd.outside.length) {
          row.fail("days", `${nd.outside.map((d) => DOW_LABEL[d]).join("·")}요일엔 이 반 수업이 없습니다(수업 요일: ${[...classDays].map((d) => DOW_LABEL[d as DowKey] ?? d).join("·") || "없음"})`);
          continue;
        }
        const historical = !!endDate && endDate < today;
        const blocked = historical || st.status === "on_hold" ? null : enrollmentAssignBlockReason(st.status);
        if (blocked) {
          row.fail("student", blocked.replace(/학생/g, "원생"));
          continue;
        }
        const onHold = onHoldCell ?? (st.status === "on_hold" && !historical);
        const label = `${st.name} → ${c.label}`;
        // 같은 파일 안 겹침(같은 원생·같은 반) — DB가 거절하기 전에 위치로 알린다.
        const clash = pending.find((p) => p.studentId === st.id && p.id === id && periodsOverlap(p.start, p.end, startDate, endDate));
        if (clash) {
          row.fail("startDate", `같은 원생·같은 반의 기간이 ${clash.rowNum}행과 겹칩니다`);
          continue;
        }
        pending.push({ studentId: st.id, id, start: startDate, end: endDate, rowNum: row.rowNum });
        const cur = "id" in c.cls ? enrolls.find((e) => e.student_id === st.id && e.class_id === id && periodsOverlap(e.start_date, e.end_date, startDate, endDate)) : undefined;
        if (!cur) {
          plan.enrollInserts.push({ cls: c.cls, studentId: st.id, startDate, endDate, days: nd.days, onHold });
          enrollCount.insert += 1;
          preview.push({ sheet: ENROLL_SHEET, rowNum: row.rowNum, key: label, action: "insert", summary: `${startDate}~${endDate ?? ""}${nd.days.length ? ` · ${nd.days.map((d) => DOW_LABEL[d]).join("")}만` : ""}${onHold ? " · 휴원" : ""}` });
          continue;
        }
        if (mode === "append") {
          enrollCount.skip += 1;
          preview.push({ sheet: ENROLL_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: `이미 배정됨(${cur.start_date}~${cur.end_date ?? ""})` });
          continue;
        }
        const patch: Record<string, unknown> = {};
        if (row.raw("endDate") && endDate !== cur.end_date) patch.end_date = endDate;
        if (row.raw("days") && JSON.stringify(nd.days) !== JSON.stringify(cur.attendance_days ?? [])) patch.attendance_days = nd.days;
        if (onHoldCell !== null && onHoldCell !== cur.on_hold) patch.on_hold = onHoldCell;
        if (startDate !== cur.start_date) notes.push(`${ENROLL_SHEET} ${row.rowNum}행 ${label}: 수강시작일은 바꾸지 않았습니다(지금 ${cur.start_date}) — 원생 상세 '수업' 탭에서`);
        if (Object.keys(patch).length === 0) {
          enrollCount.skip += 1;
          preview.push({ sheet: ENROLL_SHEET, rowNum: row.rowNum, key: label, action: "skip", summary: "바뀐 칸 없음" });
          continue;
        }
        plan.enrollUpdates.push({ id: cur.id, patch });
        enrollCount.update += 1;
        preview.push({ sheet: ENROLL_SHEET, rowNum: row.rowNum, key: label, action: "update", summary: Object.keys(patch).map((k) => ({ end_date: `종료 ${endDate ?? "없음"}`, attendance_days: "등원요일", on_hold: onHoldCell ? "휴원" : "휴원 해제" })[k] ?? k).join(" · ") });
      }
    }

    return { counts: [classCount, slotCount, enrollCount], preview, notes, plan };
  },

  async apply({ ctx, plan }) {
    return applyPlan(ctx, plan);
  },
};

function DOW_ORDER_IDX(d: string): number {
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(d);
}

async function applyPlan(ctx: ImportCtx, plan: Plan): Promise<{ error?: string; notes?: string[] }> {
  const db = await createClient();
  if (!(await canManageStudentStatusNow())) {
    // Validate the whole plan before creating classes or changing schedules.
    if (plan.enrollUpdates.some((r) => "end_date" in r.patch || "on_hold" in r.patch) || plan.enrollInserts.some((r) => r.endDate)) {
      return { error: STUDENT_STATUS_DENIED };
    }
    const students = await fetchInChunks([...new Set(plan.enrollInserts.map((r) => r.studentId))], (ids) =>
      db.from("students").select("id, status").eq("tenant_id", ctx.tenantId).in("id", ids));
    const status = new Map(students.map((r) => [r.id, r.status]));
    if (plan.enrollInserts.some((r) => !status.has(r.studentId) || r.onHold !== (status.get(r.studentId) === "on_hold"))) {
      return { error: STUDENT_STATUS_DENIED };
    }
  }
  const done: string[] = [];
  const stop = (what: string, msg: string) => ({ error: `${what}에서 멈췄습니다 — ${msg}${done.length ? ` (이미 반영: ${done.join(" · ")})` : ""}` });

  // 1) 새 반
  const idOfRef = new Map<string, string>();
  if (plan.newClasses.length) {
    const { data, error } = await db
      .from("classes")
      .insert(
        plan.newClasses.map((c) => ({
          tenant_id: ctx.tenantId, class_name: c.className, subject: c.subject, teacher_id: c.teacherId, classroom_id: c.classroomId,
          is_active: c.isActive, is_special: c.isSpecial, closed_at: c.closedAt, notes: c.notes,
        })),
      )
      .select("id, class_name, subject");
    if (error || !data) return stop("새 반 만들기", /duplicate key/i.test(error?.message ?? "") ? "같은 이름·과목의 반이 방금 생겼습니다(미리보기를 다시 받아 주세요)" : (error?.message ?? "응답 없음"));
    for (const c of plan.newClasses) {
      const hit = data.find((d) => d.class_name === c.className && d.subject === c.subject);
      if (hit) idOfRef.set(c.ref, hit.id as string);
    }
    done.push(`새 반 ${data.length}개`);
  }
  const idOf = (c: ClassRef) => ("id" in c ? c.id : idOfRef.get(c.ref) ?? null);

  // 2) 반 갱신 — 담당이 바뀌면 반 수정과 같은 감사로그(지난 주 담임 복원이 이 줄을 읽는다).
  for (const u of plan.classUpdates) {
    const { error } = await db.from("classes").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
    if (error) return stop(`반 '${u.className}' 갱신`, error.message);
    if (u.teacherChange || u.roomChange) {
      const changes: { field: string; from?: string | null; to?: string | null }[] = [];
      if (u.teacherChange) changes.push({ field: "담임", from: u.teacherChange.fromName, to: u.teacherChange.toName });
      if (u.roomChange) changes.push({ field: "강의실", from: u.roomChange.fromName, to: u.roomChange.toName });
      await logAction({
        action: "class_update",
        targetType: "class",
        targetLabel: u.className,
        metadata: {
          classId: u.id,
          source: "excel",
          // 슬랙 발송기가 이 표식을 보고 행별 메시지를 건너뛴다(파일 한 번 = excel_import 한 줄).
          excelImport: true,
          changed: changes.map((c) => c.field),
          changes,
          ...(u.teacherChange ? { newTeacherId: u.teacherChange.to, previousTeacherId: u.teacherChange.from, effectiveDate: kstToday() } : {}),
        },
      });
    }
  }
  if (plan.classUpdates.length) done.push(`반 갱신 ${plan.classUpdates.length}개`);

  // 3) 시간표 — 새 구간을 **먼저** 넣고 옛 구간을 닫는다. 닫기가 실패하면 방금 넣은 행을 지워 원상태로(두 벌 겹침 방지).
  let slotOps = 0;
  for (const op of plan.schedules) {
    const classId = idOf(op.cls);
    if (!classId) return stop(`'${op.className}' 시간표`, "새 반 id를 찾지 못했습니다");
    const rows = op.inserts.map((s) => ({
      tenant_id: ctx.tenantId, class_id: classId, day_of_week: s.day, start_time: s.start, end_time: s.end, valid_from: op.validFrom, valid_to: null,
      teacher_id: s.teacherId, classroom_id: s.classroomId, slot_teacher_label: s.teacherLabel, slot_room_label: s.roomLabel,
      period_label: s.periodLabel, merge_group: s.mergeGroup, ...(s.labSeparate !== null ? { lab_separate: s.labSeparate } : {}),
    }));
    const { data: made, error } = await db.from("class_schedules").insert(rows).select("id");
    if (error) return stop(`'${op.className}' 시간표 넣기`, error.message);
    if (op.replace) {
      const madeIds = (made ?? []).map((r) => r.id as string);
      const undo = async () => {
        if (madeIds.length) await db.from("class_schedules").delete().in("id", madeIds).eq("tenant_id", ctx.tenantId);
      };
      if (op.replace.close.length) {
        const { error: e2 } = await db.from("class_schedules").update({ valid_to: addDays(op.validFrom, -1) }).in("id", op.replace.close).eq("tenant_id", ctx.tenantId);
        if (e2) {
          await undo();
          return stop(`'${op.className}' 옛 시간표 닫기`, `${e2.message} — 이 반은 되돌렸습니다`);
        }
      }
      if (op.replace.remove.length) {
        const { error: e3 } = await db.from("class_schedules").delete().in("id", op.replace.remove).eq("tenant_id", ctx.tenantId);
        if (e3) return stop(`'${op.className}' 예약 시간표 정리`, `${e3.message} — 새 시간표는 들어갔고 옛 구간은 닫혔습니다. 반 상세에서 겹친 교시를 확인해 주세요`);
      }
    }
    slotOps += 1;
  }
  if (slotOps) done.push(`시간표 ${slotOps}개 반`);

  // 4) 반배정
  if (plan.enrollInserts.length) {
    const rows = plan.enrollInserts.map((e) => ({
      tenant_id: ctx.tenantId, student_id: e.studentId, class_id: idOf(e.cls), start_date: e.startDate, end_date: e.endDate,
      attendance_days: e.days, on_hold: e.onHold,
    }));
    if (rows.some((r) => !r.class_id)) return stop("반배정", "새 반 id를 찾지 못했습니다");
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("enrollments").insert(rows.slice(i, i + 200));
      if (error) {
        const overlap = /no_overlap|exclusion|23P01/i.test(`${error.message} ${error.code ?? ""}`);
        return stop("반배정 넣기", overlap ? "같은 원생·같은 반에 기간이 겹치는 배정이 방금 생겼습니다(미리보기를 다시 받아 주세요)" : error.message);
      }
    }
    done.push(`반배정 ${rows.length}건`);
  }
  for (const u of plan.enrollUpdates) {
    const { error } = await db.from("enrollments").update(u.patch).eq("id", u.id).eq("tenant_id", ctx.tenantId);
    if (error) return stop("반배정 갱신", error.message);
  }
  return {};
}

export default def;
