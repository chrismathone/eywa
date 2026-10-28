import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { schemaColumns, selectColumns } from "@/lib/db/schema-columns";
import { daySplitStudents, nextDay, SLOT_ANCHORS, slotAnchorBlockText } from "./slot-anchors";

/**
 * 배치에 매달린 기록 표(`SLOT_ANCHORS`)·수강 표 PostgREST 조회가 **있는 칸만** 읽는지 — SQL 전체(시즌1 합본 + 시즌2, 적용 순서)의
 * 표 정의·칸 더하기/빼기/이름 바꾸기와 대조한다.
 * 🔴 2026-10-28: 시간표 반 블록 옮기기(`move-actions.ts`)가 없는 칸 `date`(실제는 `session_date`)를 읽어 PostgREST가 늘 오류를 냈고,
 *    코드가 그 오류를 "출결 기록을 확인하지 못해 중단"으로 바꿔 반 옮기기가 한 번도 저장되지 않았다(운영 감사로그 0건). 문자열만 보던
 *    배선 시험은 `attendance_records`·`slot_start`가 적혀 있으니 통과했다 — 칸 이름 자체를 스키마와 맞춰 봐야 잡힌다.
 * ⚠️ drizzle `schema.ts`는 기준이 아니다 — 나중 SQL로 더한 칸(`slot_start`·`seat_label`·`taught_by`·`recorded_via` …)이 빠져 있다.
 * ⚠️ 못 보는 모양: select 인자가 문자열 리터럴이 아닌 것(삼항·상수) · 변수에 나중에 거는 필터 · 표 이름을 인자로 받는 헬퍼 —
 *    `SLOT_ANCHORS`처럼 표·칸을 값으로 들고 다니는 곳은 그 값을 따로 대조한다(아래 시험).
 */
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const TABLES = [...new Set([...SLOT_ANCHORS.map((a) => a.table), "enrollments"])];

/** 주석을 같은 길이의 빈칸으로 — 문자열 안의 `//`(주소)는 그대로. 조회 줄 머리부터만 쓴다(파일 전체는 정규식 리터럴의 따옴표에 흔들린다). */
function stripComments(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      for (; j < s.length && s[j] !== ch; j++) if (s[j] === "\\") j++;
      out += s.slice(i, j + 1);
      i = j;
    } else if (ch === "/" && s[i + 1] === "/") {
      const j = s.indexOf("\n", i);
      const end = j < 0 ? s.length : j;
      out += " ".repeat(end - i);
      i = end - 1;
    } else if (ch === "/" && s[i + 1] === "*") {
      const j = s.indexOf("*/", i + 2);
      const end = j < 0 ? s.length : j + 2;
      out += s.slice(i, end).replace(/[^\n]/g, " ");
      i = end - 1;
    } else out += ch;
  }
  return out;
}

/** `from("표")`로 시작한 메서드 줄의 끝 — 괄호 짝 0에서 `,`·`;`·`?`(삼항 — `?.`는 아님)·`:`·바깥 닫는 괄호를 만나는 곳(문자열 안은 건너뛴다). */
function chainEnd(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const ch = s[j]!;
    if (ch === '"' || ch === "'" || ch === "`") {
      for (j++; j < s.length && s[j] !== ch; j++) if (s[j] === "\\") j++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") {
      if (depth === 0) return j;
      depth--;
    } else if (depth === 0 && (ch === "," || ch === ";" || ch === ":" || (ch === "?" && s[j + 1] !== "."))) return j;
  }
  return s.length;
}

type CodeFile = { f: string; raw: string };

/**
 * 저장소 코드 파일(시험 제외 · 아직 add 안 한 새 파일 포함 · 한글 경로도 그대로) — **한 번만 읽는다**(표마다 7천 개를 다시 읽으면
 * 캐시가 찬 디스크에서도 30초를 넘겼다). PostgREST 조회가 없는 파일은 뺀다.
 */
function codeFiles(): CodeFile[] {
  return execSync("git -c core.quotePath=false ls-files -z --cached --others --exclude-standard src scripts", { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter((f) => f && /\.(ts|tsx|mts|mjs|cjs)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) && fs.existsSync(path.join(root, f)))
    .map((f) => ({ f, raw: read(f) }))
    .filter((c) => c.raw.includes('from("'));
}

/** 조회 줄 머리(`from("표")` 자리)부터 그 줄 끝까지 — 주석은 지운다. */
function chainAt(s: string, i: number): string {
  const c = stripComments(s.slice(i, i + 5000));
  return c.slice(0, chainEnd(c, 0));
}

/** 그 표의 조회 줄(주석 속 예시 제외). */
function chains(table: string, files: readonly CodeFile[]): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  const needle = `from("${table}")`;
  for (const { f, raw } of files) {
    for (let i = raw.indexOf(needle); i >= 0; i = raw.indexOf(needle, i + 1)) {
      if (/\/\/|^\s*(\*|\/\*)/.test(raw.slice(raw.lastIndexOf("\n", i) + 1, i))) continue;
      out.push({ at: `${f}:${raw.slice(0, i).split("\n").length}`, text: chainAt(raw, i) });
    }
  }
  return out;
}

