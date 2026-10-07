/**
 * 검색 팰릿(Shift+F) **데이터 축**의 구조 가드 — 원장 2026-09-10 *"모든 검색이 실제로 되는지 확인"*의 잔여물.
 *
 * 조사에서 나온 것 중 **다시 조용히 무너질 수 있는 것**만 여기서 잠근다:
 *  ① 강사 스코프 — 팰릿만 스코프가 없어 담당 8명인 강사가 전체 828명을 훑을 수 있었다([[#77]]).
 *  ② 조회 실패를 `data ?? []`로 삼키지 않기 — 삼키면 화면엔 "일치하는 결과가 없습니다"만 뜬다(B3).
 *  ③ 클라 팰릿이 server-only 모듈에서 **값**을 읽지 않기([[#61]]·[[#81]]).
 *  ④ 메뉴 축의 출처는 메뉴 화면과 **같은 목록**(HUB) — NAV_GROUPS로 되돌리면 면·수학 시트가 다시 사라진다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리지 않게). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}
const read = (rel: string) => stripComments(readFileSync(join(process.cwd(), rel), "utf8"));

const QUERIES = "src/features/search/server/queries.ts";
const PALETTE = "src/components/command-palette.tsx";

describe("팰릿 데이터 검색 — 테넌트 안에서 강사 스코프를 다시 건다", () => {
  const src = read(QUERIES);

  it("🔴 원생 축은 담당 원생으로 좁힌다(RLS는 역할을 안 본다 — students 정책은 tenant_id 하나뿐)", () => {
    expect(src).toContain("effectiveTeacherScope({ includeScheduled: true })");
    // 스코프가 있는데 담당 원생이 0명이면 **아무도 안 보여야** 한다(전체로 열리면 안 된다).
    expect(src).toMatch(/scope\.studentIds\.length === 0/);
  });

  it("🔴 수업 축은 수업목록과 같이 본인 담당 반만 + 보이지 않는 '보강' 반은 뺀다", () => {
    expect(src).toContain("effectiveTeacherId()");
    expect(src).toContain('q.in("id", scope.classIds)');
    expect(src).toContain("listMakeupPoolClassIds()");
    // ⚠️ 컬럼 이름을 쿼리에 끼워 넣으면 0241a 미적용 환경에서 400이 난다([[#95]]).
    expect(src).not.toContain('"is_makeup_pool"');
  });

  it("🔴 상담 축은 본인이 등록한 상담만(강사·강사뷰)", () => {
    expect(src).toContain('qb.eq("counselor_id", tId)');
  });

  it("🔴 조회 실패를 `data ?? []`로 삼키지 않는다 — 삼키면 장애가 '결과 없음'으로 위장한다", () => {
    // 허용되는 단 한 곳 = `rowsOf`의 `res.data ?? []`(그 앞에서 error를 이미 로그로 갈라 놨다).
    expect(src).not.toMatch(/(?<!res\.)\bdata\s*\?\?\s*\[\]/);
    expect(src).toContain("rowsOf");
    expect(src).toMatch(/console\.error\(`\[palette\]/);
  });

  it("상한은 한 곳(PALETTE_LIMIT) — 숫자를 손으로 적으면 '더 있음' 표시와 어긋난다", () => {
    expect(src).toContain("PALETTE_LIMIT + 1");
    expect(src).not.toMatch(/\.limit\(\s*\d+\s*\)/);
  });
});

describe("팰릿 화면 — server-only 모듈에서 값을 읽지 않는다", () => {
  const src = read(PALETTE);

  it("🔴 클라 컴포넌트는 `features/search/server/*`를 import 하지 않는다(빌드가 깨지거나 undefined가 된다)", () => {
    expect(src).not.toContain("features/search/server");
  });

  it("계약(타입·상한)은 순수 모듈에서 온다", () => {
    expect(src).toContain('from "@/features/search/palette"');
    expect(src).toContain("PALETTE_LIMIT");
  });

  it("🔴 메뉴 축은 메뉴 화면과 **같은 목록**을 읽고 **같은 방법**으로 연다", () => {
    expect(src).toContain("HUB_GROUPS");
    expect(src).toContain("SUPPORT_GROUPS");
    expect(src).toContain("hubSearchKeywords");
    expect(src).toContain("useOpenMenu");
    // NAV_GROUPS로 되돌리면 수학 강사 시트·수납/설정 면들이 다시 검색에서 사라진다.
    expect(src).not.toContain("NAV_GROUPS");
  });
});
