// scripts/_classnote/class-board-release-load.mjs — 반 보드 자동 해제의 **조회부**(aywa DB 읽기만). 판정은 class-board-release.mjs(순수).
//
// 영어 반 방·종강 반 보드·1인 보드(원장 2026-11-03)의 조회도 여기 있다 — 묶는 곳은 class-board-release-extra.mjs.
// 🔴 여기서 읽는 명단은 배정용 명단(loadAywa — 오늘 다니는 재원생)보다 **넓다**: 해제는 "이 반에 수강이 없다"가 근거라
//    휴원 중·아직 시작 전인 수강도 '이 반 학생'으로 센다(그 학생의 원아를 내보내지 않는다). 조회 실패는 throw —
//    빈 명단으로 삼키면 판정이 "명단이 비었다"로 보류하긴 하지만, 일부만 읽힌 명단은 해제로 이어진다.

import { SEAT_ALIAS_KEYS } from "./notify-axis.mjs";

const SEAT = new Set(SEAT_ALIAS_KEYS);
const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

/**
 * 반 → 수강 기록. open = **열린 수강**(종료일이 없거나 오늘 이후 — 시작 전·휴원 포함, 학생 상태 무관)이 있는 학생 ·
 * ended = 그 반 수강이 **끝난 기록**(종료일이 어제까지)이 있는 학생. 한 학생이 둘 다에 들 수 있다(나갔다가 다시 들어온 학생 — 판정은 open이 이긴다).
 * endedOn = 학생 → 그 반 수강이 **마지막으로 끝난 날**(해제 ④ 최근 7일 · ④-b 남길 보드 고르기).
 * @returns {Promise<Map<string, {open:string[], ended:string[], endedOn:Record<string,string>}>>} 조회한 반은 전부 키로 든다(기록이 없으면 빈 값).
 */
export async function loadClassEnrollments(sql, tenant, classIds) {
  const out = new Map(classIds.map((id) => [id, { open: [], ended: [], endedOn: {} }]));
  if (!classIds.length) return out;
  const today = kstToday();
  const rows = await sql`
    select e.class_id, e.student_id,
      bool_or(e.end_date is null or e.end_date >= ${today}) as open,
      bool_or(e.end_date is not null and e.end_date < ${today}) as ended,
      max(e.end_date) filter (where e.end_date is not null and e.end_date < ${today})::text as ended_on
    from enrollments e
    where e.tenant_id = ${tenant} and e.class_id = any(${classIds}) and e.student_id is not null
    group by e.class_id, e.student_id`;
  for (const r of rows) {
    const rec = out.get(r.class_id);
    if (!rec) continue;
    if (r.open) rec.open.push(r.student_id);
    if (r.ended) rec.ended.push(r.student_id);
    if (r.ended_on) rec.endedOn[r.student_id] = String(r.ended_on).slice(0, 10);
  }
  return out;
}

/**
 * 학생 → 과목별(수학 = math·subject_1 · 영어 = english) 열린 수강·끝난 기록 — 1인 보드 해제(원장 2026-11-03)의 단위가 '그 학생의 그 과목'이다.
 * 열린 수강 = 종료일이 없거나 오늘 이후(시작 전·휴원 포함 · 반의 종강·미발송 여부와 무관 — 모르면 다니는 것으로 본다).
 * endedOn = 그 과목 수강이 마지막으로 끝난 날(해제 ④·④-b).
 * @returns {Promise<Map<string, {math:{open:boolean, ended:boolean, endedOn:string|null}, english:{open:boolean, ended:boolean, endedOn:string|null}}>>}
 */
