/**
 * 엑셀 가져오기 공용 규약 — 순수(서버·화면·Vitest가 함께 읽는다). 원장 2026-09-29:
 * *"엑셀 파일 업로드로 db 추가 가능하게 할 수 있는 곳은 모두 (기존 재고 관리 탭처럼)"* ·
 * *"엑셀 업로드시에 기존 데이터 덮어씌울지 혹은 추가할지 선택가능하게"* ·
 * *"양식에 안맞으면 어디서 업로드 에러가 나는지도 확인가능하게"*.
 *
 * 🔑 **내려받는 서식 = 올리는 서식**(같은 시트 이름·같은 열 제목). 열 순서는 자유 — 제목으로 찾는다.
 * 🔑 **추가**(append) = 이미 있는 것은 건너뛰고 새 행만 · **덮어쓰기**(overwrite) = 있는 것은 파일 값으로 바꾸고 새 행도 넣는다.
 *    무엇이 "이미 있는 것"인지(매칭 키)는 가져오기마다 다르고, 서식 안내 시트와 화면이 그 키를 적는다.
 * 🔑 **오류는 위치로 말한다** — `'원생' 시트 12행 C열(학교)`. 오류가 하나라도 있으면 아무것도 쓰지 않는다(전부 또는 전무).
 * 🔑 빈 칸은 null(`미기재`·`—`·`-`도 빈 칸으로 본다). 덮어쓰기에서 **빈 칸은 지우지 않는다**(원래 값 유지) —
 *    엑셀 한 열을 비워 올렸다고 전 원생의 연락처가 사라지면 되돌릴 수 없다.
 */

export type ExcelMode = "append" | "overwrite";
export const EXCEL_MODE_LABEL: Record<ExcelMode, string> = { append: "추가", overwrite: "덮어쓰기" };
export function isExcelMode(v: unknown): v is ExcelMode {
  return v === "append" || v === "overwrite";
}

export type ColumnSpec<K extends string = string> = {
  key: K;
  header: string;
  width?: number;
  /** 이 열이 없으면 서식 불일치(업로드 취소). */
  required?: boolean;
  /** 제목의 다른 이름(기존 시스템에서 내보낸 파일도 받게) — 공백은 무시하고 비교한다. */
  aliases?: readonly string[];
  /** 안내 시트에 적는 설명. */
  hint?: string;
  /** 드롭다운 목록(서식에 데이터 유효성으로 건다). */
  options?: readonly string[];
  /** true면 목록 밖 값을 엑셀이 거절한다. */
  strictOptions?: boolean;
  /**
   * 서식엔 싣지 않고 **읽기만** 하는 열 — 그 탭의 엑셀 내보내기 파일에만 있는 열(예: 수업목록의 '상태'·'구분')을 알아보기 위해.
   */
  exportOnly?: boolean;
};

export type SheetSpec<K extends string = string> = {
  name: string;
  columns: readonly ColumnSpec<K>[];
  /** 매칭 키 설명(안내 시트·화면) — 예: "이름 + 학교 + 학년". */
  keyHint?: string;
  /** 없어도 되는 시트(파일에 없으면 건너뛴다). */
  optional?: boolean;
  /**
   * 시트 이름의 다른 이름 — 그 탭의 **엑셀 내보내기** 파일 시트(예: 반 ← '수업목록')를 그대로 받게(원장 2026-09-29
   * *"전부다 맞추기도 맞출것"*: 내보낸 파일을 고쳐 올려도 들어가야 한다).
   */
  aliases?: readonly string[];
};

/** 오류 한 건 — 어디(시트·행·열)에서 무엇이 틀렸나. 행·열이 없으면 시트 전체의 문제. */
export type ImportIssue = {
  sheet: string;
  row: number | null;
  /** 엑셀 열 글자(A, B, …, AA). */
  col: string | null;
  header: string | null;
  value: string | null;
  message: string;
};

export type PreviewAction = "insert" | "update" | "skip";
export type ImportPreviewRow = { sheet: string; rowNum: number; key: string; action: PreviewAction; summary: string };
export type ImportCounts = { label: string; total: number; insert: number; update: number; skip: number };

