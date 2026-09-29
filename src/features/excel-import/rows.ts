/**
 * 시트(문자열 격자) → 키별 행 + **칸 위치를 아는 파서**. 순수 — 엑셀 라이브러리를 모른다(server/workbook.ts가 격자로 바꿔 준다).
 *
 * 🔑 머리 줄은 **찾는다**(1~5행) — 제목 줄을 한 줄 얹은 파일도 받는다. 못 찾으면 가장 많이 맞은 줄을 기준으로
 *    "무슨 열이 없는지"를 위치와 함께 알려 준다.
 * 🔑 `RowReader`의 파서는 실패하면 **그 칸의 위치**(행·열 글자·열 제목·원래 값)로 오류를 쌓는다.
 */
import {
  blankToNull,
  colLetter,
  mapHeaders,
  parseDate,
  parseInteger,
  parseNumber,
  parseOption,
  parsePhone,
  parseTime,
  parseWeekday,
  parseYesNo,
  type ImportIssue,
  type SheetSpec,
} from "./spec";

export const HEADER_LOOKAHEAD = 5;

export type SheetRows<K extends string> = {
  spec: SheetSpec<K>;
  headerRow: number;
  map: Map<K, number>;
  rows: RowReader<K>[];
};

/** 격자(1-based 행 번호는 index+1) → 머리 줄 찾기 + 행 읽기. 필수 열이 없으면 `issues`에 위치와 함께. */
export function readSheetGrid<K extends string>(
  spec: SheetSpec<K>,
  grid: ReadonlyArray<ReadonlyArray<string>>,
  issues: ImportIssue[],
): SheetRows<K> | null {
  const required = spec.columns.filter((c) => c.required).map((c) => c.key);
  let headerRow = 0;
  let map = new Map<K, number>();
  let best = { row: 1, map: new Map<K, number>() };
  for (let r = 0; r < Math.min(HEADER_LOOKAHEAD, grid.length); r++) {
    const m = mapHeaders(grid[r] ?? [], spec.columns);
    if (m.size > best.map.size) best = { row: r + 1, map: m };
    if (m.size > 0 && required.every((k) => m.has(k))) {
      headerRow = r + 1;
      map = m;
      break;
    }
  }
  if (!headerRow) {
    const missing = spec.columns.filter((c) => c.required && !best.map.has(c.key)).map((c) => `'${c.header}'`);
    const seen = (grid[best.row - 1] ?? []).map((h) => String(h ?? "").trim()).filter(Boolean);
    issues.push({
      sheet: spec.name,
      row: best.row,
      col: null,
      header: null,
      value: null,
      message:
        `필수 열 ${missing.join("·")}이(가) 없습니다 — 열 제목을 서식 그대로 적어 주세요` +
        (seen.length ? ` (지금 ${best.row}행 제목: ${seen.slice(0, 12).join(", ")}${seen.length > 12 ? " …" : ""})` : " (제목 줄이 비어 있습니다)"),
    });
    return null;
  }
  const rows: RowReader<K>[] = [];
  for (let r = headerRow; r < grid.length; r++) {
    const line = grid[r] ?? [];
    const cells: Partial<Record<K, string>> = {};
    let any = false;
    for (const [key, idx] of map) {
      const v = String(line[idx] ?? "").trim();
      cells[key] = v;
      if (v) any = true;
    }
    if (!any) continue;
    rows.push(new RowReader(spec, r + 1, cells, map, issues));
  }
  return { spec, headerRow, map, rows };
}

/** 한 행 — 칸을 읽고, 틀리면 그 칸의 위치로 오류를 남긴다. `ok`는 이 행에서 오류가 났는지. */
export class RowReader<K extends string> {
  ok = true;
  constructor(
    readonly spec: SheetSpec<K>,
    readonly rowNum: number,
    readonly cells: Partial<Record<K, string>>,
    private readonly map: Map<K, number>,
    private readonly sink: ImportIssue[],
  ) {}

