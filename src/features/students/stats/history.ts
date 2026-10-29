/**
 * 원생 통계 '지난 기록' — `student_history_monthly`(0385a) 두 출처를 달마다 하나로 잇는다(원장 2026-10-20 *"'지난 기록' 카드 따로"* ·
 * *"부드럽지 않은곳도 대략적으로 이어붙일 데이터가 있는지"*). 순수 함수(Vitest).
 *   makeedu = 2020-01 ~ 2025-12 메이크에듀 수납·원생 + 2025-03 ~ 메이크에듀 월별 재원생 기록
 *   aywa    = 청구가 시작된 달 ~ 에이와 청구·원생(밤마다 다시 센다)
 * 겹치는 칸은 **에이와가 이긴다**(같은 달을 에이와가 세기 시작했으면 그 값) — 메이크에듀는 2026-01부터 재원생 기록만 싣는다.
 */

/**
 * 칸 — `paying*` = 그달 수업료 청구가 살아 있는 학생. 프로그램 칸(`payingMath`·`payingInjaewon`·`payingOther`·`payingUnknown`)은 청구 줄의
 * **수업명으로** 가른 값(`lesson-program.ts` · 원장 2026-10-21 *"수학과 영어로 구분 못하나? 수업명 가지고?"*) — 두 프로그램 줄이 있는
 * 학생은 양쪽에 든다 · `payingUnknown` = 수업명으로 못 가른 줄이 있는 학생 · `payingEnglish` = 인재원 영어 **또는** EiE 학생(한 학생은 한 번 —
 * 재원생·강좌수 추이의 '영어' 묶음에 잇는다 · 원장 2026-10-29 *"지난기록 말고 그냥 재원생과 강좌수 퇴원생에 반영"*).
 * `stoppedPaying` = 그달을 끝으로 수업료 청구가 끊긴 학생(다음 두 달 청구 없음 · `stopped-paying.ts` — 메이크에듀 퇴원일은 2025년부터만 남아
 * 2020년부터는 청구로 센다 · 원장 2026-10-21 *"다음 후보 계속 진행"*). 청구에서 나온 칸이라 수납 권한이 있을 때만 싣는다.
 */
export const HISTORY_FIELDS = [
  "payingGeneral",
  "payingEie",
  "payingTotal",
  "payingMath",
  "payingInjaewon",
  "payingOther",
  "payingUnknown",
  "payingEnglish",
  "stoppedPaying",
  "newReal",
  "newRegistered",
  "enrolledRecord",
] as const;
export type HistoryField = (typeof HISTORY_FIELDS)[number];

/**
 * 그 밖의 과목을 과목마다 — `payingSubject:<과목 키>`(원장 2026-10-28 *"과목별로 분리가능한 수준까지 쫙 분리"* · 국어·과학…). `payingOther`는 그 합집합
 * 그대로 둔다(옛 줄·다른 화면 호환). 학원 설정 과목 키라 지점마다 다르다 — 고정 칸이 아니라 묶음으로 읽는다.
 */
export const SUBJECT_FIELD_PREFIX = "payingSubject:";
export const subjectField = (key: string) => `${SUBJECT_FIELD_PREFIX}${key}`;
/** 건너뛴 달 표시 — 청구가 비정상으로 적어 청구 칸을 비운 달(원장 2026-10-28 *"이상할정도로 적은달은 건너뛰는게 차라리 나음"*). */
export const SKIPPED_PAYING = "skippedPaying";

/**
 * 한 달 — 값이 없는 칸은 비운다(0과 '모름'을 가른다). `estimated` = 추정으로 메운 칸 · `subjects` = 그 밖의 과목마다(키 → 학생) ·
 * `skipped` = 청구 칸을 일부러 비운 달(값이 없는 것과 같지만 화면이 이유를 적는다).
 */
export type HistoryMonth = { month: string; estimated: HistoryField[]; subjects?: Record<string, number>; skipped?: boolean } & Partial<Record<HistoryField, number>>;
export type HistoryRow = { month: string; source: "makeedu" | "aywa"; data: unknown };

const isField = (k: unknown): k is HistoryField => HISTORY_FIELDS.includes(k as HistoryField);

/** 저장된 칸(jsonb) → 숫자 칸만(모양이 틀린 값은 버린다 — 0으로 바꾸지 않는다). */
export function parseHistoryData(raw: unknown): Omit<HistoryMonth, "month"> {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: Omit<HistoryMonth, "month"> = { estimated: [] };
  for (const f of HISTORY_FIELDS) {
    const v = o[f];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[f] = Math.round(v);
  }
  out.estimated = Array.isArray(o.estimated) ? [...new Set(o.estimated.filter(isField))] : [];
  for (const [k, v] of Object.entries(o)) {
    if (!k.startsWith(SUBJECT_FIELD_PREFIX) || typeof v !== "number" || !Number.isFinite(v) || v < 0) continue;
    const key = k.slice(SUBJECT_FIELD_PREFIX.length);
    if (key) (out.subjects ??= {})[key] = Math.round(v);
  }
  if (o[SKIPPED_PAYING] === 1 || o[SKIPPED_PAYING] === true) out.skipped = true;
  return out;
}

