// scripts/_classnote/notify-recipients-db.mjs — 학부모 글·댓글 벨 수신자 계산의 **조회 쪽**(판정은 notify-recipients.mjs).
//
// 성능: 알릴 글이 있을 때만 돈다(수학 학부모 글·댓글은 하루 몇 건). 학생 id 목록으로 **한 번씩** 묻고(`= any(배열)` —
// 파라미터 하나라 URL 길이·414와 무관, postgres 직결이라 PostgREST 1000행 절단도 없다), 독립 조회는 Promise.all.
// 출결은 그 학생·그 과목·수업 받은 칸만 `distinct`로 받는다(학생당 수백 행 규모).
import { transitionClassId, uniqueClassNameIndex } from "./notify-axis.mjs";
import { TAUGHT_STATUSES, classWideRecipients, planNotifyRecipients } from "./notify-recipients.mjs";

/** 벨 수신자 조회 한 문장의 상한(ms) — 실측 전 재원 196명 690ms. 넘으면 실패로 떨어져 호출부가 지금 담당으로 폴백한다. */
export const NOTIFY_QUERY_TIMEOUT_MS = 10_000;

/**
 * 읽기 전용 + 문장당 시간 제한 트랜잭션으로 `fn(tx)`를 돌린다.
 * 🔴 데몬은 DB 연결이 **하나**(max:1)라 느린 조회 하나가 발송·공지까지 붙잡는다 — JS 쪽 타임아웃으로는 연결이 안 풀려서
 *    서버 쪽 `statement_timeout`으로 끊는다(끊기면 트랜잭션째 실패 → 호출부 catch → 폴백). 읽기 전용이라 이 경로는 쓰지도 못한다.
 * ⚠️ `fn` 안에서는 반드시 `tx`만 쓸 것 — 바깥 `sql`을 쓰면 연결 하나를 트랜잭션이 쥐고 있어 영영 기다린다.
 */
export function readOnlyWithTimeout(sql, fn, ms = NOTIFY_QUERY_TIMEOUT_MS) {
  return sql.begin("read only", async (tx) => {
    await tx`select set_config('statement_timeout', ${String(Math.max(1, Math.floor(ms)))}, true)`;
    return fn(tx);
  });
}

