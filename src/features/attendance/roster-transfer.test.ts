/**
 * **반이동 종료 규약이 모든 명단 표면에 걸려 있는가** — 회귀 방지.
 *
 * 2026-09-01 실측 사고: 9/1자 시간표 가져오기로 12명이 반을 옮겼는데, 그날 하루
 * **JJ·LAB 자리 출석부에 옛 반·새 반 양쪽으로 섰다**(JJ 87행 중 8행·LAB 62행 중 4행이 유령).
 * 반 상세·수업목록·반별 출석부는 2026-08-29에 [eligibility](../enrollments/eligibility.ts)로
 * 배선됐는데 **자리 계열만 그 정리에서 빠져** 화면끼리 갈렸다.
 *
 * 뿌리는 하나다 — 이동 RPC(`move_enrollments_batch`)가 옛 수강을 `end_date = 적용일`로 닫는데
 * (GiST `daterange`가 `[start, end)`라 그날은 이미 새 반), 쿼리·판정은 `end_date >= 오늘`처럼
 * **종료일을 포함**해 비교하면 그 하루가 겹친다. 그래서 종료 판정은 `isEnrollmentEndedOn`
 * 하나만 쓴다(일반 종료는 당일 포함 / 반이동은 당일 배타).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isEnrolledOn } from "./enrollment-span";
import { buildAbsenceCells } from "./intake/absence-intake";

const read = (...seg: string[]) => readFileSync(join(process.cwd(), "src", "features", ...seg), "utf8");
/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 문구가 스스로 위반으로 걸리지 않게). */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

describe("isEnrolledOn — 반이동은 종료일 당일 배타", () => {
  it("반이동으로 닫힌 구간은 종료일 당일 이미 옛 반이 아니다", () => {
    const spans = [{ start: "2026-03-01", end: "2026-09-01", isTransferred: true }];
    expect(isEnrolledOn("2026-08-31", spans)).toBe(true);
    expect(isEnrolledOn("2026-09-01", spans)).toBe(false);
  });

  it("일반 종료(퇴원·수강 종료)는 그날까지 재원이다", () => {
    const spans = [{ start: "2026-03-01", end: "2026-09-01", isTransferred: false }];
    expect(isEnrolledOn("2026-09-01", spans)).toBe(true);
    expect(isEnrolledOn("2026-09-02", spans)).toBe(false);
  });

  it("표식을 모르면 일반 종료로 본다 — 근거 없이 하루 일찍 지우지 않는다", () => {
    expect(isEnrolledOn("2026-09-01", [{ start: "2026-03-01", end: "2026-09-01" }])).toBe(true);
  });

  it("옛 반·새 반이 같은 날 겹치지 않는다(이동일 하루가 양쪽에 서던 그 버그)", () => {
    const oldClass = [{ start: "2026-03-01", end: "2026-09-01", isTransferred: true }];
    const newClass = [{ start: "2026-09-01", end: null, isTransferred: false }];
    expect(isEnrolledOn("2026-09-01", oldClass)).toBe(false);
    expect(isEnrolledOn("2026-09-01", newClass)).toBe(true);
  });
});

describe("결석 접수 — 이동일에 옛 반 칸을 만들지 않는다", () => {
  const base = {
    dates: ["2026-09-01"],
    holidays: new Set<string>(),
    slots: [
      { classId: "old", dayOfWeek: "tue", startTime: "17:20", validFrom: null, validTo: null },
      { classId: "new", dayOfWeek: "tue", startTime: "17:20", validFrom: null, validTo: null },
    ],
  };

  it("이동한 옛 반은 빠지고 새 반만 남는다", () => {
    const cells = buildAbsenceCells({
      ...base,
      enrollments: [
        {
          classId: "old",
          className: "중등E_초6 MED a",
          subject: "english",
          startDate: "2026-03-01",
          endDate: "2026-09-01",
          isTransferred: true,
          attendanceDays: null,
        },
        {
          classId: "new",
          className: "중등E_초6 MED b",
          subject: "english",
          startDate: "2026-09-01",
          endDate: null,
          isTransferred: false,
          attendanceDays: null,
        },
      ],
    });
    expect(cells.map((c) => c.classId)).toEqual(["new"]);
  });
});

