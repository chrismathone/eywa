// scripts/_classnote/notify-recipients-db.mjs — 학부모 글·댓글 벨 수신자 계산의 **조회 쪽**(판정은 notify-recipients.mjs).
//
// 두 갈래가 합의해야 보낸다(원장 2026-09-30 *"가드를 좀 제법 쳐서 알림 이상하게 가지 않도록 해"*):
//   · 계산 = 행을 받아 JS 순수 판정(isCurrentEnrollment·classTeachersNow)으로 고른다.
//   · 재검증 = 같은 규칙을 **SQL 한 문장으로 다시** 적어 (학생|반, 사람) 짝을 확인한다 — 한쪽 결함이 곧바로 오발송이 되지 않게.
// 성능: 알릴 글이 있을 때만 돈다(수학 학부모 글·댓글은 하루 몇 건). id 목록은 배열 파라미터 하나(`= any(배열)` —
// URL·414와 무관, postgres 직결이라 PostgREST 1000행 절단도 없다). 독립 조회는 Promise.all.
import { NOTIFY_RECIPIENT_CAP, classWideRecipients, finalizeRecipients, planNotifyRecipients } from "./notify-recipients.mjs";

/** 벨 수신자 조회 한 문장의 상한(ms). 넘으면 실패로 떨어져 호출부가 지금 반 담임 폴백으로 간다. */
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

