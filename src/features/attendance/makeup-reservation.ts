/**
 * 보강 예약 — 순수 규칙(IO 없음, Vitest). 서버 조회·액션은 `server/makeup-reservation-*.ts`.
 *
 * 원장 2026-09-14: *"보강 예약을 클릭하면 보강 팝업이 떠서 '몇시'에 보강인지 시간 지정 가능하게. 평일과 주말
 * 운영시간으로 정할 수 있어야함. 수기 금지. 해당 학생의 보강 예약이 출석부에 생기고, 아직 보강 수업 전이기
 * 때문에(시수 결정 전) 출석부에 텍스트로 '보강 예약'이라고 4글자로 사분면마다 하나씩 … 해당하는 보강 날짜에
 * 보강 추가 할 필요없이 미리 학생이 추가되어있어야되겠어 … 9/30 결석할거니까 10/5에 보강수업을 미리 잡는다는등.
 * 그러면 9/30에 0으로 처리되고, 10/5에 보강하면 되니까. 메모도 자동 입력되고"*
 *
 * 🔴 **예약은 출결이 아니다**(0264a) — 시수·회차·출석률·급여 어디에도 닿지 않는다. 보강일에 출결이 찍히는
 *    순간 `done`으로 넘어가고 그 행에 연결된다(`completeMakeupReservations`). 칸의 값은 언제나 출결 행이다.
 * 🔴 **교시 선택지는 학원설정 교시표에서만** — 평일은 그 반 과목의 평일 표(`weekdayTableFor`), 주말은 주말 표.
 *    시각을 손으로 치는 칸은 없다(원장 *"수기 금지"*). 서버 액션이 같은 함수로 다시 검증한다(#77).
 * 🔴 **메모 문장은 기존 보강 규약 그대로** — 결석 칸 `absenceMemo()`("10/5 보강 예정" → 이행 뒤 "보강 완료"),
 *    보강 칸 `makeupMemo()`("9/30 결석분 보강"). 새 문장을 만들면 결석 후보 목록(`MADE_UP_RE`)이 못 알아본다.
 */
import { makeupMemo, shortDate } from "@/features/onescreen/makeup-absence-link";
// 날짜 표기는 앱 단일 소스 — 화면마다 같은 날이 다른 모양으로 적히지 않게(monthDayLabel 주석).
import { formatShortKoreanDate, isValidYmd, monthDayLabel, weekdayIndexOf } from "@/lib/date-kst";
// 배너 문장은 사전에서 — 이웃 줄(`scheduledChangeLabel`)과 같은 규약이고 기본값은 한국어다.
import {
  DEFAULT_SHEET_LANG,
  sheetDowLabelByIndex,
  sheetTf,
  type SheetLang,
} from "@/features/teacher-view/i18n";
import {
  periodListLabel,
  subjectWeekdayPeriods,
  subjectWeekendPeriods,
  type PeriodsConfig,
} from "@/features/timetable/lib/periods";
import { rosterOriginLabel } from "@/features/makeups/roster-merge";
import { isAutoUnitsSubject, unitsFromMinutes } from "./auto-units";
import { diffDays } from "@/lib/date-kst";
import { COUNTABLE_STATUSES } from "./session-units";

export type MakeupReservationStatus = "reserved" | "done";

/**
 * 보고서 발송 방식(원장 2026-10-22 — '+ 보강 학생 추가'의 합침/분리와 같은 질문). 정규 수업일 예약만 묻는다.
 * merge = 정규 보고서에 합침("(정규+보강)" 1건) · separate = 보강 보고서 따로. null = 묻지 않음(정규 수업일이면 merge로 읽는다 —
 * `effectiveReportMode`).
 */
export type MakeupReportMode = "merge" | "separate";
export const isMakeupReportMode = (v: unknown): v is MakeupReportMode => v === "merge" || v === "separate";
/** 정규 수업일 예약의 실제 발송 방식 — 묻지 않은 옛 예약(null)은 합침(그 예약들이 실제로 정규 칸에 합쳐져 돌았다). */
export const effectiveReportMode = (mode: MakeupReportMode | null | undefined): MakeupReportMode => mode ?? "merge";

