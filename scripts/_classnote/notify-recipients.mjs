// scripts/_classnote/notify-recipients.mjs — 학부모 글·댓글 벨을 **받을 사람** 계산(순수, Vitest).
//
// 원장 2026-09-30: *"이전과 다르게 이제 (수학) 이름의 1인반이 아니다보니 알림이 담당에게만 가는 현상이 발생했는데,
//   학생을 한번이라도 수업하게 되면 학부모 글, 댓글 알림이 뜨도록."* + *"이전 1인 반에서 작동하는 기능을 반기준으로
//   바꿔도 작동하게 함이 목적."*
//
// 왜 좁아졌나: 1인 보드 `(수학)학생`에는 그 학생 반을 맡았던 강사가 **누적으로** 연결돼 있었고(Edutrix
//   `assign_teacher_to_classnote.js` — 해제 API가 없어 빠지지도 않았다), ClassNote가 그들 전원에게 알렸다.
//   반 보드에는 **그 반 담임 한 명만** 연결된다(math-class-teachers.mjs) → ClassNote 알림이 담임 한 명으로 줄었다.
//   aywa 벨(`teachersFor`)은 원래부터 "지금 다니는 반의 담임"뿐이라 그 빈자리를 못 메웠다.
//
// 받는 사람 = 그 학생에 대해
//   ① 지금 다니는 반(보드와 같은 과목)의 담임 · 오늘 유효한 교시 담당(부담임) · 오늘 임시 위임 강사
//   ② 한 번이라도 가르친 사람 — (a) 그 과목 수업보고서 작성자 (b) 출결 귀속(출석·지각·조퇴·보강 칸, 앱 축 규칙 사본)
//   · 퇴사·비활성 제외 · 중복 없음 · 기간 제한 없음.
// 🔴 (a) 작성자는 **강사(teacher)이거나 지금 그 과목 반을 맡은 사람**만 — 사무실 대리 작성([[#93]])은 가르친 게 아니다.
// 🔴 (b) 과거 날짜의 담임은 **담임 이력으로 복원**한다(현재 담임을 그대로 쓰면 인계 뒤 새 담임이 가르친 적 없는
//    학생의 글을 받는다 — 인계가 있던 수학 반 20개). 이력으로 모르면 비운다(지어내지 않는다).
// 🔴 (b') 인계 기록이 **아예 없는 반**은 앱 규칙대로 현재 담임으로 떨어지는데, 담임 변경 감사로그는 2026-06-22부터라
//    그 전 인계는 안 보인다 → 그 달 그 반 보고서를 **다른 강사만** 썼으면 그 칸은 현재 담임 몫에서 뺀다. 근거 = 작성자 id
//    (강사·반 담당만) **또는 보고서의 강사 이름(`teacher_name`)** — 이관분(2~7월)은 작성자가 비고 이름만 남아서다.
//    적대 리뷰 2026-09-30 실측: `중등M 개별 JJ3K` 2~5월은 이승아 선생님 수업(보고서 이름)인데 지금 담임에게 붙어 7~8명의
//    글이 가르친 적 없는 강사에게 갈 뻔했다. 보정은 **빼기만** 한다 — 이름이 어긋나도 앱 규칙(현재 담임)으로 돌아갈 뿐 더 보내지 않는다.
//    앱 축 사본(notify-axis)과의 **두 번째이자 마지막 차이**다 — 사본은 그대로 두고 여기서만 거른다.
//    교시 담당으로 명시된 사람·지금 반 수신자(①)는 안 건드린다.
import { buildHomeroomHistory, classTeachersNow, homeroomOnDate, taughtTeachersOf } from "./notify-axis.mjs";

/** "그날 그 학생을 가르쳤다"로 치는 출결 상태 — 결석·공결은 수업을 안 받았다. */
export const TAUGHT_STATUSES = ["present", "late", "early_leave", "makeup"];

/**
 * @param {object} input
 * @param {string[]} input.studentIds
 * @param {Array<{studentId:string, classId:string}>} input.currentEnrollments  지금 다니는 반(그 과목·활성·수강 중)
 * @param {Array<{studentId:string, userId:string}>} input.reportAuthors      그 과목 보고서 작성자
 * @param {Array<{studentId:string, classId:string, date:string, slotStart:string|null}>} input.attended 수업 받은 출결 칸
 * @param {Map<string,{homeroomTeacherId:string|null, slots:Array}>} input.classes  위 두 곳에 나온 반
 * @param {Array} [input.delegations]   {classId, delegateUserId, fromDate, toDate, revokedAt}
 * @param {Array} [input.transitions]   {classId, date, teacherId, previousTeacherId} — 담임 전이(감사로그)
 * @param {Array<{classId:string, month:string, userId:string|null, teacherName?:string|null}>} [input.classMonthWriters]
 *        반·달(YYYY-MM)별 보고서 작성자 id·강사 이름 — (b') 보정용(수신자를 더하지 않는다)
 * @param {Map<string,{active:boolean, role:string, name?:string|null}>} input.users
 * @param {Set<string>} input.teachingIds  지금 그 과목 반의 담임·교시 담당(대리 작성자 가리기용)
 * @param {string} input.today  YYYY-MM-DD(KST)
 * @returns {Map<string, string[]>} studentId → 받는 사람(① 먼저, 그다음 ②)
 */
