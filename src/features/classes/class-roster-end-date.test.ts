/**
 * **반 상세의 "수강 중인 학생"은 시간표 셀과 같은 종료 규약을 쓴다** — 회귀 방지.
 *
 * 2026-08-04 실측: 시간표 셀 `중등M 개별 JJ3M`엔 학생 5명이 뜨는데, 그 셀을 눌러 연 반 상세는
 * **"활성 재원생이 없습니다"(0명)** 였다. 5명 전부 `end_date = 오늘` · 전출 아님이라
 * [isEnrollmentEndedOn](../enrollments/eligibility.ts) 기준으로는 **아직 재원**(일반 종료는 종료일
 * 당일까지 포함, 반이동만 당일 배타)인데, 반 상세만 `.is("end_date", null)`로 잘라 통째로 놓쳤다.
 * 개별(JJ·BS) 반은 하루짜리 수강이 정상 운영이라 이 갭이 그대로 "학생 0명"으로 보인다.
 *
 * 종료 규약은 호출부에서 다시 구현하지 않는다 — eligibility 단일 소스가 유일한 판정자다.
 * (같은 결함이 2026-07-17 시간표 주간뷰에서 한 번 났고, 그때 그 함수가 만들어졌다.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = readFileSync(join(process.cwd(), "src", "features", "classes", "server", "queries.ts"), "utf8");

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 문구가 스스로 위반으로 걸리지 않게). */
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** 지정한 export 함수 본문만 잘라낸다(파일 전체를 보면 다른 쿼리의 필터까지 걸린다). */
function bodyOf(fnName: string): string {
  const start = src.indexOf(`export async function ${fnName}`);
  expect(start, `${fnName}을 찾지 못했다`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (async function|function|const|type) /);
  return stripComments(next === -1 ? rest : rest.slice(0, next));
}

describe("반 상세 명단 — 종료 규약", () => {
  // 목록(수강 중인 학생)과 헤더 카운트(재원생 N명)가 **같은 규약**을 써야 서로 안 갈린다.
  for (const fn of ["getClassStudents", "getClassDetail"]) {
    const code = bodyOf(fn);

    it(`${fn}은 end_date를 직접 잘라 판정하지 않는다`, () => {
      expect(
        /\.is\(\s*["']end_date["']\s*,\s*null\s*\)/.test(code),
        `${fn}이 .is("end_date", null)로 자르면 **오늘이 마지막 날인 학생**이 사라진다.\n` +
          `시간표 셀엔 뜨는데 반 상세는 "활성 재원생이 없습니다"가 되는 그 버그다.`,
      ).toBe(false);
    });

    it(`${fn}은 eligibility 단일 소스로 판정한다`, () => {
      // `enrollmentPhaseOn`은 내부에서 `isEnrollmentEndedOn`을 부른다 — 둘 중 무엇을 쓰든
      // **호출부에서 규약을 다시 구현하지 않는 것**이 이 가드의 요지다.
      expect(
        /isEnrollmentEndedOn|enrollmentPhaseOn/.test(code),
        `종료 규약(일반=당일 포함 / 반이동=당일 배타)을 ${fn}에서 다시 구현하지 말 것.`,
      ).toBe(true);
    });

    it(`${fn}은 시작일 축도 본다`, () => {
      // 🔴 2026-08-29: 미래 시작 수강이 이미 DB에 있는데(실측 28건) 종료만 보고 있어서
      //    **9/1부터 올 학생이 오늘 명단·재원생 수에 섞였다**. 두 경계를 다 봐야 한다.
      expect(
        code.includes("start_date"),
        `${fn}이 start_date를 조회하지 않으면 아직 오지 않은 학생이 오늘 명단에 선다.`,
      ).toBe(true);
      expect(
        code.includes("enrollmentPhaseOn"),
        `${fn}은 시작·종료 두 경계를 enrollmentPhaseOn 단일 소스로 판정할 것.`,
      ).toBe(true);
    });

    it(`${fn}은 전출 판정에 필요한 is_transferred를 실제로 조회한다`, () => {
      // 안 받아오면 항상 false로 떨어져 **반이동 학생이 옛 반에 하루 더 남는다**(두 반 동시 노출).
      expect(code, `${fn}이 is_transferred를 select하지 않으면 전출 배타 판정이 무력화된다`).toContain(
        "is_transferred",
      );
    });
  }
});

/**
 * **인원 카운트도 상세와 같은 규약** — 목록과 상세가 갈리지 않게.
 *
 * 2026-08-29: 반이동을 예약하면 옛 수강에 미래 종료일이 붙는데, 목록 카운트는 `.is("end_date", null)`로
 * 세고 있어 **아직 다니는 학생이 목록에서만 빠졌다**. 반대로 미래 시작(예약된 합류)은 목록에 섞였다.
 * 🔴 그렇다고 서버측 필터를 통째로 빼면 전 이력을 끌어와 1000행 캡에 걸린다([[#54]], 실측 1,338행).
 */
describe("수업목록 인원 — 상세와 같은 규약", () => {
  const src = readFileSync(join(process.cwd(), "src", "features", "classes", "server", "queries.ts"), "utf8");
  const code = stripComments(src);

  it("카운트 쿼리가 .is(\"end_date\", null)로 세지 않는다", () => {
    const bad = code.match(/\.select\("class_id"\)\s*\.is\(\s*["']end_date["']\s*,\s*null\s*\)/g) ?? [];
    expect(bad, "종료일이 잡힌 학생(아직 다니는 중)이 목록 인원에서 빠진다").toEqual([]);
  });

  it("카운트는 onRosterRow 단일 소스로 거른다", () => {
    const n = (code.match(/onRosterRow\(e, rosterToday\)/g) ?? []).length;
    expect(n, "인원 카운트 3곳이 모두 같은 규약을 써야 목록과 상세가 안 갈린다").toBe(3);
  });

  it("카운트 쿼리는 끝난 수강을 서버에서 자른다(1000행 캡 회피)", () => {
    const n = (code.match(/end_date\.is\.null,end_date\.gte\./g) ?? []).length;
    expect(n, "필터를 빼면 전 이력을 끌어와 학생 수가 조용히 과소집계된다(#54)").toBeGreaterThanOrEqual(3);
  });
});
