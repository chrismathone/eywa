import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 신규생 **과목별 행·과목별 체크**(0256a) 구조 가드 — 원장 2026-09-10.
 *
 * 순수 규칙은 `subject-rows.test.ts`가 잡는다. 여기는 **배선**을 잠근다 — 전부 어긋나도 에러가 안 나는
 * 종류다(한쪽만 과목을 알면 탭과 운영실이 같은 학생을 다르게 말한다).
 */
const ROOT = process.cwd();
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
/** 주석을 걷어낸 본문 — 주석에 적힌 낱말이 가드를 통과시키지 않게. */
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SQL = read("supabase", "migrations", "0256a_onboarding_checks_subject.sql");
const ACTIONS = strip(read("src", "features", "newcomers", "server", "actions.ts"));
const QUERIES = strip(read("src", "features", "newcomers", "server", "queries.ts"));
const SIGNALS = strip(read("src", "features", "dashboard", "server", "action-signals.ts"));
const CARE = strip(read("src", "features", "newcomers", "care-cells.ts"));
const TABLE = strip(read("src", "app", "(shell)", "newcomers", "_components", "newcomer-table.tsx"));
const PAGE = strip(read("src", "app", "(shell)", "newcomers", "page.tsx"));

describe("① 표 모양 — 과목이 유니크 축에 들어가고, 부분 유니크가 없다([[#113]])", () => {
  it("유니크 = (테넌트, 학생, 과목, 항목) · 과목은 NOT NULL 기본 ''", () => {
    expect(SQL).toContain("unique (tenant_id, student_id, subject, item_key)");
    expect(SQL).toContain("add column if not exists subject text not null default ''");
    const uniqueStatements = SQL.split(";").filter((s) => /unique/i.test(s));
    for (const s of uniqueStatements) expect(s).not.toMatch(/\bwhere\b/i);
  });
});

describe("② 쓰기 — 과목별로 저장하고, 0256a 전에는 옛 모양으로 떨어진다([[#95]])", () => {
  it("upsert 축이 새 유니크와 글자까지 같다", () => {
    expect(ACTIONS).toContain('onConflict: "tenant_id,student_id,subject,item_key"');
  });

  it("과목 칸이 없을 때만 옛 축으로 다시 쓴다 — 다른 실패를 옛 모양으로 덮지 않는다", () => {
    expect(ACTIONS).toContain("isMissingSubjectColumn(error)");
    expect(ACTIONS).toContain('onConflict: "tenant_id,student_id,item_key"');
  });

  it("🔴 화면이 보낸 과목을 서버가 다시 확인한다([[#77]]) — 키 모양 + 그 학생이 실제로 듣는 과목", () => {
    expect(ACTIONS).toContain("isSubjectKey(subject)");
    expect(ACTIONS).toContain('.from("enrollments")');
    expect(ACTIONS).toContain('.eq("subject", subject)');
  });

  it("감사로그에 과목이 남는다(원장 지시 — 기능 변동은 모두 감사로그)", () => {
    expect(ACTIONS).toContain("subjectStored: storedSubject");
  });
});

describe("③ 읽기 — 탭과 운영실이 같은 조회·같은 규칙", () => {
  it("두 곳 모두 cohort 조회를 쓴다(한쪽만 과목을 알면 숫자가 갈린다)", () => {
    for (const src of [QUERIES, SIGNALS]) {
      expect(src).toContain("loadEnrollmentSubjects(");
      expect(src).toContain("loadCheckRows(");
      expect(src).toContain("effectiveChecks(");
    }
  });

  it("🔴 운영실 지연 판정은 과목마다 한다 — 접은 체크로 판정하지 않는다", () => {
    expect(SIGNALS).toContain("subjects.some(");
    expect(SIGNALS).not.toContain("collapseChecks(");
  });

  it("🔴 칸 판정 두 함수가 같은 축(과목 행)을 본다 — 운영실 호출부를 안 바꿔도 맞게 센다", () => {
    expect(CARE).toContain("row.subjects.some((s) => careCellMatches(cell, s, today, baseline))");
    expect(CARE).toContain("row.subjects.some((s) => careCellOverdue(cell, s, today, baseline))");
  });

  it("학생 한 줄(rows)에 과목 행을 실어 보낸다 — `rows.length`는 여전히 학생 수", () => {
    expect(QUERIES).toContain("subjects: perSubject");
    expect(QUERIES).toContain("subjectRows.push(...perSubject)");
  });
});

describe("④ 화면 — 원장 지시 그대로", () => {
  it("표는 과목 행을 그리고, '명'은 학생 수로 센다", () => {
    expect(PAGE).toContain("view.subjectRows");
    expect(PAGE).toContain("studentsIn(");
  });

  it("🔴 과목 라벨은 학원설정 단일 소스 — raw 키를 그대로 내보내지 않는다", () => {
    expect(TABLE).toContain("useSubjectMaps()");
    expect(TABLE).toContain("labelOf(row.subject)");
    expect(TABLE).not.toMatch(/\{row\.subject\}/);
  });

  it("이름 / 학교·학년 / 과목 세 칸", () => {
    for (const head of [">이름</th>", ">학교·학년</th>", ">과목</th>"]) expect(TABLE).toContain(head);
  });

  it("날짜는 둘 다 yy.mm.dd, 지난 첫 수업은 D+n", () => {
    expect(TABLE).toContain("shortDate(row.enrolledOn)");
    expect(TABLE).not.toContain('slice(5).replace("-", "/")');
    expect(TABLE).toContain("D+{n}");
  });

  it("낙관 반영 키는 줄(학생 × 과목) 단위 — 한 과목 체크가 다른 과목 줄로 번지지 않게", () => {
    expect(TABLE).toContain("`${row.rowKey}|${item.key}`");
    expect(TABLE).not.toContain("`${row.studentId}|${item.key}`");
  });

  it("창·모바일에선 머리를 접는다 — 창 제목줄과 이중 제목 금지", () => {
    expect(PAGE).toContain('<div className="compact-chrome:hidden">');
  });
});
