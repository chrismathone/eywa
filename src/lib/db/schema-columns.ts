import { migrationFiles } from "./migrations-corpus.mjs";

/**
 * **표의 지금 칸 이름** — SQL 전체(시즌1 합본 + 시즌2, 적용 순서)의 표 정의와 칸 더하기/빼기/이름 바꾸기를 훑어 구한다. 시험 전용
 * (가짜 DB는 아무 칸이나 받아 줘서, 없는 칸을 읽는 조회가 시험을 통과한다 — 2026-10-28 시간표 `date` · 멘트 미리보기 `users.name`).
 * ⚠️ drizzle `schema.ts`는 기준이 아니다 — 나중 SQL로 더한 칸이 빠져 있다.
 * ⚠️ 못 읽는 것: 표를 지우고 다시 만들기(옛 칸이 남는다) · `like` 절 · 표 이름 바꾸기 · SQL 파일 밖에서 더한 칸(운영 대조 2026-10-28:
 *    `calendar_events.google_*` 셋 · `enrollment_consultations`의 동의 칸 둘). `COLUMN` 낱말은 있어도 없어도 된다.
 *    한 줄에 칸 여럿 · 칸 이름 `key`는 읽는다(운영 275개 표 대조 — 그 둘 때문에 19개 표에서 칸이 빠지던 것을 고침).
 * 🔴 서버 코드에서 부르지 않는다(마이그레이션 파일을 읽는다).
 */
const NAME = String.raw`"?([a-z_][a-z0-9_]*)"?`;
// `key`는 칸 이름일 수 있다(`document_categories.key` …) — `primary key`·`foreign key` 줄은 앞 낱말로 걸러진다.
const NOT_COLUMN = /^(constraint|primary|unique|foreign|check|exclude|index|like|if|column)$/i;

/** 표 정의 괄호 안을 깊이 0의 쉼표로 나눈다(한 줄에 칸 여럿 · `check (a in ('x', 'y'))`의 쉼표 · 따옴표 안 쉼표는 안 나눈다). */
function topLevelItems(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch === "'") {
      for (i++; i < body.length && !(body[i] === "'" && body[i + 1] !== "'"); i++) if (body[i] === "'") i++;
    } else if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) {
      out.push(body.slice(from, i));
      from = i + 1;
    }
  }
  out.push(body.slice(from));
  return out;
}
const tableRe = (t: string) => String.raw`(?:only\s+)?(?:(?:public|"public")\.)?"?${t}"?(?![a-z0-9_])`;

export function schemaColumns(table: string): Set<string> {
  const cols = new Set<string>();
  const T = tableRe(table);
  for (const { sql } of migrationFiles()) {
    const text = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const create = new RegExp(String.raw`create\s+table\s+(?:if\s+not\s+exists\s+)?${T}\s*\(`, "i").exec(text);
    if (create) {
      // 칸 목록 = 여는 괄호부터 짝이 맞는 닫는 괄호까지 · 줄마다 첫 낱말(제약 줄 제외).
      let depth = 0;
      let j = create.index + create[0].length - 1;
      const start = j + 1;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) break;
      }
      for (const item of topLevelItems(text.slice(start, j))) {
        const m = new RegExp(String.raw`^\s*${NAME}\s+[a-z"]`, "i").exec(item);
        if (m && !NOT_COLUMN.test(m[1]!)) cols.add(m[1]!);
      }
    }
    for (const alter of text.matchAll(new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?${T}\s+([^;]*)`, "gi"))) {
      const body = alter[1]!;
      for (const m of body.matchAll(new RegExp(String.raw`(?:^|,)\s*add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?${NAME}`, "gi"))) {
        if (!NOT_COLUMN.test(m[1]!)) cols.add(m[1]!);
      }
      for (const m of body.matchAll(new RegExp(String.raw`(?:^|,)\s*drop\s+(?:column\s+)?(?:if\s+exists\s+)?${NAME}`, "gi"))) {
        if (!NOT_COLUMN.test(m[1]!)) cols.delete(m[1]!);
      }
      for (const m of body.matchAll(new RegExp(String.raw`rename\s+(?:column\s+)?${NAME}\s+to\s+${NAME}`, "gi"))) {
        if (NOT_COLUMN.test(m[1]!)) continue;
        cols.delete(m[1]!);
        cols.add(m[2]!);
      }
    }
  }
  return cols;
}

/** PostgREST select 문자열의 이 표 칸(다른 표 끼워 읽기·`*`·계산 제외 · 별칭 `a:b`는 뒤 이름 · 형 변환 `::`는 앞). */
export function selectColumns(select: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of select) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const out: string[] = [];
  for (const p of parts.map((x) => x.trim())) {
    if (!p || /[(*!]/.test(p)) continue;
    const col = (p.includes(":") && !p.includes("::") ? p.split(":")[1]! : p).split("::")[0]!.trim();
    if (/^[a-z_][a-z0-9_]*$/.test(col)) out.push(col);
  }
  return out;
}