export async function loadSubjectEnrollments(sql, tenant) {
  const today = kstToday();
  const rows = await sql`
    select e.student_id,
      bool_or(c.subject in ('math', 'subject_1') and (e.end_date is null or e.end_date >= ${today})) as math_open,
      bool_or(c.subject in ('math', 'subject_1') and e.end_date is not null and e.end_date < ${today}) as math_ended,
      bool_or(c.subject = 'english' and (e.end_date is null or e.end_date >= ${today})) as english_open,
      bool_or(c.subject = 'english' and e.end_date is not null and e.end_date < ${today}) as english_ended,
      max(e.end_date) filter (where c.subject in ('math', 'subject_1') and e.end_date is not null and e.end_date < ${today})::text as math_ended_on,
      max(e.end_date) filter (where c.subject = 'english' and e.end_date is not null and e.end_date < ${today})::text as english_ended_on
    from enrollments e join classes c on c.id = e.class_id and c.tenant_id = e.tenant_id
    where e.tenant_id = ${tenant} and e.student_id is not null
    group by e.student_id`;
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  return new Map(rows.map((r) => [r.student_id, {
    math: { open: !!r.math_open, ended: !!r.math_ended, endedOn: day(r.math_ended_on) },
    english: { open: !!r.english_open, ended: !!r.english_ended, endedOn: day(r.english_ended_on) },
  }]));
}

/**
 * 0302a 연결이 남은 **종강** 수학 반(보고서 미발송 JJ 반은 11-04 되돌림 뒤 연결이 걷혀 사실상 빠진다) — 종강 반 보드 정리(원장 2026-11-03 · 종강 7일 뒤)의 대상 후보.
 * 판정(7일·보드가 살아 있나)은 class-board-release-targets.mjs `buildClosedPlans`.
 */
export async function loadClosedBoards(sql, tenant) {
  const today = kstToday();
  const rows = await sql`select c.id, c.class_name, c.closed_at::text as closed_at, b.board_id, b.board_name
    from classes c join classnote_class_boards b on b.tenant_id = c.tenant_id and b.class_id = c.id
    where c.tenant_id = ${tenant} and c.is_active and c.subject in ('math', 'subject_1')
      and c.closed_at is not null and c.closed_at < ${today}`;
  return rows.map((r) => ({ classId: r.id, className: r.class_name, closedAt: r.closed_at, boardId: Number(r.board_id), boardName: r.board_name }));
}

/**
 * 영어 반 ↔ 반 방 연결(s2_0006 — 사람이 확인한 것만) + 반 상태. 표가 아직 없으면(s2_0006 전 · 웹이 이 조회를 모름) null — 영어 반 방은 건너뛴다.
 * @returns {Promise<Array<{classId:string, className:string, boardId:number, boardName:string, isActive:boolean, closedAt:string|null}>|null>}
 */
export async function loadEnglishRooms(sql, tenant) {
  try {
    const rows = await sql`select b.class_id, b.board_id, b.board_name, c.class_name, c.is_active, c.closed_at::text as closed_at
      from classnote_english_class_boards b join classes c on c.tenant_id = b.tenant_id and c.id = b.class_id
      where b.tenant_id = ${tenant} and c.subject = 'english'`;
    return rows.map((r) => ({ classId: r.class_id, className: r.class_name, boardId: Number(r.board_id), boardName: r.board_name, isActive: !!r.is_active, closedAt: r.closed_at ?? null }));
  } catch (e) {
    if (e?.code === "42P01" || e?.code === "unknown_operation" || /42P01|does not exist/.test(String(e?.message ?? ""))) return null;
    throw e;
  }
}

/**
 * 열린 영어 수강(종료일이 없거나 오늘 이후 — 시작 전 포함) — 영어 반 방 해제에서 주인이 **방 연결이 없는 다른 영어 반**에 다니는지
 * 본다(리뷰 A6). 반이 폐지(비활성)됐어도 열린 수강이 남아 있으면 넣는다(리뷰 R8 — 모르면 보류 쪽).
 * 🔴 조회 실패는 throw(빈 목록이면 그 가드가 조용히 꺼진다 — 넓힌 대상 조회가 통째로 건너뛰어진다).
 * @returns {Promise<Array<{studentId:string, classId:string, className:string}>>}
 */
