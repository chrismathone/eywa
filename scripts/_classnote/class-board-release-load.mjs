// scripts/_classnote/class-board-release-load.mjs — 반 보드 자동 해제의 **조회부**(aywa DB 읽기만). 판정은 class-board-release.mjs(순수).
//
// 🔴 여기서 읽는 명단은 배정용 명단(loadAywa — 오늘 다니는 재원생)보다 **넓다**: 해제는 "이 반에 수강이 없다"가 근거라
//    휴원 중·아직 시작 전인 수강도 '이 반 학생'으로 센다(그 학생의 원아를 내보내지 않는다). 조회 실패는 throw —
//    빈 명단으로 삼키면 판정이 "명단이 비었다"로 보류하긴 하지만, 일부만 읽힌 명단은 해제로 이어진다.

import { SEAT_ALIAS_KEYS } from "./notify-axis.mjs";

const SEAT = new Set(SEAT_ALIAS_KEYS);
const kstToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });

/**
 * 반 → 수강 기록. open = **열린 수강**(종료일이 없거나 오늘 이후 — 시작 전·휴원 포함, 학생 상태 무관)이 있는 학생 ·
 * ended = 그 반 수강이 **끝난 기록**(종료일이 어제까지)이 있는 학생. 한 학생이 둘 다에 들 수 있다(나갔다가 다시 들어온 학생 — 판정은 open이 이긴다).
 * @returns {Promise<Map<string, {open:string[], ended:string[]}>>} 조회한 반은 전부 키로 든다(기록이 없으면 빈 배열).
 */
export async function loadClassEnrollments(sql, tenant, classIds) {
  const out = new Map(classIds.map((id) => [id, { open: [], ended: [] }]));
  if (!classIds.length) return out;
  const today = kstToday();
  const rows = await sql`
    select e.class_id, e.student_id,
      bool_or(e.end_date is null or e.end_date >= ${today}) as open,
      bool_or(e.end_date is not null and e.end_date < ${today}) as ended
    from enrollments e
    where e.tenant_id = ${tenant} and e.class_id = any(${classIds}) and e.student_id is not null
    group by e.class_id, e.student_id`;
  for (const r of rows) {
    const rec = out.get(r.class_id);
    if (!rec) continue;
    if (r.open) rec.open.push(r.student_id);
    if (r.ended) rec.ended.push(r.student_id);
  }
  return out;
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
