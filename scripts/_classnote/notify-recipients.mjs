// scripts/_classnote/notify-recipients.mjs — 학부모 글·댓글 벨을 **받을 사람** 계산(순수, Vitest).
//
// 원장 2026-09-30 정정: *"'현재 담당 중인 선생님'에게만 알림이 가면 되는 것."* (같은 날 올린 "한 번이라도 가르친 강사까지"를 뒤집음)
//   + *"가드를 좀 제법 쳐서 알림 이상하게 가지 않도록 해."*
//
// 받는 사람 = 그 학생이 **오늘 다니는**(isCurrentEnrollment — 시작일 ≤ 오늘 · 안 끝남 · 반이동 당일은 새 반만)
//   **보드와 같은 과목·운영 중(is_active)** 반들의
//   ① 담임(classes.teacher_id) ② 오늘 유효한 교시 담당(부담임, class_schedules valid_from~valid_to) ③ 오늘 임시 위임 강사.
//   같은 지점 · 활성 계정 · 학생 계정 아님 · 중복 없음.
// 🔴 보고서 작성자·출결 귀속·담임 이력 복원으로 넓히지 않는다 — 가르친 적이 있어도 지금 담당이 아니면 받지 않는다.
//
// 가드(각각 Vitest로 잠근다 — 숫자는 워커 결과 요약 `g*` 필드로 남는다, classnote-feed-core `newGuardStats`):
//   (3) 과목 가드 — 보드 과목과 다른 반의 담당은 뺀다(`blocked.subject`). 조회는 과목을 안 거르고 여기서 센다.
//   (2) 재검증 가드 — 최종 수신자 한 명씩을 **다른 쿼리**(notify-recipients-db `loadVerifiedStudentPairs`)가 다시 확인한
//       짝만 남긴다(`blocked.verify`). 계산 경로의 결함이 곧바로 오발송이 되지 않게 두 벌이 합의해야 보낸다.
//   (4) 상한 가드 — 한 글의 수신자가 NOTIFY_RECIPIENT_CAP을 넘으면 지금 반 담임만으로 좁힌다(`blocked.cap`, 호출부가 경고 로그).
import { classTeachersNow, isCurrentEnrollment } from "./notify-axis.mjs";

/**
 * 한 글의 수신자 상한. 실측(2026-09-30, 수학 수강 학생 197명): 1명 96 · 2명 97(수학 반 둘) · 3명 1 · 0명 3(미래 시작만) — 최대 3명.
 * 반 보드 66개는 전부 1명. 담임+부담임+위임이 한 학생에 몰려도 5명을 넘으면 계산 결함일 가능성이 더 크다.
 */
export const NOTIFY_RECIPIENT_CAP = 5;

/** 벨을 받을 수 있는 계정 — 같은 지점 · 활성 · 학생 계정 아님. 모르면(행 없음·지점 불명) 받지 않는다. */
export function eligibleRecipient(user, tenant) {
  return !!user && !!tenant && user.tenantId === tenant && user.active === true && user.role !== "student";
}

function groupBy(rows, keyOf) {
  const m = new Map();
  for (const r of rows ?? []) {
    const k = keyOf(r);
    (m.get(k) ?? m.set(k, []).get(k)).push(r);
  }
  return m;
}

/** 한 반을 지금 맡은 사람(받을 수 있는 계정만) + 그중 담임. 운영 중이 아니면 빈손. */
function classPeople(c, delegations, users, tenant, today) {
  if (!c || c.isActive !== true) return { people: [], homerooms: [] };
  const ok = (id) => eligibleRecipient(users.get(id), tenant);
  const people = classTeachersNow({ homeroomTeacherId: c.homeroomTeacherId, slots: c.slots, delegations, today }).filter(ok);
  return { people, homerooms: c.homeroomTeacherId && ok(c.homeroomTeacherId) ? [c.homeroomTeacherId] : [] };
}

/**
 * 학생별 1차 계산(재검증·상한 전).
 * @param {object} input
 * @param {string[]} input.studentIds
 * @param {Array<{studentId:string, classId:string, startDate:string, endDate:string|null, isTransferred:boolean}>} input.enrollments
 *        그 학생들의 수강(과목 불문 — 과목 가드가 여기서 센다)
 * @param {Map<string,{subject:string, isActive:boolean, homeroomTeacherId:string|null, slots:Array}>} input.classes
 * @param {Array<{classId:string, delegateUserId:string, fromDate:string, toDate:string, revokedAt:string|null}>} [input.delegations]
 * @param {Map<string,{tenantId:string, active:boolean, role:string}>} input.users
 * @param {string[]} input.keys  보드 과목 키(수학 = ["math","subject_1"])
 * @param {string} input.tenant
 * @param {string} input.today  YYYY-MM-DD(KST)
 * @returns {Map<string,{ids:string[], homerooms:string[], subjectBlocked:string[]}>}
 */