/**
 * 아래는 **IO가 있어 단위테스트로 못 잡는 자리**의 배선 가드다 — 쿼리가 `is_transferred`를
 * 실제로 select하고, 판정을 eligibility에 맡기는지 소스로 확인한다.
 * ⚠️ 이름만 보는 가드는 소용이 없어서(2026-09-01 리뷰), select 문자열과 호출을 **둘 다** 본다.
 */
describe("명단 쿼리 배선 — is_transferred를 실제로 싣는다", () => {
  const targets = [
    { what: "자리(JJ·LAB) 일별 출석부", src: code(read("attendance", "seat", "server", "queries.ts")), call: /isEnrollmentActiveOn\(/ },
    { what: "자리 월별 출석부", src: code(read("attendance", "seat", "server", "monthly-queries.ts")), call: /isTransferred: e\.is_transferred === true/ },
    { what: "반별 월별 출석부(매트릭스)", src: code(read("attendance", "server", "queries.ts")), call: /isTransferred: e\.is_transferred === true/ },
    { what: "키오스크 체크인", src: code(read("attendance", "kiosk", "server", "checkin.ts")), call: /isEnrollmentActiveOn\(/ },
    { what: "결석 접수 조회", src: code(read("attendance", "intake", "server", "queries.ts")), call: /isTransferred: e\.is_transferred === true/ },
    { what: "수업보고서 반 해석", src: code(read("report-admin", "server", "resolve-class.ts")), call: /isEnrollmentEndedOn\(/ },
  ];

  for (const t of targets) {
    it(`${t.what}는 enrollments select에 is_transferred가 있다`, () => {
      expect(t.src, `${t.what}가 is_transferred를 안 받으면 판정이 항상 '일반 종료'로 떨어진다`).toContain(
        "is_transferred",
      );
    });
    it(`${t.what}는 종료 규약을 다시 구현하지 않는다`, () => {
      expect(t.call.test(t.src), `${t.what}는 eligibility 단일 소스를 거쳐야 한다`).toBe(true);
    });
  }
});

/**
 * 🔴 **반이동 판정용 '다른 반' 조회**도 표식을 실어야 한다 — 위 가드는 파일 안에 `is_transferred`라는
 * 글자만 있으면 통과하므로, **같은 파일의 다른 쿼리**가 빠져도 안 걸린다(적대 리뷰 2026-09-14 실측:
 * 옛 반은 '반이동'인데 새 반은 '신입'으로 떠서 같은 사건이 두 이름을 가졌다 — 9월 23건).
 * 여기서는 `others`(다른 반 수강)를 만드는 자리에 `isTransferred:`가 실제로 붙는지 센다.
 */
describe("반이동 판정 재료 — '다른 반' 조회도 is_transferred를 싣는다", () => {
  const targets = [
    { what: "반별 월별 출석부(매트릭스)", src: code(read("attendance", "server", "queries.ts")) },
    { what: "자리 월별 출석부", src: code(read("attendance", "seat", "server", "monthly-queries.ts")) },
  ];
  for (const t of targets) {
    it(`${t.what}의 다른 반 조회가 표식을 넘긴다`, () => {
      // `isTransferred:` 대입이 **둘 이상**(명단 + 다른 반) 있어야 한다 — 하나면 다른 반 쪽이 빠진 것이다.
      const hits = t.src.match(/isTransferred:/g) ?? [];
      expect(hits.length, `${t.what}: 다른 반 수강에 표식이 없으면 새 반이 '신입'으로 뜬다`).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("자리 일별 출석부 — 넓은 필터로 끝내지 않는다", () => {
  const src = code(read("attendance", "seat", "server", "queries.ts"));

  it("end_date 프리필터만 걸고 끝내면 이동 당일 옛 반이 남는다", () => {
    // 프리필터 자체는 필요하다(1000행 캡, #54) — 그 뒤에 판정이 **반드시** 따라와야 한다.
    expect(src).toContain("end_date.is.null,end_date.gte.");
    expect(src).toContain("isEnrollmentActiveOn(");
  });

  it("명단 루프가 start_date·end_date를 실제로 넘긴다", () => {
    expect(src).toMatch(/startDate: e\.start_date/);
    expect(src).toMatch(/endDate: e\.end_date/);
  });
});
