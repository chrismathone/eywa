/**
 * **계획(MP) ↔ 실제(주간 시트) 대조** — 판정 단일 소스(순수 · Vitest).
 *
 * 원장 2026-09-01: *"과연 진도가 제대로 나가고 있는지도 점검하기 위해서임."*
 * 계획은 `class_month_plan_cells`(사전 입력), 실제는 `class_sheet_plan_lines`(수업하며 입력)다.
 * 화면 칸·요약 배지·툴바 숫자가 **전부 이 함수 하나**를 통과한다 — 세 곳이 각자 판정하면 같은 날이
 * 한 화면에서 경고이면서 아닌 게 된다(달력의 `goal-match`가 같은 이유로 단일 소스다).
 *
 * 🔴 **신호는 셋뿐이다.**
 *   · `unwritten`(미작성) — 계획은 있는데 그 날 실제 줄이 0
 *   · `off-book`(교재 다름) — 계획이 이름 댄 교재가 그 날 실제 줄의 `textbook` 어디에도 안 나옴
 *   · `no-plan`(계획 없음) — 실제는 있는데 계획 칸이 빔. **경고가 아니다**(회색) — 지난 달을
 *     열어 보면 대부분이 이 상태다(MP는 2026-09에 처음 생겼다).
 *
 * 🔴 **자유 텍스트를 정밀 비교하지 않는다.** `SB 6-8`의 쪽 범위와 실제 `page_range`를 견주는 것은
 *    범위 밖이다 — 거짓 경보가 잦으면 사람이 경고를 통째로 무시하고, 그러면 진짜 어긋남이 함께 묻힌다
 *    (goal-match.ts가 같은 이유로 표기 흔들림을 같은 책으로 본다).
 * 🔴 **모르면 판정하지 않는다.** 계획이 교재 이름을 안 댔거나(=`Monthly Test`처럼 범위가 없거나)
 *    실제 줄에 교재가 하나도 안 적혀 있으면 `ok`다. "안 적었다"를 "다른 책을 나갔다"로 둔갑시키지 않는다.
 */
import type { SemanticTone } from "@/lib/design/semantic-color";
import { sameBookName } from "./goal-match";
import { slotKey } from "./month-assemble";
import { MP_ALL_COLUMNS, mpCellKey, mpHasBody, type MpCellMap } from "./month-plan";

/** 대조에 필요한 실제 줄의 최소 모양(서버 타입에 안 묶어 순수하게 테스트된다). */
export type MpActualLine = {
  slotStart: string;
  textbook: string | null;
  pageRange: string | null;
  progress: string | null;
  /** 자리(LAB·JJ) 교시의 줄인가 — 반 진도가 아니라 학생 개별 진도다. */
  seat: boolean;
};

export type MpDayStatus = "off" | "empty" | "ok" | "unwritten" | "off-book" | "no-plan";

export type MpDayVerdict = {
  status: MpDayStatus;
  /** 계획에서 읽어 낸 교재 이름(대조에 실제로 쓴 값) — 툴팁이 "무엇과 견줬는지" 말할 수 있게. */
  planBooks: string[];
  /** 그 날 실제 줄에 적힌 교재(중복 제거, 등장 순). */
  actualBooks: string[];
};

/**
 * 신호 → tone(의미색 캐논). 🔴 **화면 파일에 이 맵을 다시 만들지 말 것** — 뜻과 색이 갈리면 같은 날이
 * 툴바에선 주의, 표에선 회색이 된다(팔레트 v4의 "같은 뜻 = 같은 색").
 *  · 주의(caution) = 사람이 손을 대야 하는 것 · 무채(inert) = 사실이지만 할 일이 아닌 것
 *  · `null` = 아무 표식도 안 붙인다(정상·빈 날).
 * 🔴 `no-plan`은 **경고가 아니다** — 지난 달은 대부분 그 상태다(MP는 2026-09에 처음 생겼다).
 */
