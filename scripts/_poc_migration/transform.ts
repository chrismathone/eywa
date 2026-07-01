// ijw-calander(Firestore/NoSQL) 문서 → eywa(Supabase/관계형) 행 변환 (순수 함수).
// enum/status 매핑, ID 리매핑, 서브컬렉션 분해, name_normalized 미공급, 날짜 정규화 등 정제 룰.
import { randomUUID } from "node:crypto";

// ── 정제 헬퍼 ──────────────────────────────────────────────────────
// 다양한 날짜 표기('YYYY-MM-DD'·ISO·'YYYY.MM.DD'·'YYYY/MM/DD') → 'YYYY-MM-DD', 불가 시 null.
export function normDate(v?: any): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") {
    const d = new Date(v);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const s = v.trim();
  if (!s) return null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dot = s.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/);
  if (dot) return `${dot[1]}-${dot[2].padStart(2, "0")}-${dot[3].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
// 'YYYY-MM' 월 필터(>=). billing month 가 'YYYY-MM' 또는 'YYYY-MM-..' 형태여도 앞 7자 비교.
export function monthGte(month: any, cutoff: string): boolean {
  if (typeof month !== "string") return false;
  return month.slice(0, 7) >= cutoff;
}
// name_normalized 동등 비교용(클라 측 dedup). DB generated 컬럼과 동일 규칙(공백제거+소문자).
export function normName(name?: string): string {
  return (name ?? "").replace(/\s+/g, "").toLowerCase();
}

// ── enum 매핑(보강) ────────────────────────────────────────────────
// ijw attendance status → eywa attendance_status('present','absent','late','excused','makeup')
const ATT_MAP: Record<string, string> = {
  present: "present", late: "late", absent: "absent", excused: "excused", early_leave: "excused", makeup: "makeup",
};
export function mapAttendanceStatus(s?: string): string {
  return ATT_MAP[s ?? ""] ?? "present";
}
// ijw consultations.status(한글) → eywa consultation_outcome
export function mapConsultationOutcome(s?: string): string {
  const t = s ?? "";
  if (t.includes("등록완료") || t.endsWith("등록")) return "enrolled"; // 영수등록/수학등록/…/등록완료
  if (t.includes("등록예정")) return "scheduled";
  if (t === "미등록") return "declined";
  if (t === "상담전") return "pending";
  return "consulted";
}
// ijw billing(status+금액) → eywa invoice_status
export function mapInvoiceStatus(total: number, paid: number): string {
  if (paid <= 0) return "unpaid";
  if (paid >= total) return "paid";
  return "partial";
}

// ── 교시 → 시간 (ijw components/Timetable/constants.ts 이식) ──
const WD_MATH: Record<string, [string, string]> = { "1": ["14:30", "15:25"], "2": ["15:25", "16:20"], "3": ["16:20", "17:15"], "4": ["17:15", "18:10"], "5": ["18:20", "19:15"], "6": ["19:15", "20:10"], "7": ["20:10", "21:05"], "8": ["21:05", "22:00"] };
const WD_ENG: Record<string, [string, string]> = { "1": ["14:20", "15:00"], "2": ["15:00", "15:40"], "3": ["15:40", "16:20"], "4": ["16:20", "17:00"], "5": ["17:00", "17:40"], "6": ["17:40", "18:20"], "7": ["18:20", "19:15"], "8": ["19:15", "20:10"], "9": ["20:10", "21:05"], "10": ["21:05", "22:00"] };
const WEEKEND_T: Record<string, [string, string]> = { "1": ["09:00", "10:00"], "2": ["10:00", "11:00"], "3": ["11:00", "12:00"], "4": ["12:00", "13:00"], "5": ["13:00", "14:00"], "6": ["14:00", "15:00"], "7": ["15:00", "16:00"], "8": ["16:00", "17:00"] };
const LEGACY_PID: Record<string, string> = { "1-1": "1", "1-2": "2", "2-1": "3", "2-2": "4", "3-1": "5", "3-2": "6", "4-1": "7", "4-2": "8" };

// (day, periodId, subject) → {start,end}. 주말은 1시간 그리드, 영어는 40분, 그 외(math/science/korean/highmath)는 55분.
export function scheduleSlotTimes(day: string, periodId: string, subject?: string): { start: string; end: string } | null {
  if (!DAY_MAP[day] || periodId === undefined || periodId === null || periodId === "") return null;
  const pid = LEGACY_PID[String(periodId)] ?? String(periodId);
  const table = day === "토" || day === "일" ? WEEKEND_T : subject === "english" ? WD_ENG : WD_MATH;
  const t = table[pid];
  return t ? { start: t[0], end: t[1] } : null;
}

// 출결 카운트(0=결석, 1+=출석) → eywa attendance_status
export function mapAttendanceCount(v: any): string {
  return Number(v) >= 1 ? "present" : "absent";
}

// ── enum / 코드 매핑 ────────────────────────────────────────────────
// ijw students.status('active'/'on_hold'/'withdrawn'/'prospect'/'prospective') → eywa student_status
export const STATUS_MAP: Record<string, string> = {
  active: "enrolled",
  on_hold: "on_hold",
  withdrawn: "withdrawn",
  prospect: "prospect",
  prospective: "prospect",
};
export function mapStudentStatus(s?: string): string {
  return STATUS_MAP[s ?? ""] ?? "prospect";
}

// ijw staff role/systemRole → eywa system_role
const ROLE_MAP: Record<string, string> = {
  master: "master",
  admin: "admin",
  manager: "manager",
  math_lead: "manager",
  english_lead: "manager",
  math_teacher: "teacher",
  english_teacher: "teacher",
  teacher: "teacher",
  "강사": "teacher",
  staff: "viewer",
  user: "viewer",
};
export function mapSystemRole(staff: { systemRole?: string; role?: string }): string {
  return ROLE_MAP[staff.systemRole ?? ""] ?? ROLE_MAP[staff.role ?? ""] ?? "viewer";
}

const STAFF_STATUS_MAP: Record<string, string> = { active: "active", inactive: "inactive", resigned: "inactive" };
export function mapStaffStatus(s?: string): string {
  return STAFF_STATUS_MAP[s ?? ""] ?? "active";
}

// ijw 요일(한글) → eywa day_of_week enum
export const DAY_MAP: Record<string, string> = {
  "월": "mon", "화": "tue", "수": "wed", "목": "thu", "금": "fri", "토": "sat", "일": "sun",
};

// ── ID 리매핑 ──────────────────────────────────────────────────────
// Firestore string id → eywa uuid. 동일 firestore id는 항상 같은 uuid로(FK 보존).
export function makeIdMap() {
  const m = new Map<string, string>();
  return {
    get(firestoreId: string): string {
      let u = m.get(firestoreId);
      if (!u) { u = randomUUID(); m.set(firestoreId, u); }
      return u;
    },
    has: (k: string) => m.has(k),
    size: () => m.size,
  };
}
export type IdMap = ReturnType<typeof makeIdMap>;

// ── 행 변환 ────────────────────────────────────────────────────────
// eywa users 는 email NOT NULL UNIQUE(tenant,email) → 없으면 합성.
export function transformStaff(doc: any, tenantId: string, staffIds: IdMap) {
  return {
    id: staffIds.get(doc.id),
    tenant_id: tenantId,
    email: doc.email && doc.email.trim() ? doc.email : `${doc.id}@imported.local`,
    display_name: doc.name,
    system_role: mapSystemRole(doc),
    status: mapStaffStatus(doc.status),
    hire_date: doc.hireDate ?? null,
    subjects: Array.isArray(doc.subjects) ? doc.subjects : null,
    job_title: doc.jobTitle ?? null,
    phone: doc.phone ?? null,
    default_classroom: doc.defaultRoom ?? null,
  };
}

export function transformStudent(doc: any, tenantId: string, studentIds: IdMap, teacherUuid: string | null) {
  const status = mapStudentStatus(doc.status);
  const withdrawal =
    status === "withdrawn" && (doc.withdrawalReason || doc.withdrawalMemo)
      ? { reason: doc.withdrawalReason ?? null, memo: doc.withdrawalMemo ?? null }
      : null;
  return {
    id: studentIds.get(doc.id),
    tenant_id: tenantId,
    // name_normalized 는 generated → 절대 공급하지 않음
    name: doc.name,
    school: doc.school ?? null,
    grade: doc.grade ?? null,
    parent_phone: doc.parentPhone ?? null,
    parent_name: doc.parentName ?? null,
    status,
    primary_teacher_id: teacherUuid,
    enrolled_at: doc.startDate ?? null,
    withdrawn_at: status === "withdrawn" ? (doc.endDate ?? doc.withdrawalDate ?? null) : null,
    withdrawal_metadata: withdrawal,
    student_code: doc.studentCode ?? null,
    notes: doc.memo ?? null,
    // 프로필 확장(0027f) — ijw 필드 직결. gender는 male/female만(그 외 null), 나머지 텍스트/날짜 그대로.
    gender: doc.gender === "male" || doc.gender === "female" ? doc.gender : null,
    birth_date: normDate(doc.birthDate),
    parent_relation: doc.parentRelation ?? null,
    student_phone: doc.studentPhone ?? null,
    home_phone: doc.homePhone ?? null,
    other_phone: doc.otherPhone ?? null,
    address: doc.address ?? null,
    zip_code: doc.zipCode ?? null,
    address_detail: doc.addressDetail ?? null,
    email: doc.email ?? doc.studentEmail ?? null,
    nickname: doc.nickname ?? null,
    graduation_year: doc.graduationYear ?? null,
  };
}

// ijw classes.schedule[] → eywa class_schedules 행들(요일/시간 분해)
export function transformClass(doc: any, tenantId: string, classIds: IdMap, classroomUuid: string | null, teacherUuid: string | null) {
  const classRow = {
    id: classIds.get(doc.id),
    tenant_id: tenantId,
    class_name: doc.className,
    subject: doc.subject ?? "other",
    teacher_id: teacherUuid,
    classroom_id: classroomUuid,
    is_active: doc.isActive ?? true,
    notes: (doc.memo ?? null) as string | null, // ijw classes.memo → eywa classes.notes(반 메모)
  };
  const schedules = (doc.schedule ?? [])
    .map((s: any) => {
      const t = scheduleSlotTimes(s.day, s.periodId, doc.subject);
      if (!t) return null;
      return {
        id: randomUUID(),
        tenant_id: tenantId,
        class_id: classRow.id,
        day_of_week: DAY_MAP[s.day],
        start_time: t.start,
        end_time: t.end,
        valid_from: doc.validFrom ?? "2026-03-01",
        valid_to: null as string | null,
      };
    })
    .filter(Boolean) as Array<Record<string, any>>;
  return { classRow, schedules };
}

// 학생 문서의 enrollments[](v5 hierarchical/서브컬렉션) → eywa enrollments 행들
export function transformEnrollments(doc: any, tenantId: string, studentIds: IdMap, classIds: IdMap) {
  return (doc.enrollments ?? [])
    .filter((e: any) => e.classId && classIds.has(e.classId))
    .map((e: any) => ({
      id: randomUUID(),
      tenant_id: tenantId,
      student_id: studentIds.get(doc.id),
      class_id: classIds.get(e.classId),
      start_date: e.startDate ?? e.enrollmentDate ?? doc.startDate ?? "2026-03-01",
      end_date: e.endDate ?? e.withdrawalDate ?? null,
      on_hold: e.onHold ?? false,
      withdrawal_reason: e.cancelReason ?? null,
    }));
}