/** 앱이 다루는 예약 한 줄(0264a 행의 camel 표기). 시각은 "HH:MM". */
export type MakeupReservation = {
  id: string;
  studentId: string;
  classId: string;
  absenceDate: string;
  makeupDate: string;
  slotStart: string;
  slotEnd: string;
  periodLabel: string | null;
  note: string | null;
  status: MakeupReservationStatus;
  createdBy: string | null;
  /** 보고서 발송 방식(0438a) — 칸이 없거나 묻지 않은 예약은 null/없음. */
  reportMode?: MakeupReportMode | null;
  /**
   * 결석난 반(0440a) — `classId`는 **기록할 반**(보강이 서는 반)이다. 비면 같은 반. 결석일 칸을 다루는 곳은
   * 반드시 `absenceClassOf`로 읽는다(원장 2026-10-22 — 예약에도 기록할 반 고르기).
   */
  absenceClassId?: string | null;
  /**
   * 선생님이 보강을 실제로 했다고 확인한 시각(0458a · 원장 2026-10-27) — null = 아직 확인 안 함(그 보강이 든 보고서는 못 보낸다).
   * 칸이 없거나 그 칸을 안 읽은 조회는 키 자체가 없다(= 확인을 요구하지 않는다, fail-soft).
   */
  checkedAt?: string | null;
};

/** 보강 예약을 **기록할 반** 후보 한 줄(서버 `reservationHostChoices`가 만든다 — 학생이 그날 다니는 열린 같은 과목 반). */
export type ReservationHost = { classId: string; className: string; absenceClass: boolean };

/**
 * 기록할 반 판정 — 고른 반이 후보면 그 반 · 아니면 결석난 반(후보일 때) · 후보가 하나면 그 반 · 그 밖엔 null(추측하지 않는다 —
 * '+ 보강 학생 추가'의 `defaultHostClassId`와 같은 결).
 */
export function pickReservationHost(choices: readonly ReservationHost[], picked: string | null): string | null {
  if (picked && choices.some((c) => c.classId === picked)) return picked;
  const absence = choices.find((c) => c.absenceClass);
  if (absence) return absence.classId;
  return choices.length === 1 ? choices[0]!.classId : null;
}

/** 결석일 칸의 반 — 기록할 반과 다르게 잡은 예약만 따로 적혀 있다. */
export const absenceClassOf = (r: Pick<MakeupReservation, "classId" | "absenceClassId">): string => r.absenceClassId ?? r.classId;

/**
 * 출석부 칸에 적는 네 글자 — **사분면마다 하나씩**(원장). 칸이 30px라 한 줄에 못 들어가서 2×2로 나눈다.
 * 🔴 화면 파일에 다시 적지 말 것 — 범례·툴팁·칸이 같은 낱말을 써야 한다.
 */
export const RESERVED_CELL_CHARS: readonly [string, string, string, string] = ["보", "강", "예", "약"];
export const RESERVED_CELL_LABEL = "보강 예약";

/**
 * 예약 칸 서식 — 보강(보라)과 **같은 계열이되 아직 안 한 것**으로 읽히게: 옅은 보라 + 점선 테두리
 * (`*LAB` 임시 칸과 같은 문법 — 바탕을 쨍하게 칠하지 않는다. 쨍한 보라는 실제로 한 보강의 색이다).
 * ⚠️ 테두리는 `outline` — 칸의 격자선(border)과 축이 달라 서로를 덮지 않는다.
 */
export const RESERVED_CELL_CLASS =
  "bg-purple-soft text-purple outline-1 outline-dashed -outline-offset-2 outline-purple/60";

/** 배지(일별 출석부·원스크린·시간표 칩) — 칩 채도(`ATT_SOFT.makeup`)와 같은 옅은 보라. */
export const RESERVED_BADGE_CLASS = "bg-purple-soft text-purple";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
/** 요일 한 글자(0=일 … 6=토) — `formatKoreanDate`와 같은 표기. */
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

/** 예약할 수 있는 최대 앞날(일). 시간표 가져오기 적용일 상한(180일)과 같은 값 — 반년 뒤 보강은 예약이 아니다. */
export const RESERVATION_MAX_AHEAD_DAYS = 180;

/** 토·일인가 — 주말은 과목 무관 주말 교시표를 쓴다. */
export function isWeekendYmd(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay();
  return dow === 0 || dow === 6;
}