  has(key: K): boolean {
    return this.map.has(key);
  }
  raw(key: K): string {
    return this.cells[key] ?? "";
  }

  /** 이 칸의 오류. key가 없으면 행 전체 오류. */
  fail(key: K | null, message: string): void {
    this.ok = false;
    const idx = key ? this.map.get(key) : undefined;
    const header = key ? (this.spec.columns.find((c) => c.key === key)?.header ?? null) : null;
    this.sink.push({
      sheet: this.spec.name,
      row: this.rowNum,
      col: idx !== undefined ? colLetter(idx) : null,
      header,
      value: key ? blankToNull(this.cells[key]) : null,
      message,
    });
  }

  private headerOf(key: K) {
    return this.spec.columns.find((c) => c.key === key)?.header ?? key;
  }

  text(key: K, opt: { required?: boolean; max?: number } = {}): string | null {
    const v = blankToNull(this.cells[key]);
    if (v === null) {
      if (opt.required) this.fail(key, `${this.headerOf(key)}을(를) 적어 주세요(필수)`);
      return null;
    }
    if (opt.max && v.length > opt.max) {
      this.fail(key, `${opt.max}자까지 적을 수 있습니다(지금 ${v.length}자)`);
      return null;
    }
    return v;
  }

  private parsed<T>(key: K, fn: (s: string) => T | null | undefined, wrong: string, required?: boolean): T | null {
    const v = fn(this.cells[key] ?? "");
    if (v === undefined) {
      this.fail(key, wrong);
      return null;
    }
    if (v === null && required) {
      this.fail(key, `${this.headerOf(key)}을(를) 적어 주세요(필수)`);
      return null;
    }
    return v;
  }

  date(key: K, required = false) {
    return this.parsed(key, parseDate, "날짜로 읽을 수 없습니다 — 2026-09-01 모양으로 적어 주세요", required);
  }
  time(key: K, required = false) {
    return this.parsed(key, parseTime, "시각으로 읽을 수 없습니다 — 14:30 모양으로 적어 주세요", required);
  }
  int(key: K, opt: { required?: boolean; min?: number; max?: number } = {}) {
    const v = this.parsed(key, parseInteger, "정수로 읽을 수 없습니다 — 숫자만 적어 주세요", opt.required);
    if (v !== null && ((opt.min !== undefined && v < opt.min) || (opt.max !== undefined && v > opt.max))) {
      this.fail(key, `${opt.min ?? "-∞"}~${opt.max ?? "∞"} 사이여야 합니다`);
      return null;
    }
    return v;
  }
  num(key: K, opt: { required?: boolean; min?: number; max?: number } = {}) {
    const v = this.parsed(key, parseNumber, "숫자로 읽을 수 없습니다", opt.required);
    if (v !== null && ((opt.min !== undefined && v < opt.min) || (opt.max !== undefined && v > opt.max))) {
      this.fail(key, `${opt.min ?? "-∞"}~${opt.max ?? "∞"} 사이여야 합니다`);
      return null;
    }
    return v;
  }
  yesNo(key: K) {
    return this.parsed(key, parseYesNo, "예 / 아니오 중 하나로 적어 주세요");
  }
  phone(key: K) {
    return this.parsed(key, parsePhone, "전화번호로 읽을 수 없습니다 — 010-1234-5678 모양으로 적어 주세요");
  }
  weekday(key: K, required = false) {
    return this.parsed(key, parseWeekday, "요일로 읽을 수 없습니다 — 월·화·수·목·금·토·일 중 하나", required);
  }
  option<V>(key: K, table: ReadonlyArray<{ label: string; value: V; aliases?: readonly string[] }>, required = false): V | null {
    const labels = table.map((t) => t.label);
    return this.parsed(
      key,
      (s) => parseOption(s, table),
      `목록에 없는 값입니다 — ${labels.slice(0, 12).join(" · ")}${labels.length > 12 ? " …" : ""} 중 하나`,
      required,
    );
  }
}
