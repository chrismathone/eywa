// 세션 기간(운영 기간) 해석 — 순수 함수(Vitest 강제). UI·DB 비의존.
//
// ⚠️ 이름: eywa엔 'session'이 이미 둘 있다 — **시수**(session_units, 출석 한 칸의 배수)와
//    **회차**(planned/confirmed_sessions, 청구 N회). 이 모듈이 다루는 것은 셋째인 **기간**이라
//    식별자에 맨몸 `session`을 쓰지 않는다(PeriodDef/PeriodWindow). 화면 라벨만 "세션".
//
// 🔴 이 파일의 존재 이유 = **폴백**. 세션이 정의되지 않은 과목·월에서 반드시 달력월로 안전하게
//    떨어져야 한다. 폴백이 없으면 이식하는 순간 출석부·청구가 통째로 빈다.
//    "세션을 못 찾음"은 에러가 아니라 **정상 경로**다(원장이 아직 안 넣은 과목이 항상 있다).

/** DB 행(operating_periods) 1:1. 0189a. */
export type PeriodDef = {
  id: string;
  subjectKey: string;
  classId: string | null; // null = 그 과목의 기본값
  labelYear: number;
  labelMonth: number;
  startDate: string; // "YYYY-MM-DD" 포함
  endDate: string; // "YYYY-MM-DD" 포함
};

/** 해석 결과 — 화면·쿼리가 실제로 쓰는 창. */
export type PeriodWindow = {
  kind: "session" | "month";
  scope: "class" | "subject" | null; // 어느 층에서 왔나(month면 null)
  start: string; // "YYYY-MM-DD" 포함
  end: string; // "YYYY-MM-DD" 포함
  label: string; // "2026년 3월 세션 (3/6~4/2)" | "2026년 3월"
  defId: string | null;
};

const PERIOD_RE = /^(\d{4})-(\d{2})$/;

/** "YYYY-MM" → 달력월 경계. 잘못된 입력은 null. */
export function monthBounds(period: string): { year: number; month: number; start: string; end: string } | null {
  const m = period.match(PERIOD_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year,
    month,
    start: `${period}-01`,
    end: `${period}-${String(lastDay).padStart(2, "0")}`,
  };
}

/** "2026-03-06" → "3/6" (라벨용). */
function shortDate(iso: string): string {
  const [, mm, dd] = iso.split("-");
  return `${Number(mm)}/${Number(dd)}`;
}

function monthWindow(period: string): PeriodWindow | null {
  const b = monthBounds(period);
  if (!b) return null;
  return {
    kind: "month",
    scope: null,
    start: b.start,
    end: b.end,
    label: `${b.year}년 ${b.month}월`,
    defId: null,
  };
}

function sessionWindow(def: PeriodDef, scope: "class" | "subject"): PeriodWindow {
  return {
    kind: "session",
    scope,
    start: def.startDate,
    end: def.endDate,
    label: `${def.labelYear}년 ${def.labelMonth}월 세션 (${shortDate(def.startDate)}~${shortDate(def.endDate)})`,
    defId: def.id,
  };
}

/** 저장된 행이 쓸 수 있는 상태인가. 깨진 행은 세션으로 인정하지 않고 달력월로 떨어뜨린다. */
function usable(def: PeriodDef): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(def.startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(def.endDate) &&
    def.startDate <= def.endDate
  );
}

export type ResolveInput = {
  /** 라벨월 "YYYY-MM". */
  period: string;
  /** 학원설정 subjects[].key. 미지정이면 과목층을 건너뛰고 달력월. */
  subjectKey?: string | null;
  /** 반 예외를 먼저 찾는다. 미지정이면 과목 기본값만. */
  classId?: string | null;
  /** 후보 행들(보통 그 해 전체를 캐시해 넘긴다). */
  defs: readonly PeriodDef[];
  /** 개인 보기 설정. "month"면 정의가 있어도 달력월로 본다(표시 렌즈 전용). */
  mode?: "session" | "month";
  /** period가 깨졌을 때 clamp할 기준일 "YYYY-MM-DD"(순수 유지를 위해 주입). */
  todayIso?: string;
};

/**
 * 라벨월 → 실제 창. **이 함수 밖에 폴백 분기를 두지 말 것**(분산되면 화면마다 기준이 갈린다).
 *
 * 우선순위: 반 예외 → 과목 기본값 → 달력월.
 */
export function resolvePeriodWindow(input: ResolveInput): PeriodWindow {
  const { period, subjectKey, classId, defs, mode = "session", todayIso } = input;

  const fallback =
    monthWindow(period) ??
    // period 자체가 깨졌다 = 앱 버그. 빈 창을 돌려주면 쿼리가 전건을 긁으므로 오늘 달로 clamp한다.
    (todayIso ? monthWindow(todayIso.slice(0, 7)) : null) ?? {
      kind: "month" as const,
      scope: null,
      start: "",
      end: "",
      label: "기간을 확인할 수 없습니다",
      defId: null,
    };

  if (mode === "month") return fallback;

  const bounds = monthBounds(period);
  if (!bounds || !subjectKey) return fallback;

  const sameLabel = defs.filter(
    (d) =>
      d.subjectKey === subjectKey &&
      d.labelYear === bounds.year &&
      d.labelMonth === bounds.month &&
      usable(d),
  );
  if (sameLabel.length === 0) return fallback;

  if (classId) {
    const exact = sameLabel.find((d) => d.classId === classId);
    if (exact) return sessionWindow(exact, "class");
  }
  const base = sameLabel.find((d) => d.classId === null);
  return base ? sessionWindow(base, "subject") : fallback;
}

/** 날짜가 창에 속하는가(양끝 포함). 문자열 비교 — 타임존 시프트 없음. */
export function periodIncludes(w: PeriodWindow, dateIso: string): boolean {
  if (!w.start || !w.end) return false;
  return dateIso >= w.start && dateIso <= w.end;
}

/** 창을 연속 날짜로 펼친다(주말·공휴일 포함 — 출석부 열은 쉬는 날도 그린다). */
export function expandPeriodDates(w: PeriodWindow): string[] {
  if (!w.start || !w.end || w.start > w.end) return [];
  const out: string[] = [];
  const cur = new Date(`${w.start}T00:00:00Z`);
  const end = new Date(`${w.end}T00:00:00Z`);
  // 안전장치: 세션이 아무리 길어도 1년을 넘지 않는다(깨진 행이 무한 루프가 되지 않도록).
  for (let guard = 0; cur <= end && guard < 400; guard++) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** 날짜가 속한 세션 찾기(역방향) — 출석 한 건이 어느 세션 급여인지 판정할 때. */
export function findPeriodForDate(
  defs: readonly PeriodDef[],
  subjectKey: string,
  dateIso: string,
  classId?: string | null,
): PeriodDef | null {
  const hit = defs.filter(
    (d) => d.subjectKey === subjectKey && usable(d) && dateIso >= d.startDate && dateIso <= d.endDate,
  );
  if (hit.length === 0) return null;
  if (classId) {
    const exact = hit.find((d) => d.classId === classId);
    if (exact) return exact;
  }
  return hit.find((d) => d.classId === null) ?? null;
}