/** 요일 한 글자("월"). 형식이 아니면 빈 문자열(지어내지 않는다). */
export function dowKoOf(ymd: string): string {
  if (!YMD.test(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return DOW_KO[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()] ?? "";
}

/** 확인창의 교시 한 줄 — `id`는 교시표 식별자(index+1), `label`은 사람이 읽는 표기. */
export type ReservationPeriodOption = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
};

/**
 * 그 날짜에 고를 수 있는 교시 — **학원설정 교시표에서만**(원장 *"수기 금지"*).
 *  · 주말(토·일) = 주말 표(과목 무관) · 평일 = 그 과목의 평일 표(과목 전용 → english 내장 → 전역 순, `weekdayTableFor`).
 * 라벨 = 교시 이름(설정에서 지은 이름, 수학은 `1-1` 꼴) + 시각. 이름을 비웠으면 시각만.
 */
export function reservationPeriodOptions(
  subject: string,
  date: string,
  config: PeriodsConfig,
): ReservationPeriodOption[] {
  if (!YMD.test(date)) return [];
  const items = isWeekendYmd(date) ? subjectWeekendPeriods(config) : subjectWeekdayPeriods(subject, config);
  return items.map((p) => {
    const name = periodListLabel(p);
    const time = `${p.startTime}~${p.endTime}`;
    return { id: p.id, label: name ? `${name} · ${time}` : time, startTime: p.startTime, endTime: p.endTime };
  });
}

/**
 * 저장·표시용 교시 이름 — 설정 이름이 있으면 그것, 비었으면 null(시각이 이미 있다).
 * ⚠️ 주말은 `주말 N교시` 접두를 붙인다 — 평일 `1교시`와 겹치면 어느 표의 교시인지 못 가린다.
 */
export function reservationPeriodLabel(option: ReservationPeriodOption, date: string): string | null {
  const name = option.label.split(" · ")[0] ?? "";
  if (!name || name === `${option.startTime}~${option.endTime}`) return null;
  return isWeekendYmd(date) && !name.startsWith("주말") ? `주말 ${name}` : name;
}

/**
 * 이어진 교시 여러 개를 고른 결과(원장 2026-09-14 *"이어진 여러개의 교시를 동시 선택가능하게"*) — 시작 = 첫 교시 시작,
 * 끝 = 마지막 교시 끝, 라벨 = `1-1~1-2`. 표에서 **연속**이 아니면 null(중간이 빈 선택은 한 예약이 아니다).
 */
export type ReservationPeriodRange = {
  ids: string[];
  startTime: string;
  endTime: string;
  label: string | null;
  count: number;
  minutes: number;
};

/** "HH:MM" → 분. */
function toMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function contiguousPeriodRange(
  options: readonly ReservationPeriodOption[],
  ids: readonly string[],
  date: string,
): ReservationPeriodRange | null {
  const idx = [...new Set(ids)].map((id) => options.findIndex((o) => o.id === id)).sort((a, b) => a - b);
  if (idx.length === 0 || idx.some((i) => i < 0)) return null;
  for (let k = 1; k < idx.length; k++) if (idx[k] !== idx[k - 1]! + 1) return null;
  const first = options[idx[0]!]!;
  const last = options[idx[idx.length - 1]!]!;
  const firstLabel = reservationPeriodLabel(first, date);
  const lastName = last.label.split(" · ")[0] ?? "";
  const lastIsName = !!lastName && lastName !== `${last.startTime}~${last.endTime}`;
  const label =
    idx.length === 1 ? firstLabel : firstLabel && lastIsName ? `${firstLabel}~${lastName}` : firstLabel;
  return {
    ids: idx.map((i) => options[i]!.id),
    startTime: first.startTime,
    endTime: last.endTime,
    label,
    count: idx.length,
    minutes: Math.max(0, toMin(last.endTime) - toMin(first.startTime)),
  };
}

/**
 * 교시 칩을 누를 때의 다음 선택 — 이어진 구간만 남긴다.
 *  · 구간 양 끝을 누르면 뺀다(가운데를 누르면 그 교시 하나로 다시 시작) · 구간 바로 옆을 누르면 늘린다 ·
 *  · 떨어진 교시를 누르면 그 교시 하나로 다시 시작한다.
 */
export function togglePeriodSelection(
  options: readonly ReservationPeriodOption[],
  selected: readonly string[],
  id: string,
): string[] {
  const order = new Map(options.map((o, i) => [o.id, i]));
  const at = order.get(id);
  if (at === undefined) return [...selected];
  const idx = selected.map((s) => order.get(s)).filter((v): v is number => v !== undefined).sort((a, b) => a - b);
  if (idx.length === 0) return [id];
  const lo = idx[0]!;
  const hi = idx[idx.length - 1]!;
  const byIndex = (i: number) => options[i]!.id;
  if (at >= lo && at <= hi) {
    if (at === lo && at === hi) return [];
    if (at === lo) return idx.slice(1).map(byIndex);
    if (at === hi) return idx.slice(0, -1).map(byIndex);
    return [id];
  }
  if (at === lo - 1) return [id, ...idx.map(byIndex)];
  if (at === hi + 1) return [...idx.map(byIndex), id];
  return [id];
}

/** 예약 구간의 길이(분) — 시수 자동값의 재료. */
export function reservationSpanMinutes(r: Pick<MakeupReservation, "slotStart" | "slotEnd">): number {
  return Math.max(0, toMin(r.slotEnd) - toMin(r.slotStart));
}

/**
 * 보강을 실제로 하고 출결을 찍을 때 들어갈 **시수 자동값**(원장 2026-09-14 *"1시간당 0.5 즉 2개를 고르면 1이 입력되는
 * 자동화"*) — 수학 자동 시수와 **같은 식**(`unitsFromMinutes` = ceil(분÷60)÷2, 55분 교시 하나 = 0.5). 대상 과목이
 * 아니면(영어 = 원장 2026-08-10 "다 1") null = 자동값 없음.
 */
export function reservationAutoUnits(
  r: Pick<MakeupReservation, "slotStart" | "slotEnd">,
  subject: string | null | undefined,
): number | null {
  if (!isAutoUnitsSubject(subject)) return null;
  const minutes = reservationSpanMinutes(r);
  if (minutes <= 0) return null;
  // `unitsFromMinutes`는 1을 null로 접는다(저장 규약) — 여기선 더하기의 재료라 숫자로 돌려준다.
  return unitsFromMinutes(minutes) ?? 1;
}

export type ReservationDateCheck = { ok: true } | { ok: false; error: string };

/**
 * 날짜 검증 — 화면과 서버가 **같은 함수**를 지난다(#77).
 *  · 형식 · 결석일 ≠ 보강일 · 보강일은 오늘 이후(지난 날짜의 보강은 예약이 아니라 그날 칸에 '보강'으로 찍는 것)
 *  · 상한 180일(시간표 적용일 규약과 같은 값).
 */
export function validateReservationDates(input: {
  absenceDate: string;
  makeupDate: string;
  today: string;
}): ReservationDateCheck {
  if (!YMD.test(input.absenceDate)) return { ok: false, error: "결석일 형식이 잘못됐습니다" };
  if (!YMD.test(input.makeupDate)) return { ok: false, error: "보강일을 고르세요" };
  if (input.absenceDate === input.makeupDate)
    return { ok: false, error: "결석한 날과 보강하는 날이 같습니다 — 다른 날을 고르세요" };
  if (input.makeupDate < input.today)
    return {
      ok: false,
      error: "지난 날짜엔 예약할 수 없습니다 — 이미 한 보강은 그날 칸에 '보강'으로 찍으세요",
    };
  const ahead = diffDays(input.today, input.makeupDate);
  if (Number.isFinite(ahead) && ahead > RESERVATION_MAX_AHEAD_DAYS)
    return { ok: false, error: `보강일은 오늘부터 ${RESERVATION_MAX_AHEAD_DAYS}일 안으로 잡으세요` };
  return { ok: true };
}

/**
 * 결석 칸에 붙는 한 줄("10/5 보강 예정") — 기존 보강 연결과 **같은 낱말**(`absenceMemo`)이되 **순서와 무관하게 늘 '예정'**이다.
 * 🔴 `absenceMemo`는 보강일 < 결석일이면 '완료'를 돌려주는데(연결 시점엔 보강이 이미 끝나 있던 규약) 예약은 아직 아무것도
 *    안 한 상태라 그 판정을 빌리면 선보강 예약이 처음부터 '완료'로 적히고, 되돌림·취소가 그 줄을 못 찾는다(재리뷰 2026-09-14).
 *    이행이 '예정 → 완료'(`markAbsenceMemoDone`), 되돌림이 '완료 → 예정'(`markAbsenceMemoPlanned`)으로 옮긴다.
 */
export function reservationAbsenceMemo(r: Pick<MakeupReservation, "makeupDate" | "absenceDate">): string {
  return `${shortDate(r.makeupDate)} 보강 예정`;
}

/** 이행 뒤 결석 칸에 남는 줄("10/5 보강 완료") — `markAbsenceMemoDone`이 만드는 그 문장. 되돌림·취소가 이 줄을 찾는다. */
export function reservationAbsenceDoneMemo(r: Pick<MakeupReservation, "makeupDate">): string {
  return `${shortDate(r.makeupDate)} 보강 완료`;
}

/** 보강한 날 칸에 붙는 한 줄("9/30 결석분 보강") — 기존 보강 연결과 **같은 문장**(`makeupMemo`). */
export function reservationMakeupMemo(r: Pick<MakeupReservation, "makeupDate" | "absenceDate">): string {
  return makeupMemo(r.absenceDate, r.makeupDate);
}

/**
 * 결석 칸 메모의 "M/D 보강 예정" 줄을 "M/D 보강 완료"로 — 이행 뒤 결석 칸이 사실을 말하게.
 * 줄이 없으면 그대로(없는 줄을 지어내지 않는다).
 */
export function markAbsenceMemoDone(note: string | null | undefined, makeupDate: string): string | null {
  const base = (note ?? "").trim();
  if (!base) return note ?? null;
  const planned = `${shortDate(makeupDate)} 보강 예정`;
  const done = `${shortDate(makeupDate)} 보강 완료`;
  const lines = base.split(/\r?\n/).map((l) => (l.trim() === planned ? done : l));
  return lines.join("\n");
}

/**
 * 되돌림 — 결석 칸 메모의 "M/D 보강 완료" 줄을 다시 "M/D 보강 예정"으로(보강일 출결이 지워지거나 결석으로 고쳐졌다).
 * 줄이 없으면 그대로.
 */
export function markAbsenceMemoPlanned(note: string | null | undefined, makeupDate: string): string | null {
  const base = (note ?? "").trim();
  if (!base) return note ?? null;
  const planned = `${shortDate(makeupDate)} 보강 예정`;
  const done = `${shortDate(makeupDate)} 보강 완료`;
  return base.split(/\r?\n/).map((l) => (l.trim() === done ? planned : l)).join("\n");
}

/** 이행 행 판정에 필요한 출결 행 모양(camel — DB 행은 호출부가 옮긴다). */
export type FulfillingRowLike = { id?: string; slotStart: string | null; status: string; recordedAt: string };

/**
 * 예약을 **이행한 것으로 볼 출결 행** — 그날 유효 행 중 시수 상태(`completesReservation`)인 것에서
 *  ① 그날 전체 행(교시 없음 — 수학) 최신 ② 없으면 **예약 구간 [시작, 끝) 안에서 시작하는 교시 행**(영어·자리) 최신 ③ 없으면 null.
 * 🔴 교시 행만 있는 반(영어)에서 예약 교시가 아닌 다른 교시의 출석으로 이행하지 않는다(적대 리뷰 2026-09-14 —
 *    정규 16:20 출석이 17:20 보강 예약을 이행시켜 메모·연결이 엉뚱한 행에 붙었다).
 */
export function pickFulfillingRow<T extends FulfillingRowLike>(
  rows: readonly T[],
  r: Pick<MakeupReservation, "slotStart" | "slotEnd">,
): T | null {
  const countable = rows.filter((x) => completesReservation(x.status));
  const newest = (list: T[]): T | null =>
    [...list].sort((a, b) =>
      a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : (b.id ?? "").localeCompare(a.id ?? ""),
    )[0] ?? null;
  const dayRows = countable.filter((x) => x.slotStart == null);
  if (dayRows.length > 0) return newest(dayRows);
  const lo = toMin(r.slotStart);
  const hi = toMin(r.slotEnd);
  const inSpan = countable.filter((x) => {
    const m = toMin(String(x.slotStart).slice(0, 5));
    return m >= lo && m < hi;
  });
  return inSpan.length > 0 ? newest(inSpan) : null;
}

/** 메모에서 **그 줄만** 뺀다(취소) — 다른 사유("병결")는 남는다. 다 비면 null. */
export function removeMemoLine(note: string | null | undefined, line: string): string | null {
  const base = (note ?? "").trim();
  if (!base) return null;
  const kept = base
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && l !== line);
  return kept.length ? kept.join("\n") : null;
}