export async function loadOpenEnglish(sql, tenant) {
  const today = kstToday();
  const rows = await sql`select e.student_id, c.id as class_id, c.class_name
    from enrollments e join classes c on c.tenant_id = e.tenant_id and c.id = e.class_id
    where e.tenant_id = ${tenant} and e.student_id is not null and c.subject = 'english'
      and (e.end_date is null or e.end_date >= ${today})`;
  return rows.map((r) => ({ studentId: r.student_id, classId: r.class_id, className: r.class_name }));
}

/** 원아 id → 학생 id(0185a 원아 링크 — 원아 하나에 한 줄). */
export async function loadChildLinks(sql, tenant) {
  const rows = await sql`select child_id, student_id from classnote_child_links where tenant_id = ${tenant}`;
  return new Map(rows.map((r) => [Number(r.child_id), r.student_id]));
}

/**
 * 반 → 남길 선생님(aywa 표시 이름): 담임 · 예약된 새 담임(인수인계 대기) · 교시 담당(지금 유효하거나 앞으로 시작할 교시) ·
 * 위임(오늘 이후까지 걸린 것). 교시에 사람 id 없이 **이름만** 적힌 줄(slot_teacher_label)도 남길 사람으로 센다 —
 * 그 이름이 대응표에 없으면 판정이 그 반을 보류한다(모르면 빼지 않는다). 자리(LAB·JJ) 라벨은 사람이 아니라 뺀다.
 * @returns {Promise<Map<string, { homeroom: string|null, homeroomActive: boolean, keepNames: string[] }>>}
 */
export async function loadClassTeachers(sql, tenant, classIds) {
  const out = new Map();
  if (!classIds.length) return out;
  const today = kstToday();
  const [classes, slots, delegations] = await Promise.all([
    sql`select id, teacher_id, pending_teacher_id from classes where tenant_id = ${tenant} and id = any(${classIds})`,
    sql`select distinct class_id, teacher_id, slot_teacher_label from class_schedules
        where tenant_id = ${tenant} and class_id = any(${classIds})
          and (teacher_id is not null or slot_teacher_label is not null)
          and (valid_to is null or valid_to >= ${today}::date)`,
    sql`select distinct class_id, delegate_user_id from class_delegations
        where tenant_id = ${tenant} and class_id = any(${classIds}) and revoked_at is null and to_date >= ${today}::date`,
  ]);
  const people = new Map(
    classes.map((c) => [c.id, { homeroomId: c.teacher_id ?? null, ids: new Set([c.teacher_id, c.pending_teacher_id].filter(Boolean)), labels: new Set() }]),
  );
  for (const s of slots) {
    const p = people.get(s.class_id);
    if (!p) continue;
    if (s.teacher_id) p.ids.add(s.teacher_id);
    else {
      const label = String(s.slot_teacher_label ?? "").trim();
      if (label && !SEAT.has(label.toLowerCase())) p.labels.add(label);
    }
  }
  for (const d of delegations) if (d.delegate_user_id) people.get(d.class_id)?.ids.add(d.delegate_user_id);
  const userIds = [...new Set([...people.values()].flatMap((p) => [...p.ids]))];
  const users = userIds.length
    ? new Map((await sql`select id, display_name, status::text as status from users where tenant_id = ${tenant} and id = any(${userIds})`).map((u) => [u.id, u]))
    : new Map();
  // 이름을 못 읽은 사람은 '(이름 없음)'으로 남긴다 — 판정이 "대응표에 없는 담당"으로 보고 그 반을 보류한다.
  const nameOf = (id) => (users.get(id)?.display_name ?? "").trim() || "(이름 없음)";
  for (const [classId, p] of people) {
    out.set(classId, {
      homeroom: p.homeroomId ? nameOf(p.homeroomId) : null,
      homeroomActive: p.homeroomId ? users.get(p.homeroomId)?.status === "active" : false,
      keepNames: [...new Set([...[...p.ids].map(nameOf), ...p.labels])],
    });
  }
  return out;
}