export const MP_STATUS_TONE: Record<MpDayStatus, SemanticTone | null> = {
  off: "inert",
  empty: null,
  ok: null,
  unwritten: "caution",
  "off-book": "caution",
  "no-plan": "inert",
};

/** 경고로 칠하는 신호인가 — 회색(`no-plan`)·정상은 아니다. */
export function mpIsWarning(status: MpDayStatus): boolean {
  return MP_STATUS_TONE[status] === "caution";
}

/** 화면·툴팁에 쓰는 한글 라벨(raw 키 노출 금지의 단일 출처). */
export const MP_STATUS_LABEL: Record<MpDayStatus, string> = {
  off: "휴강",
  empty: "계획·기록 없음",
  ok: "계획대로",
  unwritten: "미작성",
  "off-book": "교재 다름",
  "no-plan": "계획 없음",
};

export const MP_STATUS_HINT: Record<MpDayStatus, string> = {
  off: "이 날은 휴강입니다(인쇄에서 빠집니다)",
  empty: "계획도 실제 기록도 없습니다",
  ok: "계획에 적은 교재가 그 날 기록에도 있습니다",
  unwritten: "계획은 있는데 그 날 주간 시트에 기록이 없습니다",
  "off-book": "계획에 적은 교재가 그 날 기록 어디에도 없습니다",
  "no-plan": "기록은 있는데 계획 칸이 비어 있습니다(경고 아님)",
};

/**
 * 계획 칸에서 **교재 이름**만 뽑는다 — 시트 표기(`SB 6-8`, `WB 4-5 (문장 녹음)`, `SB 6-8 & SB 19-11`)에서
 * 숫자 앞까지가 책 이름이다.
 *
 * 🔑 **숫자가 붙은 조각만 후보로 본다.** `Monthly Test`·`NO TEST`·`단어 암기`처럼 범위가 없는 줄은
 *    책 이름이 아니라 지시문이라, 그것을 교재로 오인하면 그 날이 통째로 '교재 다름'이 된다.
 *    후보가 하나도 없으면 호출부는 **판정을 건너뛴다**.
 * ⚠️ 괄호 주석은 이름 뒤에 오므로 숫자 컷에 이미 걸리거나(`PB 2-4 (문장 녹음)`) 후보에서 빠진다.
 */