/** 이 출결 상태가 찍히면 예약이 **이행된 것**인가 — 시수를 쓰는 상태(출석·지각·조퇴·보강). 결석·공결은 아니다. */
export function completesReservation(status: string | null | undefined): boolean {
  return !!status && COUNTABLE_STATUSES.has(status);
}

/** "10/5(월) 1-1 · 16:20~17:15" — 보강 자리 한 줄(주말 접두는 라벨에 이미 있다). */
export function reservationSpanLabel(
  r: Pick<MakeupReservation, "makeupDate" | "slotStart" | "slotEnd" | "periodLabel">,
): string {
  const dow = dowKoOf(r.makeupDate);
  const day = `${shortDate(r.makeupDate)}${dow ? `(${dow})` : ""}`;
  const period = r.periodLabel ? `${r.periodLabel} · ` : "";
  return `${day} ${period}${r.slotStart}~${r.slotEnd}`;
}

/**
 * 툴팁·hover 문장 — `보강 예약 · 9/30 결석분 · 10/5(월) 1-1 · 16:20~17:15 · 예약: 홍길동 · 메모`.
 * 🔴 raw 코드(`reserved`·`mon`)를 내보내지 않는다.
 */
export function reservationTitle(
  r: Pick<MakeupReservation, "absenceDate" | "makeupDate" | "slotStart" | "slotEnd" | "periodLabel" | "note">,
  opts: { createdByName?: string | null; className?: string | null } = {},
): string {
  return `${RESERVED_CELL_LABEL} · ${reservationDetail(r, opts)}`;
}