/** 두 출처 → 달마다 한 줄(달 순서). 한 달에 두 출처가 있으면 에이와 칸이 메이크에듀 칸을 덮는다(추정 표시도 그 칸만 따라간다). */
export function mergeHistory(rows: readonly HistoryRow[]): HistoryMonth[] {
  const byMonth = new Map<string, HistoryMonth>();
  const ordered = [...rows].sort((a, b) => a.month.localeCompare(b.month) || (a.source === "makeedu" ? -1 : 1));
  for (const r of ordered) {
    if (!/^\d{4}-\d{2}$/.test(r.month)) continue;
    const d = parseHistoryData(r.data);
    const cur = byMonth.get(r.month) ?? { month: r.month, estimated: [] };
    for (const f of HISTORY_FIELDS) {
      if (d[f] === undefined) continue;
      cur[f] = d[f];
      cur.estimated = cur.estimated.filter((e) => e !== f);
      if (d.estimated.includes(f)) cur.estimated.push(f);
    }
    // 과목 묶음 — 뒤 출처(에이와)가 청구 칸을 실었으면 과목 묶음도 **통째로** 그쪽(없으면 없음 — 출처가 다른 과목 값을 한 달에 섞지 않는다 ·
    // 리뷰 2026-10-28). 청구 칸 없이 과목만 실렸으면 더한다. 건너뛴 표시는 뒤 출처가 청구 칸을 실으면 풀린다.
    const carriesPaying = d.payingGeneral !== undefined || d.payingTotal !== undefined;
    if (carriesPaying) {
      if (d.subjects) cur.subjects = { ...d.subjects };
      else delete cur.subjects;
    } else if (d.subjects) cur.subjects = { ...(cur.subjects ?? {}), ...d.subjects };
    if (d.skipped) cur.skipped = true;
    else if (carriesPaying) delete cur.skipped;
    byMonth.set(r.month, cur);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** `months` = 그해 줄이 있는 달 수 · `fieldMonths` = 칸마다 값이 있는 달 수(평균을 낸 달 수 — 칸마다 다를 수 있다). */
export type HistoryYear = {
  year: string;
  months: number;
  fieldMonths: Partial<Record<HistoryField, number>>;
  /** 그 밖의 과목마다 월평균(값이 있는 달) · `subjectMonths` = 과목마다 평균을 낸 달 수. */
  subjects?: Record<string, number>;
  subjectMonths?: Record<string, number>;
} & Partial<Record<HistoryField, number>>;

/**
 * 연도별 — 학생 수(수업료가 청구된 학생 · 메이크에듀 재원생 기록)는 **값이 있는 달의 평균**(반올림), 신규는 **합**.
 * 값이 있는 달이 없으면 그 칸을 비운다. 칸마다 평균을 낸 달 수를 함께 싣는다(적대 리뷰 2026-10-20: 2026년 메이크에듀 기록은 1~3월만이었다).
 */
export function yearlyHistory(months: readonly HistoryMonth[]): HistoryYear[] {
  const byYear = new Map<string, HistoryMonth[]>();
  for (const m of months) byYear.set(m.month.slice(0, 4), [...(byYear.get(m.month.slice(0, 4)) ?? []), m]);
  return [...byYear].sort(([a], [b]) => a.localeCompare(b)).map(([year, list]) => {
    const out: HistoryYear = { year, months: list.length, fieldMonths: {} };
    for (const f of HISTORY_FIELDS) {
      const vals = list.map((m) => m[f]).filter((v): v is number => v !== undefined);
      if (!vals.length) continue;
      const sum = vals.reduce((a, v) => a + v, 0);
      out[f] = f === "newReal" || f === "newRegistered" || f === "stoppedPaying" ? sum : Math.round(sum / vals.length);
      out.fieldMonths[f] = vals.length;
    }
    const keys = [...new Set(list.flatMap((m) => Object.keys(m.subjects ?? {})))];
    for (const key of keys) {
      const vals = list.map((m) => m.subjects?.[key]).filter((v): v is number => v !== undefined);
      if (!vals.length) continue;
      (out.subjects ??= {})[key] = Math.round(vals.reduce((a, v) => a + v, 0) / vals.length);
      (out.subjectMonths ??= {})[key] = vals.length;
    }
    return out;
  });
}

/** 청구에서 나온 칸(수업료가 청구된 학생) — 수납 권한이 없는 사람에게는 서버가 빼고 보낸다(`load.ts` · 화면에서 가리지 않는다 #77). */
const PAYING_FIELDS: readonly HistoryField[] = ["payingGeneral", "payingEie", "payingTotal", "payingMath", "payingInjaewon", "payingOther", "payingUnknown", "payingEnglish", "stoppedPaying"];
export function withoutPaying(months: readonly HistoryMonth[]): HistoryMonth[] {
  return months.map((m) => {
    // 과목 묶음·건너뛴 표시도 청구에서 나온 것이라 함께 뺀다.
    const out: HistoryMonth = { month: m.month, estimated: m.estimated.filter((f) => !PAYING_FIELDS.includes(f)) };
    for (const f of HISTORY_FIELDS) if (!PAYING_FIELDS.includes(f) && m[f] !== undefined) out[f] = m[f];
    return out;
  });
}

/** 그 칸에 값이 처음 생긴 달(YYYY-MM) — 안내 문구('EiE는 2025년 5월부터')가 데이터에서 나오게. 없으면 null. */
export function firstMonthWith(months: readonly HistoryMonth[], field: HistoryField): string | null {
  return months.find((m) => m[field] !== undefined)?.month ?? null;
}