export function mpPlanBookNames(body: string | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(body ?? "").split(/[\n&]+/u)) {
    const seg = raw.trim();
    if (!seg) continue;
    const m = seg.match(/^(.*?)\s*\d/u);
    const name = (m?.[1] ?? "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/**
 * 그 날의 실제 줄을 **교시 순으로** 모은다 — 화면 칸과 툴바 숫자가 같은 재료를 보게 하는 자리.
 *
 * 🔴 두 벌로 두지 말 것: 한쪽만 자리(LAB·JJ) 줄을 빼거나 순서를 바꾸면 같은 날이 화면에선 '미작성'인데
 *    툴바에선 아니게 된다. 인자는 **구조만** 받는다(서버 타입에 안 묶여야 순수하게 테스트된다).
 */
export function mpLinesOfDate(
  source: {
    slotsByDate: Readonly<Record<string, readonly { slotStart: string }[] | undefined>>;
    linesBySlot: Readonly<Record<string, readonly MpActualLine[] | undefined>>;
  },
  date: string,
): MpActualLine[] {
  const out: MpActualLine[] = [];
  for (const slot of source.slotsByDate[date] ?? []) {
    for (const line of source.linesBySlot[slotKey(date, slot.slotStart)] ?? []) out.push(line);
  }
  return out;
}

/** 그 날 실제 줄에 적힌 교재(중복 제거, 등장 순). 빈 값은 뺀다. */
export function mpActualBooks(lines: readonly MpActualLine[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const book = (line.textbook ?? "").trim();
    if (!book || seen.has(book)) continue;
    seen.add(book);
    out.push(book);
  }
  return out;
}

/**
 * 그 날의 실제 요약 — 교시 순으로 이어 붙인 한 줄씩(`교재 쪽 · 진도`).
 * ⚠️ 정렬은 **조회가 이미 해 둔 순서**(plan_date → slot_start → line_no)를 그대로 믿는다.
 *    여기서 다시 정렬하면 같은 교시 안의 줄 순서(line_no)를 잃는다.
 */
export function mpActualSummary(lines: readonly MpActualLine[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const head = [line.textbook, line.pageRange]
      .map((v) => (v ?? "").trim())
      .filter(Boolean)
      .join(" ");
    const tail = (line.progress ?? "").trim();
    const text = [head, tail].filter(Boolean).join(" · ");
    if (text) out.push(text);
  }
  return out;
}

/**
 * 한 날의 판정. `isOff`면 아무것도 견주지 않는다(휴강은 계획도 기록도 없는 게 정상이다).
 *
 * ⚠️ **자리(LAB·JJ) 줄은 교재 대조에서 뺀다**(goal-match와 같은 규약 — 반 진도가 아니라 학생 개별
 *    진도라 반의 계획과 견줄 축이 아니다). 다만 **"기록이 있나"는 자리 줄도 센다** — 자리만 도는 날에
 *    '미작성'을 띄우면 실제로 기록이 있는데 없다고 말하는 셈이다.
 */
export function mpCompareDay(input: {
  date: string;
  cells: MpCellMap;
  lines: readonly MpActualLine[];
  isOff: boolean;
}): MpDayVerdict {
  const { date, cells, lines, isOff } = input;
  const empty: MpDayVerdict = {
    status: "empty",
    planBooks: [],
    actualBooks: [],
  };
  if (isOff) return { ...empty, status: "off" };

  const hasPlan = MP_ALL_COLUMNS.some((k) => mpHasBody(cells, date, k));
  const hasAnyLine = lines.length > 0;
  if (!hasPlan) return hasAnyLine ? { ...empty, status: "no-plan" } : empty;
  if (!hasAnyLine) return { ...empty, status: "unwritten", planBooks: [] };

  // 대조 축은 **In-class** 하나다 — 그 칸이 "그 날 반이 나갈 책"을 이름 댄다(Homework의 WB·PB는
  // 집에서 하는 책이라 주간 시트의 그 날 기록에 안 나오는 게 정상이다).
  const planBooks = mpPlanBookNames(cells[mpCellKey(date, "in_class")]);
  const classLines = lines.filter((l) => !l.seat);
  const actualBooks = mpActualBooks(classLines);
  if (planBooks.length === 0 || actualBooks.length === 0) {
    return { status: "ok", planBooks, actualBooks };
  }
  const matched = planBooks.some((p) => actualBooks.some((a) => sameBookName(p, a)));
  return { status: matched ? "ok" : "off-book", planBooks, actualBooks };
}

/** 그 달의 신호 집계 — 툴바 한 줄("미작성 N일 · 교재 다름 N일")이 쓴다. */
export function mpSummarize(verdicts: readonly MpDayVerdict[]): {
  unwritten: number;
  offBook: number;
  noPlan: number;
  /** 휴강을 뺀 수업일 중 계획을 적은 날 수 / 전체(계획 작성률). */
  planned: number;
  scheduled: number;
} {
  let unwritten = 0;
  let offBook = 0;
  let noPlan = 0;
  let planned = 0;
  let scheduled = 0;
  for (const v of verdicts) {
    if (v.status === "off") continue;
    scheduled += 1;
    if (v.status === "unwritten") unwritten += 1;
    if (v.status === "off-book") offBook += 1;
    if (v.status === "no-plan") noPlan += 1;
    // 🔴 계획을 적은 날 = 계획 없음/빈 날을 뺀 나머지. 신호(미작성·교재 다름)는 **계획이 있어야**
    //    나오는 상태라 여기 포함된다 — 안 그러면 "계획은 썼는데 미작성"인 날이 분자에서 사라져
    //    작성률이 스스로를 벌한다.
    if (v.status !== "no-plan" && v.status !== "empty") planned += 1;
  }
  return { unwritten, offBook, noPlan, planned, scheduled };
}
