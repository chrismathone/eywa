/**
 * scripts/_oneoff/math-auto-units-rules.mjs — 수학 자동 시수 **규칙**(순수, IO 없음).
 *
 * 앱 규칙의 단일 소스는 `src/features/attendance/auto-units.ts`(+ 분 계산 `class-sheets/lib/grid.ts`
 * `liveSlotMinutesOn`, 자리 판정 `timetable/lib/teacher-label.ts` `specialSlotLabel`)다. 이 파일은 plain .mjs
 * 스크립트(`backfill-math-auto-units.mjs`)가 TS를 못 읽어서 둔 **사본**이고, Vitest
 * (`src/features/attendance/auto-units-parity.test.ts`)가 두 벌이 같은 답을 내는지 잠근다 — 규칙을 고칠 땐 **둘 다**.
 *
 * 원장 2026-09-11 *"그날 수업 길이로 자동"* + 2026-09-14 정정: 시수 = **ceil(분 ÷ 60) ÷ 2**(교시 하나당 0.5,
 * 55분도 한 시간으로 올림) — 1이면 자동 안 함(null). 앱 `auto-units.ts`와 같은 식이어야 한다(패리티 테스트).
 */

export const AUTO_UNITS_SUBJECTS = new Set(["math"]);
/** 시수를 소비하는 상태 — `session-units.ts` COUNTABLE_STATUSES와 같다. */
export const COUNTABLE_STATUSES = new Set(["present", "late", "early_leave", "makeup"]);
export const MAX_SESSION_UNITS = 20;
/** 자리(LAB·JJ) 별칭 — `teacher-label.ts` SPECIAL_BY_ALIAS 키 전부(소문자). */
export const SPECIAL_SLOT_ALIASES = new Set(["lab", "lab실", "이주희", "랩실", "jj", "집중자율수업실", "자율실"]);

const DOW_BY_UTC_DAY = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function isSpecialLabel(label) {
  if (label == null) return false;
  return SPECIAL_SLOT_ALIASES.has(String(label).trim().toLowerCase());
}

export function dowKeyOf(ymd) {
  return DOW_BY_UTC_DAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
}

function hhmm(t) {
  return String(t).slice(0, 5);
}