export function planNotifyRecipients({ studentIds, enrollments, classes, delegations = [], users, keys, tenant, today }) {
  const subjects = new Set(keys ?? []);
  const delegationsBy = groupBy(delegations, (d) => d.classId);
  const acc = new Map((studentIds ?? []).map((id) => [id, { ids: new Set(), homerooms: new Set(), other: new Set() }]));
  for (const e of enrollments ?? []) {
    const a = acc.get(e.studentId);
    if (!a || !isCurrentEnrollment(e, today)) continue;
    const c = classes.get(e.classId);
    const { people, homerooms } = classPeople(c, delegationsBy.get(e.classId) ?? [], users, tenant, today);
    if (!subjects.has(c?.subject)) {
      for (const id of people) a.other.add(id); // (3) 과목 가드 — 다른 과목 반 담당은 받지 않는다
      continue;
    }
    for (const id of people) a.ids.add(id);
    for (const id of homerooms) a.homerooms.add(id);
  }
  return new Map(
    [...acc].map(([id, a]) => [id, { ids: [...a.ids], homerooms: [...a.homerooms], subjectBlocked: [...a.other].filter((x) => !a.ids.has(x)) }]),
  );
}

/**
 * 학생을 정하지 못한 **반 보드 글·댓글**(반 전체) — 그 반을 지금 맡은 사람(1차 계산). 누구 얘기인지 모르니 반 밖으로 넓히지 않는다.
 * @returns {{ids:string[], homerooms:string[], subjectBlocked:string[]}}
 */
export function classWideRecipients({ classInfo, delegations = [], users, keys, tenant, today }) {
  const { people, homerooms } = classPeople(classInfo, delegations, users, tenant, today);
  if (!new Set(keys ?? []).has(classInfo?.subject)) return { ids: [], homerooms: [], subjectBlocked: people }; // (3)
  return { ids: people, homerooms, subjectBlocked: [] };
}

/**
 * (2) 재검증 + (4) 상한을 걸어 최종 수신자를 확정한다.
 * @param {Map<string,{ids:string[], homerooms:string[], subjectBlocked?:string[]}>} planned  키 = 학생 id(또는 반 id)
 * @param {Set<string>} verified  `${키}|${userId}` — 계산과 **다른 쿼리**가 확인한 짝
 * @param {number} [cap]
 * @returns {Map<string,{ids:string[], blocked:{subject:number, verify:number, cap:number}, narrowed:boolean}>}
 */
export function finalizeRecipients(planned, verified, cap = NOTIFY_RECIPIENT_CAP) {
  const out = new Map();
  for (const [key, p] of planned) {
    const pass = (id) => verified.has(`${key}|${id}`);
    const ids = [...new Set(p.ids)].filter(pass);
    const blocked = { subject: (p.subjectBlocked ?? []).length, verify: new Set(p.ids).size - ids.length, cap: 0 };
    let final = ids;
    let narrowed = false;
    if (ids.length > cap) {
      // 비정상적으로 많다 = 계산 결함 의심 → 넓은 목록 대신 지금 반 담임만(그것도 재검증 통과분만).
      final = [...new Set(p.homerooms)].filter(pass);
      blocked.cap = ids.length - final.length;
      narrowed = true;
    }
    out.set(key, { ids: final, blocked, narrowed });
  }
  return out;
}

/**
 * 가드별로 막은 건수 — 워커 결과 요약(하트비트 `last_results.posts/comments`)에 **평평한 숫자 칸**으로 실린다
 * (noteResult가 숫자만 담는다 · 앱 카드는 모르는 칸을 안 그린다 = 화면 노출 없음). 단위:
 *   gStudent 학생 미확정으로 돌린 글·댓글 수(원아 모호·보드 번호 없음·1인 보드 원아 링크 불일치)
 *   gVerify  재검증에서 뺀 사람 수(글×사람) · gSubject 다른 과목 반이라 뺀 사람 수(글×사람) · gCap 상한으로 뺀 사람 수(글×사람)
 *   gWide    반 전체 글인데 보드↔반을 하나로 못 정해 알리지 않은 글 수 · gFallback 새 계산이 실패해 폴백한 횟수
 *   gDup     같은 글·같은 사람 중복으로 뺀 줄 수
 */
export function newGuardStats() {
  return { gStudent: 0, gVerify: 0, gSubject: 0, gCap: 0, gWide: 0, gFallback: 0, gDup: 0 };
}

/** 확정 결과 하나(학생 또는 반)의 막은 건수를 글 한 건만큼 더한다. */
export function addBlocked(stats, result) {
  if (!result?.blocked) return;
  stats.gSubject += result.blocked.subject ?? 0;
  stats.gVerify += result.blocked.verify ?? 0;
  stats.gCap += result.blocked.cap ?? 0;
}

/**
 * 알림 한 건(글·댓글)의 중복 키. id가 없으면 `fallback`(호출부 일련번호)으로 유일하게 만든다 —
 * 서로 다른 댓글이 한 키로 뭉치면 중복 가드가 **정상 알림을 지운다**(가드가 유실을 만들면 안 된다).
 */
export function eventDedupeKey(kind, id, fallback) {
  return id != null && id !== "" ? `${kind}:${id}` : `${kind}:무번호:${fallback}`;
}

/**
 * (7) 중복 가드 — 같은 글·댓글(`dedupeKey`)의 같은 사람은 한 줄만. 순서는 처음 나온 대로.
 * @param {Array<{dedupeKey:string, recipient_id:string}>} rows
 */
export function dedupePlanRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows ?? []) {
    const k = `${r.dedupeKey}|${r.recipient_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return { rows: out, dropped: (rows ?? []).length - out.length };
}
