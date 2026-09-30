/**
 * 답글 권한(0317a) = **학부모 글·댓글 벨 수신자와 같은 판정**(원장 2026-09-30 정정: '현재 담당 중인 선생님'만).
 * 판정 본체는 워커의 순수 함수 [`planNotifyRecipients`·`classWideRecipients`·`finalizeRecipients`](../../../scripts/_classnote/notify-recipients.mjs)를
 * **그대로** 부른다 — 여기는 DB 행 → 그 함수 입력으로 바꾸는 얇은 어댑터뿐이다(한 벌: 규칙이 바뀌면 워커 모듈만 고친다).
 *   · 오늘 다니는 수강 = `isCurrentEnrollment`(시작일 ≤ 오늘 · 안 끝남 · 반이동 당일은 새 반만, [[#125]])
 *   · 보드와 같은 과목 · 운영 중(is_active) 반의 담임 · 오늘 유효한 교시 담당 · 오늘 위임 · 같은 지점 활성 비학생 계정
 *   · 상한(5명 넘으면 담임만)도 벨과 같이 건다. 벨의 '재검증 쿼리' 겹은 발송 오배달 방어라 여기엔 없다(권한은 서버가 매번 다시 계산).
 * 원장·관리자·매니저는 이 판정과 별개로 전부 답할 수 있다(호출부 `isReplyManager`).
 */
import { isCurrentEnrollment } from "../../../scripts/_classnote/notify-axis.mjs";
import { classWideRecipients, finalizeRecipients, planNotifyRecipients } from "../../../scripts/_classnote/notify-recipients.mjs";

export type EnrollmentRow = { class_id: string; start_date: string | null; end_date: string | null; is_transferred: boolean | null };
export type ClassRow = { id: string; subject: string | null; is_active: boolean; teacher_id: string | null };
export type SlotRow = { class_id: string; day_of_week: string; start_time: string; teacher_id: string | null; slot_teacher_label: string | null; valid_from: string; valid_to: string | null };
export type DelegationRow = { class_id: string; delegate_user_id: string; from_date: string; to_date: string; revoked_at: string | null };
export type UserRow = { id: string; tenant_id: string; status: string; system_role: string };

type ClassInfo = { subject: string; isActive: boolean; homeroomTeacherId: string | null; slots: unknown[] };

export function toClassInfos(classes: ClassRow[], slots: SlotRow[]): Map<string, ClassInfo> {
  const map = new Map<string, ClassInfo>(classes.map((c) => [c.id, { subject: c.subject ?? "", isActive: c.is_active === true, homeroomTeacherId: c.teacher_id, slots: [] }]));
  for (const s of slots)
    map.get(s.class_id)?.slots.push({
      dayOfWeek: s.day_of_week, startTime: s.start_time, teacherId: s.teacher_id, slotTeacherLabel: s.slot_teacher_label, validFrom: s.valid_from, validTo: s.valid_to,
    });
  return map;
}

const toDelegations = (rows: DelegationRow[]) =>
  rows.map((d) => ({ classId: d.class_id, delegateUserId: d.delegate_user_id, fromDate: d.from_date, toDate: d.to_date, revokedAt: d.revoked_at }));
const toUsers = (rows: UserRow[]) => new Map(rows.map((u) => [u.id, { tenantId: u.tenant_id, active: u.status === "active", role: u.system_role }]));

/** 오늘 다니는 수강의 반 — 벨 수신자 판정과 같은 함수(미래 시작·끝난 수강·반이동 당일 옛 반 제외, [[#125]]). */
export function currentClassIds(enrollments: EnrollmentRow[], today: string): string[] {
  const ids = enrollments
    .filter((e) => isCurrentEnrollment({ startDate: e.start_date ?? "", endDate: e.end_date, isTransferred: e.is_transferred === true }, today))
    .map((e) => e.class_id);
  return [...new Set(ids)];
}

/** 판정에 필요한 사람 id(담임·교시 담당·위임) — 계정 상태를 이 사람들만 읽는다. */
export function candidatePeople(classes: ClassRow[], slots: SlotRow[], delegations: DelegationRow[]): string[] {
  const ids = new Set<string>();
  for (const c of classes) if (c.teacher_id) ids.add(c.teacher_id);
  for (const s of slots) if (s.teacher_id) ids.add(s.teacher_id);
  for (const d of delegations) if (d.delegate_user_id) ids.add(d.delegate_user_id);
  return [...ids];
}

/** 그 학생 학부모 글의 벨을 받는 사람(= 답글 자격, 관리자급 제외). */
export function studentReplyTeachers(a: {
  studentId: string; enrollments: EnrollmentRow[]; classes: ClassRow[]; slots: SlotRow[]; delegations: DelegationRow[];
  users: UserRow[]; keys: string[]; tenant: string; today: string;
}): string[] {
  const planned = planNotifyRecipients({
    studentIds: [a.studentId],
    enrollments: a.enrollments.map((e) => ({ studentId: a.studentId, classId: e.class_id, startDate: e.start_date ?? "", endDate: e.end_date, isTransferred: e.is_transferred === true })),
    classes: toClassInfos(a.classes, a.slots),
    delegations: toDelegations(a.delegations),
    users: toUsers(a.users),
    keys: a.keys,
    tenant: a.tenant,
    today: a.today,
  }) as Map<string, { ids: string[]; homerooms: string[] }>;
  return finalOf(planned, a.studentId);
}

/** 학생을 정하지 못한 반 보드 글 — 그 반을 지금 맡은 사람. */
export function classReplyTeachers(a: {
  classId: string; classes: ClassRow[]; slots: SlotRow[]; delegations: DelegationRow[]; users: UserRow[]; keys: string[]; tenant: string; today: string;
}): string[] {
  const one = classWideRecipients({
    classInfo: toClassInfos(a.classes, a.slots).get(a.classId),
    // 워커 함수의 기본값(`= []`)이 JSDoc 없이 never[]로 추론된다 — 값은 planNotifyRecipients와 같은 모양이다.
    delegations: toDelegations(a.delegations.filter((d) => d.class_id === a.classId)) as never[],
    users: toUsers(a.users),
    keys: a.keys,
    tenant: a.tenant,
    today: a.today,
  }) as { ids: string[]; homerooms: string[] };
  return finalOf(new Map([[a.classId, one]]), a.classId);
}

function finalOf(planned: Map<string, { ids: string[]; homerooms: string[] }>, key: string): string[] {
  const all = new Set<string>();
  for (const [k, p] of planned) for (const id of p.ids) all.add(`${k}|${id}`);
  const fin = finalizeRecipients(planned, all) as Map<string, { ids: string[] }>;
  return fin.get(key)?.ids ?? [];
}