function slotMinutes(start, end) {
  const toMin = (v) => {
    const [h, m] = v.split(":").map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN;
  };
  const diff = toMin(end) - toMin(start);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

/**
 * 그 날짜 실제로 도는 교시의 분 합 — 요일 일치 · valid_from ≤ date ≤ valid_to · 자리 제외 · 같은 시작 시각 한 번.
 * rows: { dayOfWeek, startTime, endTime, validFrom, validTo, slotTeacherLabel }
 */
export function scheduledMinutesOn(date, rows) {
  const dow = dowKeyOf(date);
  const byStart = new Map();
  for (const s of rows) {
    if (s.dayOfWeek !== dow) continue;
    if (s.validFrom > date) continue;
    if (s.validTo && s.validTo < date) continue;
    if (isSpecialLabel(s.slotTeacherLabel)) continue;
    const start = hhmm(s.startTime);
    if (byStart.has(start)) continue;
    byStart.set(start, slotMinutes(start, hhmm(s.endTime)));
  }
  let total = 0;
  for (const m of byStart.values()) total += m;
  return total;
}

export function unitsFromMinutes(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  const units = Math.min(MAX_SESSION_UNITS, Math.ceil(minutes / 60) / 2);
  return units === 1 ? null : units;
}

export function autoUnitsOn(date, rows) {
  return unitsFromMinutes(scheduledMinutesOn(date, rows));
}

// ── 소급 보정(backfill-math-auto-units.mjs) 전용 판정 — 순수, Vitest(`auto-units-backfill.test.ts`) ──────────

/**
 * 소급 보정 대상 상태 — 시수를 소비하는 상태 중 **보강은 기본 제외**.
 * 보강 칸은 보강 추가 확인창에서 시수를 **보고 고르는** 기록이라 null(=1)이 명시였을 수 있다 — 오늘 앱으로 같은
 * 보강을 넣어도 확인창 숫자(1)가 명시로 가서 자동값을 안 받는다(적대 리뷰 2026-09-11: 드라이런 91칸 중 3칸이
 * 그 반 수강생이 아닌 보강 방문자였다). 원장이 넣기로 하면 `--include-makeup`.
 * @param {{ includeMakeup?: boolean }} [opts]
 * @returns {Set<string>}
 */
export function backfillStatuses(opts = {}) {
  const includeMakeup = opts.includeMakeup === true;
  return new Set([...COUNTABLE_STATUSES].filter((s) => includeMakeup || s !== "makeup"));
}

/**
 * `--apply`의 전제 — 🔴 **기준 시각(`--recorded-before`)이 있어야 한다**. 앱(자동 시수) 배포 뒤 강사가 명시로 친 1은
 * DB에서 기본 1과 구분이 안 된다(둘 다 null) — 기준 시각 없이 적용하면 그 칸들을 1.5·2로 덮는다(원장 2026-09-11
 * "강사가 고친 값은 그대로" 위반, 적대 리뷰 2026-09-11). 배포 전에 적용한다면 지금 시각을 넘기면 된다.
 * @param {{ apply: boolean, recordedBefore: Date | null }} o
 * @returns {string | null} 오류 문장 또는 null(진행)
 */
export function backfillApplyError(o) {
  if (!o.apply) return null;
  if (!o.recordedBefore) {
    return (
      "--apply에는 --recorded-before=<ISO 시각>이 필요합니다 — 앱(자동 시수) 배포 시각을 넘기세요" +
      "(배포 전이면 지금 시각). 그 뒤에 강사가 명시로 친 1(DB에선 기본 1과 같은 null)을 덮지 않기 위해서입니다."
    );
  }
  return null;
}

/**
 * 칸별 유효 행(교시별 최신 1건 — distinct on) → 보정 후보와 건너뛴 사유(순수).
 * ⚠️ 상태는 **소비 상태까지만** 거른다 — 보강 제외는 자동값을 센 뒤 `partitionBackfillItems`가 한다(보고서에 따로 적으려고).
 * @param {Array<{ student_id: string, class_id: string, session_date: string, slot_start: string | null,
 *   status: string, session_units: unknown, seat_label: string | null, recorded_at: unknown }>} rows
 * @param {{ recordedBefore?: Date | null }} [opts]
 */
export function pickBackfillCandidates(rows, opts = {}) {
  const recordedBefore = opts.recordedBefore ?? null;
  // 칸(학생·반·날짜)마다 — 교시별 행이 하나라도 있으면 "그날 전체" 행에 자동값을 얹으면 합산이 이중이 된다.
  const byCell = new Map();
  for (const r of rows) {
    const k = `${r.student_id}|${r.class_id}|${r.session_date}`;
    const cell = byCell.get(k) ?? { day: null, slotted: 0 };
    if (r.slot_start === null) cell.day = r;
    else cell.slotted++;
    byCell.set(k, cell);
  }
  const skip = { mixed: 0, notCountable: 0, alreadySet: 0, seat: 0, recordedAfter: 0 };
  const cands = [];
  for (const cell of byCell.values()) {
    const r = cell.day;
    if (!r) continue; // 교시별 행만 있는 칸 — 수학에선 자리 행이라 대상 밖
    if (!COUNTABLE_STATUSES.has(r.status)) { skip.notCountable++; continue; }
    if (r.session_units !== null) { skip.alreadySet++; continue; }
    if (r.seat_label) { skip.seat++; continue; }
    if (cell.slotted > 0) { skip.mixed++; continue; }
    if (recordedBefore && new Date(r.recorded_at) >= recordedBefore) { skip.recordedAfter++; continue; }
    cands.push(r);
  }
  return { cands, skip, scanned: byCell.size };
}

/**
 * 자동값이 붙은 후보 → 실제로 바꿀 칸 / 보강이라 뺀 칸(보고서에 따로 적는다). `includeMakeup`이면 뺄 게 없다.
 * @template {{ status: string }} T
 * @param {T[]} items
 * @param {{ includeMakeup?: boolean }} [opts]
 * @returns {{ apply: T[], excluded: T[] }}
 */
export function partitionBackfillItems(items, opts = {}) {
  const statuses = backfillStatuses(opts);
  return {
    apply: items.filter((i) => statuses.has(i.status)),
    excluded: items.filter((i) => !statuses.has(i.status)),
  };
}