export type ImportResult = {
  error?: string;
  /** 서식 자체가 안 맞음(시트·열 제목) — 화면이 파일 선택을 취소하되, 위치 목록은 남긴다. */
  formatMismatch?: boolean;
  mode?: ExcelMode;
  dryRun?: boolean;
  counts?: ImportCounts[];
  preview?: ImportPreviewRow[];
  /** 보여 줄 만큼만(최대 ISSUE_MAX). 전체 건수는 `issueTotal`. */
  issues?: ImportIssue[];
  issueTotal?: number;
  notes?: string[];
  applied?: boolean;
};

export const ISSUE_MAX = 300;
export const PREVIEW_MAX = 300;
export const MAX_BYTES = 5 * 1024 * 1024;

/** 0-based 열 번호 → 엑셀 열 글자(0 → A, 26 → AA). */
export function colLetter(idx: number): string {
  let n = idx + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const squash = (s: string) => s.replace(/\s+/g, "").replace(/\*$/, "").toLowerCase();

/** 머리 줄 텍스트 → 키별 열 번호(0-based). 제목·키·별칭 모두 받는다(공백·끝의 `*` 무시). */
export function mapHeaders<K extends string>(headers: ReadonlyArray<string>, columns: readonly ColumnSpec<K>[]): Map<K, number> {
  const out = new Map<K, number>();
  headers.forEach((raw, idx) => {
    const h = squash(String(raw ?? ""));
    if (!h) return;
    const col = columns.find(
      (c) => squash(c.header) === h || c.key.toLowerCase() === h || (c.aliases ?? []).some((a) => squash(a) === h),
    );
    if (col && !out.has(col.key)) out.set(col.key, idx);
  });
  return out;
}

/** 오류 한 줄(사람용) — `'원생' 시트 12행 C열(학교) · 값 "칠성중ㅇ" — 학교 이름을 확인하세요`. */
export function issueText(i: ImportIssue): string {
  const where = [`'${i.sheet}' 시트`, i.row ? `${i.row}행` : null, i.col ? `${i.col}열${i.header ? `(${i.header})` : ""}` : null]
    .filter(Boolean)
    .join(" ");
  const val = i.value ? ` · 값 "${i.value.length > 40 ? `${i.value.slice(0, 39)}…` : i.value}"` : "";
  return `${where}${val} — ${i.message}`;
}

// ── 값 정규화(순수) ──────────────────────────────────────────────────────────────────

export const BLANK_MARKERS: readonly string[] = ["", "-", "—", "미기재", "없음", "해당없음", "해당 없음"];
export function blankToNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return BLANK_MARKERS.includes(s) ? null : s;
}