export function kstToday(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

function kstDateOf(v) {
  const d = v instanceof Date ? v : typeof v === "string" && v.trim() ? new Date(v) : null;
  return d && !Number.isNaN(d.getTime()) ? kstToday(d) : null;
}

/** 반 → { homeroomTeacherId, slots } — 슬롯은 이력 포함 전 행(유효기간은 순수 판정이 본다). */
async function loadClasses(sql, tenant, classIds) {
  if (!classIds.length) return new Map();
  const [rows, slots] = await Promise.all([
    sql`select id, teacher_id from classes where tenant_id = ${tenant} and id = any(${classIds})`,
    sql`select class_id, day_of_week::text as dow, start_time::text as start_time, teacher_id, slot_teacher_label,
          valid_from::text as valid_from, valid_to::text as valid_to
        from class_schedules where tenant_id = ${tenant} and class_id = any(${classIds})`,
  ]);
  const out = new Map(rows.map((r) => [r.id, { homeroomTeacherId: r.teacher_id ?? null, slots: [] }]));
  for (const s of slots) {
    out.get(s.class_id)?.slots.push({
      dayOfWeek: s.dow, startTime: s.start_time, teacherId: s.teacher_id ?? null,
      slotTeacherLabel: s.slot_teacher_label ?? null, validFrom: s.valid_from, validTo: s.valid_to ?? null,
    });
  }
  return out;
}

async function loadDelegations(sql, tenant, classIds, today) {
  if (!classIds.length) return [];
  const rows = await sql`
    select class_id, delegate_user_id, from_date::text as from_date, to_date::text as to_date, revoked_at
    from class_delegations
    where tenant_id = ${tenant} and class_id = any(${classIds}) and revoked_at is null
      and from_date <= ${today} and to_date >= ${today}`;
  return rows.map((r) => ({ classId: r.class_id, delegateUserId: r.delegate_user_id, fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }));
}

/** 담임 전이(인수인계 적용·폼 담임 변경 감사로그) — 앱 teacher-as-of-queries `loadTeacherTransitions`와 같은 원자료·규칙. */
async function loadTransitions(sql, tenant) {
  const [logs, names] = await Promise.all([
    sql`select metadata, target_label, created_at from audit_logs
        where tenant_id = ${tenant} and action in ('class_handover_apply', 'class_update')
          and metadata->>'newTeacherId' is not null`,
    sql`select id, class_name as name from classes where tenant_id = ${tenant}`,
  ]);
  const byName = uniqueClassNameIndex(names);
  return logs
    .map((l) => ({
      classId: transitionClassId({ metaClassId: l.metadata?.classId, targetLabel: l.target_label }, byName) ?? "",
      date: kstDateOf(l.metadata?.effectiveDate) ?? kstDateOf(l.created_at) ?? "",
      teacherId: l.metadata?.newTeacherId ?? null,
      previousTeacherId: typeof l.metadata?.previousTeacherId === "string" ? l.metadata.previousTeacherId : null,
    }))
    .filter((t) => t.classId && t.teacherId && t.date);
}

async function loadUsers(sql, tenant, ids) {
  if (!ids.length) return new Map();
  const rows = await sql`select id, status::text as status, system_role::text as role, display_name from users where tenant_id = ${tenant} and id = any(${ids})`;
  return new Map(rows.map((r) => [r.id, { active: r.status === "active", role: r.role, name: r.display_name ?? null }]));
}

/**
 * 학생별 받는 사람 — ① 지금 반의 담임·교시 담당·위임 ∪ ② 한 번이라도 가르친 사람(보고서 작성자·출결 귀속).
 * @param {string[]} keys 보드 과목 키(수학 = ["math","subject_1"]) — 다른 과목 강사는 끼지 않는다.
 * @returns {Promise<Map<string,string[]>>}
 */
export async function loadNotifyRecipients(sql, tenant, studentIds, keys, { today = kstToday() } = {}) {
  if (!studentIds.length) return new Map();
  const [enrolled, authors, attended, teaching] = await Promise.all([
    sql`select distinct e.student_id, e.class_id from enrollments e
        join classes c on c.id = e.class_id and c.tenant_id = ${tenant} and c.is_active
        where e.tenant_id = ${tenant} and e.end_date is null and e.student_id = any(${studentIds}) and c.subject in ${sql(keys)}`,
    // 과목 칸이 빈 옛 보고서(0083a 이전)는 반의 과목으로 본다.
    sql`select distinct r.student_id, r.created_by from lesson_reports r
        left join classes c on c.id = r.class_id and c.tenant_id = r.tenant_id
        where r.tenant_id = ${tenant} and r.student_id = any(${studentIds}) and r.created_by is not null
          and coalesce(r.subject, c.subject) in ${sql(keys)}`,
    sql`select distinct a.student_id, a.class_id, a.session_date::text as date, a.slot_start::text as slot_start
        from attendance_records a join classes c on c.id = a.class_id and c.tenant_id = ${tenant}
        where a.tenant_id = ${tenant} and a.student_id = any(${studentIds}) and c.subject in ${sql(keys)}
          and a.status::text in ${sql(TAUGHT_STATUSES)}
          -- 자리(LAB·JJ) 문이 찍은 행은 어느 강사 몫도 아니다(앱 ownsAttendanceSlot과 같은 규칙)
          and coalesce(trim(a.seat_label), '') = '' and coalesce(a.recorded_via, '') <> 'seat'`,
    // 지금 그 과목 반을 맡은 사람(담임·유효 교시 담당) — 대리 작성자를 가르는 기준.
    sql`select c.teacher_id as id from classes c where c.tenant_id = ${tenant} and c.is_active and c.subject in ${sql(keys)} and c.teacher_id is not null
        union
        select s.teacher_id from class_schedules s join classes c on c.id = s.class_id and c.tenant_id = ${tenant} and c.is_active
        where s.tenant_id = ${tenant} and c.subject in ${sql(keys)} and s.teacher_id is not null and (s.valid_to is null or s.valid_to >= ${today})`,
  ]);
  const currentIds = [...new Set(enrolled.map((r) => r.class_id))];
  const attendedIds = [...new Set(attended.map((r) => r.class_id))];
  const classIds = [...new Set([...currentIds, ...attendedIds])];
  const [classes, delegations, transitions, monthWriters] = await Promise.all([
    loadClasses(sql, tenant, classIds),
    loadDelegations(sql, tenant, currentIds, today),
    loadTransitions(sql, tenant),
    loadClassMonthWriters(sql, tenant, attendedIds, keys),
  ]);
  const people = new Set([
    ...authors.map((r) => r.created_by),
    ...delegations.map((d) => d.delegateUserId),
    ...monthWriters.map((w) => w.userId).filter(Boolean),
  ]);
  for (const c of classes.values()) {
    if (c.homeroomTeacherId) people.add(c.homeroomTeacherId);
    for (const s of c.slots) if (s.teacherId) people.add(s.teacherId);
  }
  for (const t of transitions) if (classes.has(t.classId)) [t.teacherId, t.previousTeacherId].forEach((id) => id && people.add(id));
  const users = await loadUsers(sql, tenant, [...people]);
  return planNotifyRecipients({
    studentIds,
    currentEnrollments: enrolled.map((r) => ({ studentId: r.student_id, classId: r.class_id })),
    reportAuthors: authors.map((r) => ({ studentId: r.student_id, userId: r.created_by })),
    attended: attended.map((r) => ({ studentId: r.student_id, classId: r.class_id, date: r.date, slotStart: r.slot_start ?? null })),
    classes,
    delegations,
    transitions,
    classMonthWriters: monthWriters,
    users,
    teachingIds: new Set(teaching.map((r) => r.id)),
    today,
  });
}

/**
 * 출결이 나온 반의 반·달별 보고서 작성자 id·강사 이름 — 인계 기록 없는 반의 현재 담임 폴백을 가리는 근거(notify-recipients (b')).
 * 이름도 받는 이유: 이관분 보고서(2~7월)는 작성자(created_by)가 비고 `teacher_name`만 남아 있다(실측 수학 6,903행).
 * 규모: 반 수 × 달 × 작성자 1~2명(수백 행 이하). postgres 직결이라 1000행 절단 없음.
 */
async function loadClassMonthWriters(sql, tenant, classIds, keys) {
  if (!classIds.length) return [];
  const rows = await sql`
    select distinct r.class_id, to_char(r.report_date, 'YYYY-MM') as month, r.created_by, nullif(trim(r.teacher_name), '') as teacher_name
    from lesson_reports r join classes c on c.id = r.class_id and c.tenant_id = r.tenant_id and c.subject in ${sql(keys)}
    where r.tenant_id = ${tenant} and r.class_id = any(${classIds})
      and (r.created_by is not null or nullif(trim(r.teacher_name), '') is not null)`;
  return rows.map((r) => ({ classId: r.class_id, month: r.month, userId: r.created_by ?? null, teacherName: r.teacher_name ?? null }));
}

/**
 * 수학 **반 보드** → 반(0302a) — 학생을 못 정한 글을 그 반 담당에게 보내기 위한 지도.
 * 키 = `#보드번호`(기준) · `이름:보드명`(번호가 없는 행의 폴백). 보드 과목 = 반 과목이라 keys로 거른다.
 */
export async function loadClassBoardClasses(sql, tenant, keys) {
  const rows = await sql`
    select b.board_id, b.board_name, b.class_id from classnote_class_boards b
    join classes c on c.id = b.class_id and c.tenant_id = b.tenant_id
    where b.tenant_id = ${tenant} and c.subject in ${sql(keys)}`;
  const map = new Map();
  for (const r of rows) {
    const v = { classId: r.class_id, boardName: r.board_name };
    map.set(`#${Number(r.board_id)}`, v); // 번호는 (tenant, board_id) 유일
    // 이름은 유일하지 않을 수 있다 — 두 반이 같은 보드명이면 비운다(잘못 붙이느니 안 보낸다).
    const nameKey = `이름:${r.board_name}`;
    map.set(nameKey, map.has(nameKey) && map.get(nameKey)?.classId !== r.class_id ? null : v);
  }
  return map;
}

/** 반 보드 지도에서 글의 반 찾기 — 번호(`cls`)가 있으면 번호로만(개명 감사 G4와 같은 규약). */
export function classBoardClassOf(map, { cls, className }) {
  if (cls != null && cls !== "") return map.get(`#${Number(cls)}`) ?? null;
  return map.get(`이름:${className}`) ?? null;
}

/** 반 id들 → 지금 그 반을 맡은 활성 강사(반 전체 글용). */
export async function loadClassWideRecipients(sql, tenant, classIds, { today = kstToday() } = {}) {
  if (!classIds.length) return new Map();
  const [classes, delegations] = await Promise.all([loadClasses(sql, tenant, classIds), loadDelegations(sql, tenant, classIds, today)]);
  const people = new Set(delegations.map((d) => d.delegateUserId));
  for (const c of classes.values()) {
    if (c.homeroomTeacherId) people.add(c.homeroomTeacherId);
    for (const s of c.slots) if (s.teacherId) people.add(s.teacherId);
  }
  const users = await loadUsers(sql, tenant, [...people]);
  const out = new Map();
  for (const id of classIds) {
    out.set(id, classWideRecipients({ classInfo: classes.get(id), delegations: delegations.filter((d) => d.classId === id), users, today }));
  }
  return out;
}