/** 반 → { subject, isActive, homeroomTeacherId, slots } — 슬롯은 오늘 유효할 수 있는 행만(판정은 순수 쪽이 다시 본다). */
async function loadClasses(sql, tenant, classIds, today) {
  if (!classIds.length) return new Map();
  const [rows, slots] = await Promise.all([
    sql`select id, subject, is_active, teacher_id from classes where tenant_id = ${tenant} and id = any(${classIds})`,
    sql`select class_id, teacher_id, slot_teacher_label, valid_from::text as valid_from, valid_to::text as valid_to
        from class_schedules
        where tenant_id = ${tenant} and class_id = any(${classIds})
          and valid_from <= ${today}::date and (valid_to is null or valid_to >= ${today}::date)`,
  ]);
  const out = new Map(
    rows.map((r) => [r.id, { subject: r.subject ?? null, isActive: r.is_active === true, homeroomTeacherId: r.teacher_id ?? null, slots: [] }]),
  );
  for (const s of slots) {
    out.get(s.class_id)?.slots.push({
      teacherId: s.teacher_id ?? null, slotTeacherLabel: s.slot_teacher_label ?? null, validFrom: s.valid_from, validTo: s.valid_to ?? null,
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
      and from_date <= ${today}::date and to_date >= ${today}::date`;
  return rows.map((r) => ({ classId: r.class_id, delegateUserId: r.delegate_user_id, fromDate: r.from_date, toDate: r.to_date, revokedAt: r.revoked_at }));
}

async function loadUsers(sql, tenant, ids) {
  if (!ids.length) return new Map();
  const rows = await sql`select id, tenant_id, status::text as status, system_role::text as role from users where tenant_id = ${tenant} and id = any(${ids})`;
  return new Map(rows.map((r) => [r.id, { tenantId: r.tenant_id, active: r.status === "active", role: r.role }]));
}

function peopleOf(classes, delegations) {
  const people = new Set(delegations.map((d) => d.delegateUserId));
  for (const c of classes.values()) {
    if (c.homeroomTeacherId) people.add(c.homeroomTeacherId);
    for (const s of c.slots) if (s.teacherId) people.add(s.teacherId);
  }
  return [...people];
}

function candidatesOf(planned) {
  const ids = new Set();
  for (const p of planned.values()) for (const id of [...p.ids, ...p.homerooms]) ids.add(id);
  return [...ids];
}

/**
 * (2) 재검증 — 학생 × 사람 짝을 **계산과 다른 한 문장**으로 확인한다. 같은 지점 · 활성 · 학생 계정 아님 ·
 * 오늘 다니는 보드 과목 운영 반의 담임 / 오늘 유효한 교시 담당 / 오늘 위임 중 하나.
 * 수강 종료 규약은 SQL로 다시 적는다(반이동 = 종료일 당일부터 끝 · 일반 종료 = 종료일까지 다닌다 — 앱 isEnrollmentEndedOn).
 */
export async function loadVerifiedStudentPairs(sql, tenant, studentIds, candidateIds, keys, today) {
  if (!studentIds.length || !candidateIds.length) return new Set();
  const rows = await sql`
    select distinct e.student_id, u.id as user_id
    from enrollments e
    join classes c on c.id = e.class_id and c.tenant_id = e.tenant_id and c.is_active and c.subject in ${sql(keys)}
    join users u on u.tenant_id = e.tenant_id and u.id = any(${candidateIds})
      and u.status = 'active' and u.system_role <> 'student'
    where e.tenant_id = ${tenant} and e.student_id = any(${studentIds})
      and e.start_date <= ${today}::date
      and (e.end_date is null or e.end_date > ${today}::date or (e.end_date = ${today}::date and not e.is_transferred))
      and (
        c.teacher_id = u.id
        or exists (select 1 from class_schedules s where s.tenant_id = e.tenant_id and s.class_id = c.id and s.teacher_id = u.id
                   and s.valid_from <= ${today}::date and (s.valid_to is null or s.valid_to >= ${today}::date))
        or exists (select 1 from class_delegations d where d.tenant_id = e.tenant_id and d.class_id = c.id and d.delegate_user_id = u.id
                   and d.revoked_at is null and d.from_date <= ${today}::date and d.to_date >= ${today}::date)
      )`;
  return new Set(rows.map((r) => `${r.student_id}|${r.user_id}`));
}

/** (2) 재검증(반 전체 글) — 반 × 사람. 같은 지점 · 활성 · 학생 계정 아님 · 운영 중 보드 과목 반의 오늘 담당. */
export async function loadVerifiedClassPairs(sql, tenant, classIds, candidateIds, keys, today) {
  if (!classIds.length || !candidateIds.length) return new Set();
  const rows = await sql`
    select distinct c.id as class_id, u.id as user_id
    from classes c
    join users u on u.tenant_id = c.tenant_id and u.id = any(${candidateIds})
      and u.status = 'active' and u.system_role <> 'student'
    where c.tenant_id = ${tenant} and c.id = any(${classIds}) and c.is_active and c.subject in ${sql(keys)}
      and (
        c.teacher_id = u.id
        or exists (select 1 from class_schedules s where s.tenant_id = c.tenant_id and s.class_id = c.id and s.teacher_id = u.id
                   and s.valid_from <= ${today}::date and (s.valid_to is null or s.valid_to >= ${today}::date))
        or exists (select 1 from class_delegations d where d.tenant_id = c.tenant_id and d.class_id = c.id and d.delegate_user_id = u.id
                   and d.revoked_at is null and d.from_date <= ${today}::date and d.to_date >= ${today}::date)
      )`;
  return new Set(rows.map((r) => `${r.class_id}|${r.user_id}`));
}

/**
 * 학생별 받는 사람(1차 계산 → 재검증 → 상한). 조회 실패는 throw(호출부가 지금 반 담임 폴백).
 * @param {string[]} keys 보드 과목 키(수학 = ["math","subject_1"]) — 다른 과목 반 담당은 끼지 않는다.
 * @returns {Promise<Map<string,{ids:string[], blocked:{subject:number,verify:number,cap:number}, narrowed:boolean}>>}
 */
export async function computeNotifyRecipients(sql, tenant, studentIds, keys, { today = kstToday(), cap = NOTIFY_RECIPIENT_CAP } = {}) {
  if (!tenant) throw new Error("지점(tenant)을 모르고는 수신자를 계산하지 않습니다");
  if (!studentIds.length) return new Map();
  // 수강 프리필터 — 종료일 **당일 포함**(반이동 당일 판정은 순수 쪽 isCurrentEnrollment가 한다, [[#125]]). 과목은 거르지 않는다(과목 가드가 센다).
  const enrolled = await sql`
    select e.student_id, e.class_id, e.start_date::text as start_date, e.end_date::text as end_date, e.is_transferred
    from enrollments e
    where e.tenant_id = ${tenant} and e.student_id = any(${studentIds})
      and e.start_date <= ${today}::date and (e.end_date is null or e.end_date >= ${today}::date)`;
  const classIds = [...new Set(enrolled.map((r) => r.class_id))];
  const [classes, delegations] = await Promise.all([loadClasses(sql, tenant, classIds, today), loadDelegations(sql, tenant, classIds, today)]);
  const users = await loadUsers(sql, tenant, peopleOf(classes, delegations));
  const planned = planNotifyRecipients({
    studentIds,
    enrollments: enrolled.map((r) => ({
      studentId: r.student_id, classId: r.class_id, startDate: r.start_date, endDate: r.end_date ?? null, isTransferred: r.is_transferred === true,
    })),
    classes, delegations, users, keys, tenant, today,
  });
  const verified = await loadVerifiedStudentPairs(sql, tenant, studentIds, candidatesOf(planned), keys, today);
  return finalizeRecipients(planned, verified, cap);
}

/** 반 id들 → 지금 그 반을 맡은 사람(반 전체 글용, 1차 계산 → 재검증 → 상한). */
export async function computeClassWideRecipients(sql, tenant, classIds, keys, { today = kstToday(), cap = NOTIFY_RECIPIENT_CAP } = {}) {
  if (!tenant) throw new Error("지점(tenant)을 모르고는 수신자를 계산하지 않습니다");
  if (!classIds.length) return new Map();
  const [classes, delegations] = await Promise.all([loadClasses(sql, tenant, classIds, today), loadDelegations(sql, tenant, classIds, today)]);
  const users = await loadUsers(sql, tenant, peopleOf(classes, delegations));
  const planned = new Map(
    classIds.map((id) => [
      id,
      classWideRecipients({ classInfo: classes.get(id), delegations: delegations.filter((d) => d.classId === id), users, keys, tenant, today }),
    ]),
  );
  const verified = await loadVerifiedClassPairs(sql, tenant, classIds, candidatesOf(planned), keys, today);
  return finalizeRecipients(planned, verified, cap);
}

/**
 * 수학 **반 보드** → 반(0302a) — 학생을 못 정한 글을 그 반 담당에게 보내기 위한 지도. 키 = `#보드번호`만.
 * (5) 반 전체 글 가드: 🔴 보드 이름으로는 잇지 않는다 · 한 번호가 두 반을 가리키면(유니크 인덱스가 막지만) 비운다(null).
 * 종강 반 보드도 지도에는 싣는다 — 수신자 계산이 빈손으로 돌려 '반 담당 강사 없음' 보류로 **로그에 남게**(조용히 사라지지 않게).
 */
export async function loadClassBoardClasses(sql, tenant, keys) {
  const rows = await sql`
    select b.board_id, b.board_name, b.class_id from classnote_class_boards b
    join classes c on c.id = b.class_id and c.tenant_id = b.tenant_id
    where b.tenant_id = ${tenant} and c.subject in ${sql(keys)}`;
  const map = new Map();
  for (const r of rows) {
    const key = `#${Number(r.board_id)}`;
    const v = { classId: r.class_id, boardName: r.board_name };
    map.set(key, map.has(key) && map.get(key)?.classId !== r.class_id ? null : v);
  }
  return map;
}

/**
 * 반 보드 지도에서 글의 반 찾기 — **보드 번호(`cls`)로만**.
 * @returns {{board:{classId:string, boardName:string}|null, blocked:string|null}}
 *   board=null·blocked=null → 수학 반 보드 글이 아니다(영어·그룹반 — 종전처럼 조용히 지나간다).
 */
export function classBoardClassOf(map, { cls }) {
  if (cls == null || cls === "") return { board: null, blocked: "보드 번호 없음" };
  const key = `#${Number(cls)}`;
  if (!map.has(key)) return { board: null, blocked: null };
  const v = map.get(key);
  return v ? { board: v, blocked: null } : { board: null, blocked: "보드↔반 연결이 하나가 아님" };
}