/** 날짜 → `YYYY-MM-DD`. 빈 값 null · 못 읽으면 undefined(오류). `2026.9.1`·`2026/09/01`·`20260901`·`26-09-01` 허용. */
export function parseDate(raw: string | null | undefined): string | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  const t = s.replace(/\s+/g, "").replace(/\.$/, "");
  let m = /^(\d{4})[-./년]?(\d{1,2})[-./월]?(\d{1,2})일?$/.exec(t);
  if (!m) {
    const y2 = /^(\d{2})[-./](\d{1,2})[-./](\d{1,2})$/.exec(t);
    if (y2) m = [y2[0], `20${y2[1]}`, y2[2]!, y2[3]!] as unknown as RegExpExecArray;
  }
  if (!m) return undefined;
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  const iso = `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const back = new Date(`${iso}T00:00:00Z`);
  return back.getUTCDate() === d ? iso : undefined;
}

/** 시각 → `HH:MM`. `9:00`·`09:00:00`·`930`·`오후 2:30`·엑셀 시각 소수(0.375) 허용. */
export function parseTime(raw: string | null | undefined): string | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  let t = s.replace(/\s+/g, "");
  const frac = /^0?\.\d+$/.test(t) ? Number(t) : null;
  if (frac !== null) {
    const mins = Math.round(frac * 24 * 60);
    return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  let pm = false;
  if (/^(오후|pm)/i.test(t)) {
    pm = true;
    t = t.replace(/^(오후|pm)/i, "");
  } else t = t.replace(/^(오전|am)/i, "");
  const m = /^(\d{1,2})(?::|시)?(\d{2})?(?::\d{2})?분?$/.exec(t);
  if (!m) return undefined;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (pm && h < 12) h += 12;
  if (h > 23 || mi > 59) return undefined;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** 정수(쉼표·원·개·명 허용). 빈 값 null · 못 읽으면 undefined. */
export function parseInteger(raw: string | null | undefined): number | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  const t = s.replace(/[,\s원개명회시간]/g, "");
  if (!/^-?\d+(\.0+)?$/.test(t)) return undefined;
  return Math.trunc(Number(t));
}

/** 소수 허용 숫자(점수·시수). */
export function parseNumber(raw: string | null | undefined): number | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  const t = s.replace(/[,\s점원]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(t)) return undefined;
  return Number(t);
}

/** 예/아니오. */
export function parseYesNo(raw: string | null | undefined): boolean | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  const t = s.toLowerCase();
  if (["예", "네", "y", "yes", "o", "true", "1", "사용", "운영", "재직", "✓", "v"].includes(t)) return true;
  if (["아니오", "아니요", "n", "no", "x", "false", "0", "미사용", "중단", "종료"].includes(t)) return false;
  return undefined;
}

/** 전화번호 → `010-1234-5678` 모양(숫자만 남겨 다시 끊는다). 숫자가 9~11자리가 아니면 undefined. */
export function parsePhone(raw: string | null | undefined): string | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  let d = s.replace(/\D/g, "");
  // 엑셀이 숫자로 읽어 앞자리 0을 잃은 휴대폰(1012345678)
  if (/^1[016789]\d{7,8}$/.test(d)) d = `0${d}`;
  if (d.length < 9 || d.length > 11) return undefined;
  if (d.startsWith("02")) return d.length === 9 ? `02-${d.slice(2, 5)}-${d.slice(5)}` : `02-${d.slice(2, 6)}-${d.slice(6)}`;
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** 라벨(또는 키) → 값. 공백 무시 비교. 못 찾으면 undefined. */
export function parseOption<V>(raw: string | null | undefined, table: ReadonlyArray<{ label: string; value: V; aliases?: readonly string[] }>): V | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  const h = squash(s);
  const hit = table.find((o) => squash(o.label) === h || squash(String(o.value)) === h || (o.aliases ?? []).some((a) => squash(a) === h));
  return hit ? hit.value : undefined;
}

/** 요일 → 0(일)~6(토). `월`·`월요일`·`Mon` 허용. */
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const WEEKDAYS_EN = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export function parseWeekday(raw: string | null | undefined): number | null | undefined {
  const s = blankToNull(raw);
  if (s === null) return null;
  const t = s.replace(/\s+/g, "").replace(/요일$/, "").toLowerCase();
  const ko = WEEKDAYS.indexOf(t as (typeof WEEKDAYS)[number]);
  if (ko >= 0) return ko;
  const en = WEEKDAYS_EN.findIndex((w) => t.startsWith(w));
  return en >= 0 ? en : undefined;
}
export const WEEKDAY_LABELS: readonly string[] = WEEKDAYS;

/** 여러 값을 한 칸에(`월,수,금` · `월 수 금` · `월/수`). */
export function splitList(raw: string | null | undefined): string[] {
  const s = blankToNull(raw);
  if (s === null) return [];
  return s.split(/[,/·;\n]+|\s+/).map((x) => x.trim()).filter(Boolean);
}

/** 한 파일 안 같은 키 중복 → 위치 오류(둘째부터). */
export function duplicateKeyIssues<T extends { rowNum: number }>(sheet: string, rows: readonly T[], keyOf: (r: T) => string | null, label: string): ImportIssue[] {
  const first = new Map<string, number>();
  const out: ImportIssue[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    const at = first.get(k);
    if (at === undefined) first.set(k, r.rowNum);
    else out.push({ sheet, row: r.rowNum, col: null, header: null, value: k, message: `같은 ${label}이(가) ${at}행에도 있습니다 — 한 번만 적어 주세요` });
  }
  return out;
}
