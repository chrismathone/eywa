/**
 * 영어 작성률 순수 계산 — ClassNote 반 보드 기준.
 *
 * 왜 별도인가: 영어 강사는 eywa/Edutrix가 아니라 **ClassNote에 직접** 알림장을 쓴다.
 * 그래서 `lesson_reports` 기반 작성률(수학)엔 영어가 0건으로 잡힌다 — 빼는 게 아니라
 * **다른 소스로 세야** 하는 문제다. 소스는 워커가 적재하는 `classnote_class_posts`(0140a).
 *
 * 셈법:
 *   분모 = 그 반의 **수업일 수** = eywa 시간표 요일 ∩ 기간 − 공휴일
 *   분자 = 그 반 보드에 **글이 올라온 서로 다른 날 수**
 * 영어 보드는 반 단위(수학은 학생 단위)라 "하루 1건"이 정상 → 건수가 아니라 **날짜**로 센다.
 *
 * ⚠️ 분모는 **현재 시간표 기준**이다(원장 확인 2026-07-23). 실제 수업 요일이 시간표와 어긋난
 *    반이 있어 `offSchedule`(요일 밖 작성일 수)을 함께 돌려준다 — 그 값이 크면 시간표를 의심할 것.
 */

/** 요일 키 — `class_schedules.day_of_week`와 같은 표기. */
export type Dow = "sun" | "mon" | "tue" | "wed" | "thu" | "fri" | "sat";
const DOW_ORDER: Dow[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DOW_LABEL = ["일", "월", "화", "수", "목", "금", "토"];

/** eywa 영어 반 1개 — 시간표에서 뽑은 요일 집합과 담당. */
export type EnglishClassInput = {
  classId: string;
  className: string;
  teacher: string | null;
  dows: Dow[];
};

/** 적재된 작성일 1건(`classnote_class_posts`). */
export type ClassPostDay = { boardName: string; postedOn: string };

export type EnglishClassRate = {
  classId: string;
  className: string;
  teacher: string;
  dowLabel: string;
  /** 기간 내 수업일(공휴일 제외). */
  sessions: number;
  /** 그중 작성된 날. */
  written: number;
  /** null = 수업일 0(계산 불가) — 0%로 표시하면 거짓이다. */
  rate: number | null;
  /** 시간표 요일이 아닌 날에 올라온 작성일 수 — 크면 시간표가 실제와 다르다는 신호. */
  offSchedule: number;
  /** 보드를 못 찾음(= ClassNote에 이 반 보드가 없음). */
  unmatched: boolean;
};

/** YYYY-MM-DD → 요일. UTC로 고정 파싱(문자열 날짜라 타임존 영향 없음). */
export function dowOf(ymd: string): Dow {
  const [y, m, d] = ymd.split("-").map(Number);
  return DOW_ORDER[new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).getUTCDay()]!;
}

/** 기간 내 날짜 목록(공휴일 제외). from·to 포함. */
export function sessionDates(from: string, to: string, holidays: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    if (!holidays.has(iso)) out.push(iso);
  }
  return out;
}

/**
 * 반 이름 ↔ 보드 이름 비교키.
 *
 * eywa `중등E_초등 브릿지 C2` ↔ ClassNote `Hannah 초등 브릿지C2 (월화목)`
 * eywa `LS2a`               ↔ ClassNote `[EIE] Let's Speak 2a (화목금 …)`
 * 부서 접두어·강사 닉네임·요일/시각 꼬리를 떼고 공백·기호를 지운 뒤 비교한다.
 */
const EIE_ABBR: Record<string, string> = {
  LT: "letstalk", LS: "letsspeak", RTT: "readytotalk", DP: "drphonics",
  KW: "kopiwang", MEC: "mec", JP: "juniorplus", PL: "prelets", PJ: "prejunior",
};
/** 보드 이름 앞에 붙는 강사 닉네임(떼어낸다). 새 강사가 생기면 여기 추가. */
const BOARD_NICKS = [
  "jane", "hannah", "daniella", "elsa", "charlie", "anna", "sam",
  "kristine", "florence", "dom", "amy", "sarah", "hailey", "부원장", "교수부장",
];