export function planNotifyRecipients(input) {
  const { studentIds, classes, users, teachingIds, today } = input;
  const history = buildHomeroomHistory(input.transitions ?? []);
  const delegationsBy = groupBy(input.delegations ?? [], (d) => d.classId);
  const active = (id) => !!id && users.get(id)?.active === true;
  // 가르친 근거가 되는 작성자 — 강사이거나 그 과목 반을 맡은 사람(사무실 대리 작성 제외). 퇴사자도 근거로는 센다.
  const teacherEvidence = (id) => {
    const u = users.get(id);
    return !!u && (u.role === "teacher" || teachingIds.has(id));
  };
  // 반·달 → 그 달 그 반을 가르친 근거 표식(`id:` 강사 작성자 · `name:` 보고서 강사 이름)
  const writersBy = new Map();
  for (const w of input.classMonthWriters ?? []) {
    const tokens = [];
    if (w.userId && teacherEvidence(w.userId)) tokens.push(`id:${w.userId}`);
    const name = String(w.teacherName ?? "").trim();
    if (name) tokens.push(`name:${name}`);
    if (!tokens.length) continue;
    const k = `${w.classId}|${w.month}`;
    const set = writersBy.get(k) ?? writersBy.set(k, new Set()).get(k);
    for (const t of tokens) set.add(t);
  }
  const wroteThatMonth = (writers, userId) => {
    const name = String(users.get(userId)?.name ?? "").trim();
    return writers.has(`id:${userId}`) || (!!name && writers.has(`name:${name}`));
  };
  const out = new Map(studentIds.map((id) => [id, new Set()]));
  const add = (studentId, ids) => {
    const set = out.get(studentId);
    if (set) for (const id of ids) if (active(id)) set.add(id);
  };

  // ① 지금 다니는 반
  for (const e of input.currentEnrollments ?? []) {
    const c = classes.get(e.classId);
    if (!c) continue;
    add(e.studentId, classTeachersNow({ ...c, delegations: delegationsBy.get(e.classId) ?? [], today }));
  }
  // ②(b) 출결 귀속 — 그날 담임은 이력으로(모르면 담임 폴백 없음)
  for (const a of input.attended ?? []) {
    const c = classes.get(a.classId);
    if (!c) continue;
    const hist = history.get(a.classId);
    const homeroom = homeroomOnDate(hist, c.homeroomTeacherId, a.date);
    let ids = taughtTeachersOf({ homeroomTeacherId: homeroom, slots: c.slots, date: a.date, slotStart: a.slotStart });
    // (b') 인계 기록 없는 반의 현재 담임 폴백 — 그 달 그 반 보고서를 다른 강사만 썼으면 뺀다(머리 주석).
    if (!hist?.length && homeroom && ids.includes(homeroom)) {
      const writers = writersBy.get(`${a.classId}|${String(a.date).slice(0, 7)}`);
      const named = taughtTeachersOf({ homeroomTeacherId: null, slots: c.slots, date: a.date, slotStart: a.slotStart });
      if (writers?.size && !wroteThatMonth(writers, homeroom) && !named.includes(homeroom)) ids = ids.filter((id) => id !== homeroom);
    }
    add(a.studentId, ids);
  }
  // ②(a) 보고서 작성자 — 강사이거나 그 과목 반을 맡은 사람만
  for (const r of input.reportAuthors ?? []) {
    if (teacherEvidence(r.userId)) add(r.studentId, [r.userId]);
  }
  return new Map([...out].map(([id, set]) => [id, [...set]]));
}

/**
 * 학생을 정하지 못한 **반 보드 글·댓글**(반 전체) — 그 반을 **지금** 맡은 사람만.
 * 누구 얘기인지 모르니 "가르친 적 있는 사람"으로 넓히지 않는다(ClassNote가 알리는 그 반 담임과 같은 범위).
 */
export function classWideRecipients({ classInfo, delegations = [], users, today }) {
  if (!classInfo) return [];
  return classTeachersNow({ ...classInfo, delegations, today }).filter((id) => users.get(id)?.active === true);
}

/** 기존 수신자(담임) 목록을 앞에 두고 새 목록을 합친다 — 중복 없이, 기존 사람은 절대 빠지지 않는다. */
export function mergeRecipientMaps(base, extra) {
  const out = new Map();
  for (const id of new Set([...base.keys(), ...extra.keys()])) {
    out.set(id, [...new Set([...(base.get(id) ?? []), ...(extra.get(id) ?? [])])]);
  }
  return out;
}

function groupBy(rows, keyOf) {
  const m = new Map();
  for (const r of rows) (m.get(keyOf(r)) ?? m.set(keyOf(r), []).get(keyOf(r))).push(r);
  return m;
}
