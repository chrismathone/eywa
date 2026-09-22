import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 한 화면 대시보드 **배선 가드** — "같은 사실을 두 곳에서 계산하지 않는다"를 구조로 잠근다.
 *
 * 여기 잠근 것들은 전부 **에러 없이 조용히 갈리는** 종류다: 과목 축을 하드코딩하면 영어를 aywa로
 * 옮겨도 안 따라오고, 미읽음 절을 복사하면 목록과 운영실이 다른 수를 말하고, fail-closed 게이트를
 * 집계에 쓰면 설정이 비는 순간 신호가 "0"으로 사라진다.
 */
const ROOT = resolve(process.cwd());
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
/** 주석을 걷어낸 코드만 — 설명문에 나온 낱말이 오탐이 되지 않게(가드 전체가 문자열 검사다). */
const code = (p: string) =>
  read(p)
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*") || t.startsWith("{/*"));
    })
    .join("\n");

const CARE_CELLS = "src/features/newcomers/care-cells.ts";
const PRIORITY = "src/features/dashboard/onescreen/priority-lines.ts";
const SERVER_QUERIES = "src/features/dashboard/onescreen/server/queries.ts";
const REPORT_ACTIONS = "src/features/report-admin/server/actions.ts";
const ONE_SCREEN = "src/app/(shell)/dashboard/_onescreen/one-screen.tsx";
const NEWCOMERS_FILTERS = "src/features/newcomers/board-model.ts";

describe("한 화면 대시보드 배선", () => {
  it("케어 칸의 기한 판정은 신규생 단일 소스(`statusOf`)를 그대로 부른다", () => {
    const src = read(CARE_CELLS);
    expect(src).toContain('from "./onboarding-items"');
    expect(src).toContain("statusOf(");
    // 🔴 라벨을 손으로 적으면 신규생 목록과 이름이 갈린다 — shortLabel에서만 온다.
    expect(src).toContain("item.shortLabel");
  });

  it("칸을 센 조건과 목록 필터가 같은 함수다 — 목록이 `careCellMatches`를 실제로 부른다", () => {
    expect(read(NEWCOMERS_FILTERS)).toContain("careCellMatches(");
    expect(read(CARE_CELLS)).toContain("export function careCellMatches");
  });

  it("'우선 확인'은 결석 위험 조회를 직접 읽지 않는다 — 사전 통보 제외를 두 번 판정하지 않기 위해", () => {
    const src = code(PRIORITY);
    // 🔴 스포트라이트(브리핑 payload)가 사전 통보 제외를 이미 적용한 배열이다.
    expect(src).not.toContain("getAbsenceRiskCached");
    expect(src).not.toContain("unexplainedAbsences");
    expect(src).toContain("spotlights");
  });

  it("'우선 확인'은 점수를 매기지 않는다 — 고정 버킷 순서뿐", () => {
    const src = read(PRIORITY);
    expect(src).toContain("PRIORITY_BUCKETS");
    // LLM·AI를 부르는 경로가 없어야 한다(이름이 `AI PRIORITY`인 외부 PRD를 그대로 옮기지 않았다).
    expect(src).not.toContain("generateJSON");
  });

  it("보고서 집계의 과목 축은 학원설정에서 오고, fail-closed 발송 게이트를 쓰지 않는다", () => {
    const src = code(SERVER_QUERIES);
    // 🔴 코드에 'math'/'english'를 박지 말 것 — 설정에 넣는 것만으로 따라와야 한다.
    expect(src).not.toMatch(/["']english["']/);
    expect(src).not.toMatch(/["']math["']/);
    // 🔴 발송 게이트(fail-closed)를 집계에 재사용하면 설정이 비는 순간 신호가 조용히 사라진다.
    expect(src).not.toContain("isClassnoteSubjectEnabled");
    expect(src).toContain('.in("subject", tracked)');
  });

  it("미읽음 판정 절은 목록과 집계가 **같은 상수**를 쓴다", () => {
    expect(read(SERVER_QUERIES)).toContain("UNREAD_MATCHABLE_OR");
    expect(read(REPORT_ACTIONS)).toContain("UNREAD_MATCHABLE_OR");
    // 🔴 절 문자열을 다시 적으면 두 화면이 다른 집합을 센다.
    const literal = "edutrix_share_token.not.is.null";
    expect(read(REPORT_ACTIONS).split(literal).length - 1).toBe(0);
    expect(read(SERVER_QUERIES).split(literal).length - 1).toBe(0);
  });

  it("조회 실패를 0으로 삼키지 않는다 — 집계 쿼리는 throw한다", () => {
    const src = read(SERVER_QUERIES);
    expect(src).toContain("학부모 미확인 조회 실패");
    // count 응답의 error를 `?? 0`으로 흘려보내면 화면이 "0건"이라는 거짓 사실을 적는다.
    expect(src).not.toMatch(/if \(error\) return \{/);
  });

  it("신규생 재료를 두 번 긁지 않는다 — '오늘 할 일'의 같은 신호를 이 화면에선 끈다", () => {
    expect(read(ONE_SCREEN)).toContain("newcomers: false");
  });

  // 🔴 2026-09-10 뒤집힘 — 옛 가드는 "차트는 둘뿐이다"였다. 원장이 참고 이미지를 두 번 제시하고
  //    *"디자인을 너무 무시한거 아냐"* + *"이 공간낭비 어쩔꺼야"*라고 지적해 차트 격자로 채웠다.
  //    이제 잠그는 것은 **개수가 아니라 무게**다 — 차트 라이브러리를 들이면 바탕화면의 첫 페인트가
  //    그 청크를 기다린다(B5). 순수 SVG·div로만 그린다는 약속을 대신 잠근다.
  it("차트에 라이브러리를 들이지 않는다 — 순수 SVG·div로만 그린다", () => {
    // 주석엔 "recharts를 쓰지 않는다"는 사연이 적혀 있다 — 코드만 본다.
    const src = code("src/app/(shell)/dashboard/_onescreen/charts.tsx");
    for (const lib of ["recharts", "chart.js", "d3", "victory", "nivo"]) {
      expect(src).not.toContain(lib);
    }
    // 도넛·파이 금지(각도는 눈으로 비교가 안 된다).
    expect(src).not.toContain("<circle");
  });
});