/**
 * 위 문장에서 **머리말(`보강 예약`)만 뺀 것** — 메모 툴팁 카드처럼 라벨이 이미 옆에 있는 자리가 쓴다
 * (원장 2026-09-15: 툴팁이 카드가 되면서 `보강 예약` 라벨 + 이 값 꼴이 됐다. 한 줄 문장이 필요한 자리는
 * `reservationTitle` 그대로).
 */
export function reservationDetail(
  r: Pick<MakeupReservation, "absenceDate" | "makeupDate" | "slotStart" | "slotEnd" | "periodLabel" | "note">,
  opts: { createdByName?: string | null; className?: string | null } = {},
): string {
  return [
    opts.className ? opts.className : null,
    `${shortDate(r.absenceDate)} 결석분`,
    reservationSpanLabel(r),
    opts.createdByName ? `예약: ${opts.createdByName}` : null,
    r.note?.trim() || null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * 시간표 기본뷰 반 칸의 **'보강' 줄** 한 개(원장 2026-09-14 *"하단에 '대기'나 '퇴원'처럼 '보강' 리스트"*) — 표시 전용.
 * 🔴 `StudentLine`(수강 명단)에 섞지 않는다 — 예약은 수강도 출결도 아니라 인원·드래그·엑셀에 들어가면 거짓이 된다.
 */
export type TimetableReservedLine = {
  id: string;
  studentId: string;
  name: string;
  grade: string | null;
  school: string | null;
  makeupDate: string;
  /** 무슨 결석의 보강인가 — hover 카드 줄(`결석일`). 줄 글자엔 안 적는다(퇴원 블록과 모양이 어긋난다). */
  absenceDate: string;
  /** 예약 메모 — hover 카드 줄(`메모`). 없으면 그 줄이 빠진다. */
  note: string | null;
  periodLabel: string | null;
  slotStart: string;
  slotEnd: string;
  /**
   * **남의 반에서 온 줄에만** 채워지는 원반 이름 — 그 칸이 이 반 칸이 아닐 때(담임 열 '보강' 박스) 줄에 꼬리표로
   * 붙는다(`안은지/경명여중1 · TP4E`). 이 칸의 반에서 온 줄엔 없다(그 칸이 곧 그 반이라 군더더기).
   * 🔴 툴팁으로 대신하지 않는다 — `title`은 모바일에서 **없는 것과 같다**(디자인 규약). 모르면 undefined(꼬리만 빠진다).
   */
  fromClassName?: string;
  /** 툴팁 한 줄(`reservationTitle`) — raw 코드 없이. */
  title: string;
};

export function toTimetableReservedLine(
  r: MakeupReservation,
  stu: { name: string; grade: string | null; school: string | null },
  /**
   * 원반 이름 — **그 반 칸이 아닌 자리**(담임 열 '보강' 박스)에 설 때만 넘긴다. 그 칸은 다른 반의 칸이라
   * 어느 반 보강인지가 줄에 없으면 알 길이 없다(줄은 `이름/학교학년`뿐이라 툴팁이 그 몫을 진다).
   */
  opts: { className?: string | null } = {},
): TimetableReservedLine {
  return {
    id: r.id,
    studentId: r.studentId,
    name: stu.name,
    grade: stu.grade,
    school: stu.school,
    makeupDate: r.makeupDate,
    absenceDate: r.absenceDate,
    note: r.note,
    periodLabel: r.periodLabel,
    slotStart: r.slotStart,
    slotEnd: r.slotEnd,
    // 🔴 `opts`를 툴팁에도 **실제로** 넘긴다 — 종전엔 인자만 받고 쓰지 않아 남의 반 줄의 툴팁에 원반이 빠져 있었다
    //    (호출부만 검사하던 가드가 못 잡았다, 적대 리뷰 2026-09-14).
    title: reservationTitle(r, opts),
    // 꼬리표는 **값이 있을 때만** — 빈 문자열·공백은 없는 것으로 본다(지어내지 않는다).
    ...(opts.className?.trim() ? { fromClassName: opts.className.trim() } : {}),
  };
}

/**
 * 시간표 '보강' 줄의 **hover 카드 줄**(`라벨 값`) — 원장 2026-09-15 *"툴팁이 이렇게 생겼으면 좋겠어 메모같이
 * 생기지 않고"*(시간표 학생 카드 모양). 카드 머리(이름·학교학년)는 화면이 붙이고, 여기선 **사실만** 만든다.
 *
 * 🔴 줄 **글자**엔 여전히 교시·결석일을 안 적는다(원장 2026-09-14) — 그 정보가 사는 자리가 이 카드다.
 * ⚠️ 값이 없는 줄은 스스로 빠진다(`encodeTip`이 빈 값을 버린다) — 여기서 "—"를 지어내지 말 것.
 */
export function reservationTipRows(
  r: Pick<TimetableReservedLine, "makeupDate" | "slotStart" | "slotEnd" | "periodLabel" | "absenceDate" | "note" | "fromClassName">,
): [string, string][] {
  const rows: [string, string][] = [["보강", reservationSpanLabel(r)]];
  if (r.absenceDate) rows.push(["결석일", shortDate(r.absenceDate)]);
  if (r.fromClassName) rows.push(["원반", r.fromClassName]);
  const note = r.note?.trim();
  if (note) rows.push(["메모", note]);
  return rows;
}

/**
 * 학생 상세 **'예정된 변경'** 배너에 서는 보강 예약 한 줄(원장 2026-09-14 *"여기서도 보강 정보 알 수 있으면
 * 더 좋을듯? 바로가기로 오는것이니까"*).
 *
 * 🔴 `ScheduledChange`(합류·이동·종료)와 **한 타입으로 합치지 않는다** — 저쪽은 `enrollmentId`가 곧 쓰기
 *    대상이고 수정·취소 버튼이 붙는다. 예약은 읽기 전용이고, 고치는 자리는 출석부 칸이다.
 */
export type ScheduledMakeupLine = Pick<
  MakeupReservation,
  "id" | "absenceDate" | "makeupDate" | "slotStart" | "slotEnd" | "periodLabel" | "note"
> & {
  /** 원반 이름. 모르면 null — 문장에서 그 조각이 빠진다(지어내지 않는다). */
  className: string | null;
  /** 없으면 기존 예약 문장 그대로. 참여·추가 지도만 구분을 붙인다. */
  origin?: "reservation" | "native" | "additional";
  /** 보강 상세로 가는 케이스. 없으면 링크를 만들지 않는다. */
  caseId?: string | null;
};

/**
 * 배너 한 줄의 날짜 표기 — 월/일은 앱 단일 소스([`monthDayLabel`](@/lib/date-kst))에서 온다.
 * ⚠️ 해가 다르면 두 자리 연도를 앞에 붙인다(예약 상한이 180일이라 12월 결석 → 1월 보강처럼 해를 넘길 수 있다).
 *    규칙은 이웃 줄(`scheduled-changes.ts`의 `shortDate`)과 같은 모양으로 맞춘다.
 */
function sameYear(ymd: string, today: string): boolean {
  return ymd.slice(0, 4) === today.slice(0, 4);
}

/**
 * "9/17 (목)" · 해가 다르면 "26. 9/17 (목)".
 * ⚠️ 요일은 **화면 언어를 따른다** — 영어 문장에 `(목)`이 섞이면 그 줄만 반쪽이 한국어가 된다.
 *    월/일 숫자는 두 언어가 같은 표기라 `monthDayLabel` 한 곳에서 온다.
 * ⚠️ 달력에 없는 날짜면 요일을 지어내지 않고 숫자만 돌려준다(`formatShortKoreanDate`와 같은 규약).
 */
function makeupDayLabel(ymd: string, today: string, lang: SheetLang): string {
  if (!isValidYmd(ymd)) return monthDayLabel(ymd);
  const label =
    lang === "en"
      ? `${monthDayLabel(ymd)} (${sheetDowLabelByIndex(weekdayIndexOf(ymd), lang)})`
      : formatShortKoreanDate(ymd);
  return sameYear(ymd, today) ? label : `${ymd.slice(2, 4)}. ${label}`;
}

/** "9/15" · 해가 다르면 "26. 9/15"(결석일은 요일까지 적지 않는다 — 한 줄이 길어진다). */
function absenceDayLabel(ymd: string, today: string): string {
  const label = monthDayLabel(ymd);
  return sameYear(ymd, today) ? label : `${ymd.slice(2, 4)}. ${label}`;
}

/**
 * 배너에 그대로 찍히는 한 줄 — `9/17 (목) 14:20~16:20 보강 예약 · 9/15 결석분 · 고등M 개별 TP4E`.
 * ⚠️ 문장은 사전에서 온다(`sched.makeup*`) — 배너 파일엔 한글 리터럴을 두지 않는다(가드 name-wiring).
 * ⚠️ 인자를 안 주면 한국어(이웃 `scheduledChangeLabel`과 같은 규약).
 */
export function scheduledMakeupLabel(
  r: ScheduledMakeupLine,
  today: string,
  lang: SheetLang = DEFAULT_SHEET_LANG,
): string {
  const when = makeupDayLabel(r.makeupDate, today, lang);
  const time = `${r.slotStart}~${r.slotEnd}`;
  const absence = absenceDayLabel(r.absenceDate, today);
  const name = r.className?.trim();
  const base = name
    ? sheetTf(lang, "sched.makeup", { when, time, absence, name })
    : sheetTf(lang, "sched.makeupNoClass", { when, time, absence });
  if (!r.origin || r.origin === "reservation") return base;
  return `${base} · ${rosterOriginLabel(r.origin, lang === "en" ? "en" : "ko")}`;
}

/** 그 줄의 툴팁 — 교시·메모까지(칸·시간표 줄과 **같은 함수**라 표면마다 문장이 갈리지 않는다). */
export function scheduledMakeupTitle(r: ScheduledMakeupLine): string {
  return reservationTitle(r, { className: r.className });
}

/** 같은 (학생·반·보강일·교시) — 유니크 축(0264a)과 같은 판정. */
export function sameReservationSlot(
  a: Pick<MakeupReservation, "studentId" | "classId" | "makeupDate" | "slotStart">,
  b: Pick<MakeupReservation, "studentId" | "classId" | "makeupDate" | "slotStart">,
): boolean {
  return (
    a.studentId === b.studentId &&
    a.classId === b.classId &&
    a.makeupDate === b.makeupDate &&
    a.slotStart.slice(0, 5) === b.slotStart.slice(0, 5)
  );
}
