// scripts/_classnote/notify-axis.mjs — "누가 가르쳤나" 판정의 **워커용 사본**(순수, Vitest).
//
// 🔴 원본은 앱이다 — 워커(plain .mjs)는 src의 TS를 못 읽어 규칙을 여기 한 벌 더 든다.
//    · taughtTeachersOf      ← src/features/attendance/teacher-axis.ts `resolveTaughtBy`
//    · classTeachersNow      ← 같은 파일 `classTeacherIdsInRange`(from=to=오늘) + 위임(`isDelegationActiveOn`)
//    · buildHomeroomHistory  ← src/features/classes/teacher-as-of.ts `buildHomeroomHistoryIndex`
//    · homeroomOnDate        ← 같은 파일 `homeroomTeacherOnDate`
//    · transitionClassId     ← 같은 파일 `resolveTransitionClassId` + `buildUniqueClassNameIndex`
//    · SEAT_ALIAS_KEYS       ← src/features/timetable/lib/teacher-label.ts `SPECIAL_SLOT_ALIAS_KEYS`
//    패리티 테스트(tests/unit/classnote-notify-recipients.test.ts)가 두 벌을 같은 입력으로 대조한다 —
//    **앱 규칙을 바꾸면 여기도 같이** 바꿀 것(테스트가 빨개진다).
//
// 사본과 다른 점은 딱 하나다: 한 교시에 담당이 둘이면(`ambiguous`) 앱은 귀속을 비우지만(급여에 남의 수업이 붙지
// 않게), 여기는 **둘 다** 돌려준다 — 묻는 것이 "누구 몫인가"가 아니라 "그 학생을 가르쳤나"라서다
// (앱의 출결 알림 수신자 `attendanceNoticeRecipients`도 모호하면 둘 다 받는다).

/** 자리(LAB·JJ) 라벨 별칭(소문자) — 자리는 사람이 아니라 방이다(담임 폴백 금지). */
export const SEAT_ALIAS_KEYS = ["lab", "lab실", "이주희", "랩실", "jj", "집중자율수업실", "자율실"];
const SEAT = new Set(SEAT_ALIAS_KEYS);
const DOW = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** "16:20:00" → "16:20". */
export function normalizeTime(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const m = /^(\d{2}):(\d{2})/.exec(s);
  return m ? `${m[1]}:${m[2]}` : s || null;
}

function dowOf(date) {
  if (!YMD.test(String(date ?? ""))) return null;
  return DOW[new Date(`${date}T00:00:00Z`).getUTCDay()] ?? null;
}

function liveOn(slot, date) {
  if (slot.validFrom > date) return false;
  return slot.validTo == null || slot.validTo >= date;
}

function overlaps(slot, from, to) {
  if (slot.validFrom > to) return false;
  return slot.validTo == null || slot.validTo >= from;
}

function isSeat(slot) {
  if (slot.teacherId != null || slot.slotTeacherLabel == null) return false;
  return SEAT.has(String(slot.slotTeacherLabel).trim().toLowerCase());
}

/**
 * 출결 한 건(반·날짜·교시)을 가르친 사람들 — `resolveTaughtBy` 사본(모호면 둘 다, 위 머리 주석).
 * @param {{homeroomTeacherId:string|null, slots:Array, date:string, slotStart?:string|null}} input
 * @returns {string[]}
 */
export function taughtTeachersOf({ homeroomTeacherId, slots, date, slotStart = null }) {
  const fallback = () => (homeroomTeacherId ? [homeroomTeacherId] : []);
  const dow = dowOf(date);
  if (!dow) return fallback();
  const want = normalizeTime(slotStart);
  const candidates = (slots ?? []).filter(
    (s) => s.dayOfWeek === dow && liveOn(s, date) && (want == null || normalizeTime(s.startTime) === want),
  );
  if (!candidates.length) return fallback(); // 시간표에 없는 날(보강 등) → 담임
  const staffed = candidates.filter((s) => !isSeat(s));
  if (!staffed.length) return []; // 자리 수업 — 사람이 아니다
  const named = [...new Set(staffed.map((s) => s.teacherId).filter(Boolean))];
  return named.length ? named : fallback(); // 담당 미지정(수학 거의 전부) → 담임
}

/**
 * 지금(오늘) 그 반을 맡은 사람들 — 담임 ∪ 오늘 유효한 교시 담당(부담임) ∪ 오늘 유효한 임시 위임.
 * @param {{homeroomTeacherId:string|null, slots:Array, delegations?:Array, today:string}} input
 */
export function classTeachersNow({ homeroomTeacherId, slots, delegations = [], today }) {
  const out = new Set();
  if (homeroomTeacherId) out.add(homeroomTeacherId);
  for (const s of slots ?? []) if (s.teacherId && !isSeat(s) && overlaps(s, today, today)) out.add(s.teacherId);
  for (const d of delegations) {
    if (d.revokedAt || !YMD.test(d.fromDate ?? "") || !YMD.test(d.toDate ?? "") || !YMD.test(today)) continue;
    if (d.fromDate <= today && today <= d.toDate && d.delegateUserId) out.add(d.delegateUserId);
  }
  return [...out];
}

/** 반 이름 → id, **이름이 유일한 반만**(겹치면 잇지 않는다 — 잘못 붙이느니 비운다). */
export function uniqueClassNameIndex(rows) {
  const seen = new Map();
  for (const r of rows ?? []) {
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    seen.set(name, seen.has(name) ? null : r.id);
  }
  return new Map([...seen].filter(([, id]) => id));
}

/** 감사로그 한 건의 반 id — metadata.classId 우선, 없으면 유일한 반 이름(target_label). */
export function transitionClassId({ metaClassId, targetLabel }, byUniqueName) {
  const meta = String(metaClassId ?? "").trim();
  if (meta) return meta;
  const label = String(targetLabel ?? "").trim();
  return label ? (byUniqueName.get(label) ?? null) : null;
}

/** 담임 전이 → 반별 구간(끝 날짜 미포함). `buildHomeroomHistoryIndex` 사본. */
export function buildHomeroomHistory(transitions) {
  const grouped = new Map();
  for (const t of transitions ?? []) {
    if (!t.classId || !t.teacherId) continue;
    (grouped.get(t.classId) ?? grouped.set(t.classId, []).get(t.classId)).push(t);
  }
  const result = new Map();
  for (const [id, rows] of grouped) {
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
    const periods = [];
    const first = sorted[0];
    const prev = sorted.find((t) => t.date === first.date && t.previousTeacherId)?.previousTeacherId;
    if (prev) periods.push({ teacherId: prev, from: null, to: first.date });
    for (let i = 0; i < sorted.length; i++) {
      const to = sorted[i + 1]?.date ?? null;
      if (to === sorted[i].date) continue; // 같은 날 재변경은 마지막 적용이 그날의 담당
      periods.push({ teacherId: sorted[i].teacherId, from: sorted[i].date, to });
    }
    result.set(id, periods);
  }
  return result;
}

/** 그 날짜의 담임 — 이력이 없으면 현재 담임, 첫 전이보다 앞인데 이전 담임을 모르면 null. `homeroomTeacherOnDate` 사본. */
export function homeroomOnDate(history, currentTeacherId, date) {
  if (!history?.length) return currentTeacherId;
  const p = history.find((x) => (!x.from || x.from <= date) && (!x.to || date < x.to));
  if (p && !p.to && p.teacherId !== currentTeacherId) return currentTeacherId;
  return p?.teacherId ?? null;
}
