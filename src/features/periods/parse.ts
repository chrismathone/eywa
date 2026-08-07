// 세션 기간 붙여넣기 파서 — 순수 함수(Vitest 강제).
//
// 원장이 연간계획표(종이·사진)를 보며 12줄을 친다. 그래서 **관대하게** 받는다:
//   "3/6~4/2" · "3/6-4/2" · "03.06 ~ 04.02" · "3월 3/6~4/2" · "2026-03-06~2026-04-02"
// 라벨월은 **시작일의 월**이다(2월 세션이 3/5에 끝나도 라벨은 2월 — 원장 2026-08-07
// *"영어는 매달이 그 세션이야 2월 세션은 3월 5일까지 간다는 뜻"*).
// 줄 앞에 "3월"처럼 명시하면 그쪽이 우선한다(방학으로 건너뛴 달을 사람이 못박을 수 있게).

export type ParsedLine = {
  lineNo: number; // 1-based, 오류를 사람에게 짚어주기 위해
  raw: string;
  labelMonth: number;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  error?: undefined;
};

export type ParseError = {
  lineNo: number;
  raw: string;
  error: string; // 한글 — 화면에 그대로 노출된다
  labelMonth?: undefined;
};

export type ParseResult = {
  rows: ParsedLine[];
  errors: ParseError[];
};

// 전각 물결·다양한 대시·점을 표준화. 한글 "월"은 라벨 표시로만 쓰이므로 분리해 둔다.
function normalize(s: string): string {
  return s
    .replace(/[～〜]/g, "~")
    .replace(/[–—−]/g, "-")
    .replace(/ /g, " ")
    .trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 그 달의 말일(윤년 포함). */
function lastDayOf(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** "3/6" | "03.06" | "2026-03-06" → {month, day, year?} */
function parseOneDate(token: string): { month: number; day: number; year?: number } | null {
  const t = token.trim();
  let m = t.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  m = t.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (m) return { month: Number(m[1]), day: Number(m[2]) };
  return null;
}

function valid(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOf(year, month);
}

/**
 * 여러 줄 → 세션 행들. 빈 줄은 건너뛴다(오류 아님 — 방학 달을 비워 두는 게 정상).
 *
 * ⚠️ 여기서 겹침·회차는 검사하지 않는다. 겹침은 DB(EXCLUDE)와 저장 전 경고가,
 *    "월~금 각 4회"는 verify.ts가 본다. 파서는 **모양만** 책임진다.
 */
export function parsePeriodLines(year: number, text: string): ParseResult {
  const rows: ParsedLine[] = [];
  const errors: ParseError[] = [];
  const seenMonths = new Set<number>();

  text.split(/\r?\n/).forEach((rawLine, i) => {
    const lineNo = i + 1;
    const raw = rawLine.trim();
    if (!raw) return;

    const line = normalize(raw);

    // 선택적 월 라벨: "3월 ..." / "3) ..." / "3. ..." — 뒤에 날짜 구간이 이어질 때만 라벨로 인정.
    let forcedMonth: number | null = null;
    const labelMatch = line.match(/^(\d{1,2})\s*(?:월|\)|:)\s+(.*)$/);
    const body = labelMatch ? labelMatch[2].trim() : line;
    if (labelMatch) {
      const lm = Number(labelMatch[1]);
      if (lm < 1 || lm > 12) {
        errors.push({ lineNo, raw, error: `"${labelMatch[1]}월"은 1~12월이 아닙니다` });
        return;
      }
      forcedMonth = lm;
    }

    const parts = body.split(/\s*[~]\s*|\s+-\s+/);
    if (parts.length !== 2) {
      errors.push({ lineNo, raw, error: "시작과 끝을 '~'로 이어주세요 (예: 3/6~4/2)" });
      return;
    }

    const a = parseOneDate(parts[0]);
    const b = parseOneDate(parts[1]);
    if (!a || !b) {
      errors.push({ lineNo, raw, error: "날짜를 읽을 수 없습니다 (예: 3/6~4/2)" });
      return;
    }

    const startYear = a.year ?? year;
    if (!valid(startYear, a.month, a.day)) {
      errors.push({ lineNo, raw, error: `시작 날짜가 실제로 없는 날입니다 (${a.month}/${a.day})` });
      return;
    }

    // 끝 연도: 명시가 없으면 시작보다 앞선 달일 때만 다음 해(12/28~1/24).
    const endYear = b.year ?? (b.month < a.month ? startYear + 1 : startYear);
    if (!valid(endYear, b.month, b.day)) {
      errors.push({ lineNo, raw, error: `끝 날짜가 실제로 없는 날입니다 (${b.month}/${b.day})` });
      return;
    }

    const startDate = `${startYear}-${pad(a.month)}-${pad(a.day)}`;
    const endDate = `${endYear}-${pad(b.month)}-${pad(b.day)}`;
    if (startDate > endDate) {
      errors.push({ lineNo, raw, error: "끝 날짜가 시작 날짜보다 빠릅니다" });
      return;
    }

    const labelMonth = forcedMonth ?? a.month;
    if (seenMonths.has(labelMonth)) {
      errors.push({ lineNo, raw, error: `${labelMonth}월이 두 번 나옵니다 — 한 달에 세션은 하나입니다` });
      return;
    }
    seenMonths.add(labelMonth);

    rows.push({ lineNo, raw, labelMonth, startDate, endDate });
  });

  return { rows, errors };
}

/** 저장된 행들 → 붙여넣기 텍스트(복사·재편집용). "3/6~4/2" 한 줄씩. */
export function formatPeriodLines(
  rows: readonly { labelMonth: number; startDate: string; endDate: string }[],
): string {
  const short = (iso: string) => {
    const [, mm, dd] = iso.split("-");
    return `${Number(mm)}/${Number(dd)}`;
  };
  return [...rows]
    .sort((a, b) => a.labelMonth - b.labelMonth)
    .map((r) => `${r.labelMonth}월 ${short(r.startDate)}~${short(r.endDate)}`)
    .join("\n");
}