/** 조회가 칸으로 쓰는 이름 — select 목록(다른 표 끼워 읽기·`*` 제외 · 별칭은 뒤 이름)과 필터·정렬의 첫 인자. */
function referenced(text: string): string[] {
  const names: string[] = [];
  for (const m of text.matchAll(/\.select\(\s*"([^"]*)"/g)) names.push(...selectColumns(m[1]!));
  for (const m of text.matchAll(/\.(eq|neq|gt|gte|lt|lte|in|is|like|ilike|order|not)\(\s*"([a-z_][a-z0-9_]*)"/g)) names.push(m[2]!);
  return names;
}

describe("배치에 매달린 기록 표 · 수강 표 조회 칸 이름 = SQL 정의", () => {
  it("출결 날짜 칸은 session_date이고 date 칸은 없다 · SQL 추출이 COLUMN 생략 문법도 읽는다", () => {
    const cols = schemaColumns("attendance_records");
    expect(cols.has("session_date")).toBe(true);
    expect(cols.has("slot_start")).toBe(true);
    expect(cols.has("date")).toBe(false);
  });

  it("🔴 SLOT_ANCHORS의 표·날짜 칸·교시 칸이 SQL에 있다(값으로 들고 다니는 표는 조회 줄 대조가 못 본다)", () => {
    for (const a of SLOT_ANCHORS) {
      const cols = schemaColumns(a.table);
      expect([a.table, ...["id", "tenant_id", "class_id", "slot_start", a.dateColumn].filter((c) => !cols.has(c))]).toEqual([a.table]);
    }
  });

  it("🔴 저장소의 그 표 PostgREST 조회가 모두 있는 칸만 읽는다", () => {
    const files = codeFiles();
    let total = 0;
    const bad: string[] = [];
    for (const t of TABLES) {
      const cols = schemaColumns(t);
      expect(cols.size).toBeGreaterThan(5); // SQL 추출이 망가져 칸이 비면 모든 조회가 걸려 시끄럽게 실패한다
      for (const c of chains(t, files)) {
        total++;
        bad.push(...referenced(c.text).filter((n) => !cols.has(n)).map((n) => `${c.at} ${t} → "${n}"`));
      }
    }
    expect(total).toBeGreaterThan(30); // 찾는 규칙이 망가져 0건이면 통과해 버린다
    expect(bad).toEqual([]);
  });

  it("조회 줄은 그 줄에서 끝난다 — 같은 배열의 다음 조회·삼항의 다른 갈래를 끌어오지 않는다 · 주석 안 괄호·따옴표에 안 끊긴다", () => {
    const end = (s: string) => referenced(chainAt(s, s.indexOf('from("attendance_records")')));
    expect(end('Promise.all([db.from("attendance_records").select("id,session_date").eq("class_id", x), scoped("lesson_reports", "report_date")]);'))
      .toEqual(["id", "session_date", "class_id"]);
    expect(end('const q = ok ? db.from("attendance_records").select("id").eq("class_id", x) : db.from("x").select("report_date");'))
      .toEqual(["id", "class_id"]);
    expect(end('db.from("attendance_records")\n  // 학생(전 과목), 강사\'s 칸\n  .select("session_date")\n  .eq("slot_start", s);')).toEqual(["session_date", "slot_start"]);
  });

  it("반 블록 옮기기는 표·칸을 SLOT_ANCHORS에서 읽는다 — 출결을 date 칸으로 읽지 않는다(2026-10-28 버그)", () => {
    const src = read("src/features/timetable/server/move-actions.ts");
    expect(src).toContain("SLOT_ANCHORS");
    expect(src).toMatch(/\.from\(a\.table\)/);
    expect(src).toMatch(/\.gte\(a\.dateColumn, effective\)/);
    expect(src).not.toMatch(/["']date["']/);
    expect(SLOT_ANCHORS.find((a) => a.table === "attendance_records")?.dateColumn).toBe("session_date");
  });
});

describe("반 블록 옮기기 막힘 판정", () => {
  it("막힘 안내는 기록을 지우라고 하지 않고, 마지막 기록 다음 날을 적용일로 권한다", () => {
    const text = slotAnchorBlockText([
      { label: "출결", count: 3, lastDate: "2026-10-28" },
      { label: "수업 계획", count: 12, lastDate: "2026-11-30" },
    ]);
    expect(text).toContain("출결 3건 · 수업 계획 12건");
    expect(text).toContain("2026-12-01 이후로");
    expect(text).not.toMatch(/정리|지우|삭제/);
    expect(text).toContain("함께 옮기는 기능은 아직 없습니다");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });

  it("🔴 요일을 옮기면 명단이 바뀌는 분리등원 학생 — 옛 요일만 다니면 빠지고, 새 요일만 다니면 더해진다 · 요일 지정 없음은 그대로", () => {
    const enr = [
      { name: "모든요일", attendanceDays: null },
      { name: "빈목록", attendanceDays: [] },
      { name: "월만", attendanceDays: ["mon"] },
      { name: "목만", attendanceDays: ["thu"] },
      { name: "월화", attendanceDays: ["mon", "tue"] },
    ];
    expect(daySplitStudents(enr, [{ from: "mon", to: "tue" }], "2026-11-02")).toEqual(["월만"]);
    expect(daySplitStudents(enr, [{ from: "mon", to: "thu" }], "2026-11-02")).toEqual(["월만", "목만", "월화"]);
    expect(daySplitStudents(enr, [], "2026-11-02")).toEqual([]);
  });

  it("적용일에 이미 끝난 수강은 빼다 — 반이동 종료일은 그날 이미 새 반 · 일반 종료일은 그날까지 재원(`isEnrollmentEndedOn`)", () => {
    const enr = [
      { name: "반이동", attendanceDays: ["mon"], endDate: "2026-11-02", isTransferred: true },
      { name: "퇴원당일", attendanceDays: ["mon"], endDate: "2026-11-02", isTransferred: false },
      { name: "이미퇴원", attendanceDays: ["mon"], endDate: "2026-11-01", isTransferred: false },
    ];
    expect(daySplitStudents(enr, [{ from: "mon", to: "tue" }], "2026-11-02")).toEqual(["퇴원당일"]);
  });
});
