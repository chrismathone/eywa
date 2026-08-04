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

    it(`${fn}은 isEnrollmentEndedOn 단일 소스로 판정한다`, () => {
      expect(
        code,
        `종료 규약(일반=당일 포함 / 반이동=당일 배타)을 ${fn}에서 다시 구현하지 말 것.`,
      ).toContain("isEnrollmentEndedOn");
    });

    it(`${fn}은 전출 판정에 필요한 is_transferred를 실제로 조회한다`, () => {
      // 안 받아오면 항상 false로 떨어져 **반이동 학생이 옛 반에 하루 더 남는다**(두 반 동시 노출).
      expect(code, `${fn}이 is_transferred를 select하지 않으면 전출 배타 판정이 무력화된다`).toContain(
        "is_transferred",
      );
    });
  }
});