const squeeze = (s: string) => s.toLowerCase().replace(/[\s'’.\-_()[\]]/g, "");

export function classKey(className: string): string {
  const s = String(className ?? "").trim().replace(/^(중등E|중고E|고등E|초등E)_\s*/, "");
  const m = s.match(/^([A-Za-z]+)\s*([0-9].*)$/);
  const full = m && EIE_ABBR[m[1]!.toUpperCase()];
  return full ? squeeze(full + m![2]) : squeeze(s);
}

export function boardKey(boardName: string): string {
  let s = String(boardName ?? "").trim()
    .replace(/\((?:[월화수목금토일]{2,}|매일)[^)]*\)\s*$/, "")
    .replace(/\([^)]*\d{1,2}:\d{2}[^)]*\)\s*$/, "")
    .replace(/^\[EIE\]\s*/i, "");
  for (const n of BOARD_NICKS) {
    const re = new RegExp(`^${n}\\s*t?\\s+`, "i");
    if (re.test(s)) { s = s.replace(re, ""); break; }
  }
  return squeeze(s);
}

/**
 * 반별 작성률. `posts`는 적재된 (보드, 날짜) 전건.
 * 보드를 못 찾은 반은 `unmatched: true`로 표시하고 written=0으로 둔다 — 조용히 0%로 섞으면
 * "안 썼다"와 "보드가 없다"를 구분할 수 없다.
 */
export function computeEnglishRates(
  classes: readonly EnglishClassInput[],
  posts: readonly ClassPostDay[],
  opts: { from: string; to: string; holidays?: Iterable<string> },
): EnglishClassRate[] {
  const holidays = new Set(opts.holidays ?? []);
  const dates = sessionDates(opts.from, opts.to, holidays);

  const daysByBoard = new Map<string, Set<string>>();
  for (const p of posts) {
    const k = boardKey(p.boardName);
    const set = daysByBoard.get(k) ?? new Set<string>();
    set.add(p.postedOn);
    daysByBoard.set(k, set);
  }

  return classes.map((c) => {
    const dows = new Set(c.dows);
    const sessionDays = dates.filter((d) => dows.has(dowOf(d)));
    const posted = daysByBoard.get(classKey(c.className));
    const written = posted ? sessionDays.filter((d) => posted.has(d)).length : 0;
    const offSchedule = posted
      ? [...posted].filter((d) => d >= opts.from && d <= opts.to && !sessionDays.includes(d)).length
      : 0;
    return {
      classId: c.classId,
      className: c.className,
      teacher: c.teacher ?? "(미지정)",
      dowLabel: [...dows].sort((a, b) => DOW_ORDER.indexOf(a) - DOW_ORDER.indexOf(b))
        .map((d) => DOW_LABEL[DOW_ORDER.indexOf(d)]).join(""),
      sessions: sessionDays.length,
      written,
      rate: sessionDays.length ? Math.round((written / sessionDays.length) * 100) : null,
      offSchedule,
      unmatched: !posted,
    };
  });
}

export type EnglishTeacherRate = {
  teacher: string;
  classes: number;
  sessions: number;
  written: number;
  rate: number | null;
};

/** 강사별 합계 — 반별 결과를 접는다. 수업일 0인 강사는 rate=null. */
export function foldByTeacher(rows: readonly EnglishClassRate[]): EnglishTeacherRate[] {
  const acc = new Map<string, EnglishTeacherRate>();
  for (const r of rows) {
    const e = acc.get(r.teacher) ?? { teacher: r.teacher, classes: 0, sessions: 0, written: 0, rate: null };
    e.classes += 1;
    e.sessions += r.sessions;
    e.written += r.written;
    acc.set(r.teacher, e);
  }
  return [...acc.values()]
    .map((e) => ({ ...e, rate: e.sessions ? Math.round((e.written / e.sessions) * 100) : null }))
    .sort((a, b) => (a.rate ?? 999) - (b.rate ?? 999));
}
