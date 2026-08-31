/**
 * 월간 목표 ↔ 실제 진행 교재 대조 — **경고 판정 단일 소스**(순수, Vitest).
 *
 * 원장 2026-08-31: *"목표와 실제가 어긋났을 때 해당 요일에 경고 처리할 수 있는 테두리나 색 등으로."*
 * 달력의 요일 칸·진도표의 날짜 열·목표 스트립의 한 줄이 **전부 이 함수 하나**를 통과한다 —
 * 세 곳이 각자 판정하면 같은 날이 한 화면에서 경고이면서 아닌 게 된다.
 *
 * 🔴 **표기 흔들림은 어긋남이 아니다.** 실측(중등E_초6 SKY 2026-08)에서 같은 책이
 *    `그래머인사이드LV3` · `그래머인사이드 3` · `Grammar Inside 3` 세 가지로 적혀 있었다.
 *    공백·기호를 지우고 **한쪽이 다른 쪽에 들어 있으면 같은 책**으로 본다 — 거짓 경보가 잦으면
 *    사람이 경고를 통째로 무시하게 되고, 그러면 진짜 어긋남(목표는 해커스 리딩스마트3인데 내내
 *    수능딥독을 나간 7일)이 함께 묻힌다.
 * 🔴 **목표가 비어 있으면 판정하지 않는다** — 견줄 것이 없는데 경고를 띄우면 "목표를 안 적었다"는
 *    사실이 "다른 책을 나갔다"로 둔갑한다(실측 Listening·Writing·Speaking이 그렇다).
 * 🔴 **자리(LAB·JJ) 교시는 대상이 아니다** — 그 칸은 반 진도가 아니라 학생 개별 진도(인재원 SRS·PL·PV)라
 *    반의 월간 목표와 견줄 축이 아니다.
 */

/** 비교 전에 지우는 문자 — 표기 흔들림의 실제 정체(공백·중점·괄호·하이픈). */
const DROP_CHARS = new Set([" ", "\t", "·", "・", ".", ",", "(", ")", "[", "]", "-", "_", "/"]);

/** 교재명 비교 키 — 소문자화 + 위 문자 제거. 표시에는 쓰지 않는다(원문 보존). */
export function normalizeBookName(v: string | null | undefined): string {
  const s = String(v ?? "").toLowerCase();
  let out = "";
  for (const ch of s) if (!DROP_CHARS.has(ch)) out += ch;
  return out;
}

/**
 * 같은 책인가 — 한쪽이 비면 **비교 불가라 `true`**(경고를 만들지 않는다).
 * 포함 관계면 같은 책으로 본다(`그래머인사이드` ⊂ `그래머인사이드LV3`).
 */
export function sameBookName(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeBookName(a);
  const y = normalizeBookName(b);
  if (!x || !y) return true;
  return x.includes(y) || y.includes(x);
}

/** 그 달 목표 — `skill_area` → 교재/목표 진도. 빈 칸도 키가 있을 수 있다(입력만 하고 지운 경우). */
export type MonthGoalMap = Record<string, { textbook: string | null; targetProgress: string | null }>;

export type PlanLineLike = {
  skillArea: string;
  textbook: string | null;
  /** 자리(LAB·JJ) 교시의 줄인가 — 판정 제외. */
  seat: boolean;
};

/** 이 줄이 "월간 목표에 적힌 책이 아닌 책"인가. */
export function isOffGoalLine(line: PlanLineLike, goals: MonthGoalMap): boolean {
  if (line.seat) return false;
  const goal = goals[line.skillArea];
  if (!goal || !goal.textbook) return false;
  return !sameBookName(goal.textbook, line.textbook);
}

/**
 * 날짜별 어긋난 줄 수 — 달력 칸 배지(`목표 밖 N`)와 진도표 날짜 열 강조가 같이 쓴다.
 * ⚠️ **날짜가 키다**(교시가 아니라) — 원장 지시가 "해당 요일에 경고"였고, 한 날에 두 교시가
 *    어긋나면 그 날이 두 번 경고되는 게 아니라 한 날에 2건이다.
 */
export function offGoalCountByDate(
  lines: readonly (PlanLineLike & { planDate: string })[],
  goals: MonthGoalMap,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of lines) {
    if (!isOffGoalLine(line, goals)) continue;
    out[line.planDate] = (out[line.planDate] ?? 0) + 1;
  }
  return out;
}

/**
 * 그 영역에서 이 달에 **실제로 나간 교재**(중복 제거, 등장 순). 목표 칸 아래 한 줄과
 * "실제로 맞추기"가 쓴다. 자리 교시와 빈 교재는 뺀다(반 진도가 아니거나 사실이 없다).
 */
export function actualBooksOf(
  lines: readonly PlanLineLike[],
  skillArea: string,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    if (line.seat || line.skillArea !== skillArea) continue;
    const book = (line.textbook ?? "").trim();
    if (!book || seen.has(book)) continue;
    seen.add(book);
    out.push(book);
  }
  return out;
}

/** 그 영역에서 목표 밖으로 나간 교재만(목표가 없으면 빈 배열 — 어긋남이라 부를 수 없다). */
export function offGoalBooksOf(
  lines: readonly PlanLineLike[],
  skillArea: string,
  goals: MonthGoalMap,
): string[] {
  const goal = goals[skillArea];
  if (!goal || !goal.textbook) return [];
  return actualBooksOf(lines, skillArea).filter((book) => !sameBookName(goal.textbook, book));
}
