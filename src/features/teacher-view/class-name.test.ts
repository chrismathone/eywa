import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classNameFor, englishClassName } from "./class-name";

/**
 * 🔴 **고정 픽스처는 실제 반 이름이다**(2026-09-03 injaewon 활성 반 조회). 지어낸 예시로 잠그면
 *    사전이 실제 이름과 어긋나도 초록으로 통과한다.
 */
describe("반 이름 영문 표기 — 구조는 그대로, 낱말만", () => {
  it("🔴 한글이 없으면 원문 그대로 — EiE 반 이름은 손대지 않는다", () => {
    for (const n of ["PJ2", "LS4a", "MEC1-5", "RTT5", "PL1b", "KW3", "LE1", "JP1"]) {
      expect(englishClassName(n)).toBe(n);
    }
  });

  it.each([
    // 인재원 영어 — 밴드_학년 레벨 반구분
    ["고등E_고1 특별 S", "HighE_H1 Special S"],
    ["고등E_고2 심화", "HighE_H2 Advanced"],
    ["고등E_고2 정규 A", "HighE_H2 Regular A"],
    ["고등E_고3 정규", "HighE_H3 Regular"],
    ["중고E_중1 MED", "MidHighE_M1 MED"],
    ["중고E_중2 최상위", "MidHighE_M2 Top-tier"],
    ["중고E_중2 특별", "MidHighE_M2 Special"],
    ["중고E_중3 심화", "MidHighE_M3 Advanced"],
    ["중등E_중1 SKY", "MidE_M1 SKY"],
    ["중등E_중1 TOP", "MidE_M1 TOP"],
    ["중등E_중1 정규 A", "MidE_M1 Regular A"],
    ["중등E_중2 정규 C", "MidE_M2 Regular C"],
    ["중등E_초5 MED", "MidE_E5 MED"],
    ["중등E_초6 MED a", "MidE_E6 MED a"],
    ["중등E_초6 SKY", "MidE_E6 SKY"],
    ["중등E_초등 브릿지 A", "MidE_Elem Bridge A"],
    ["중등E_초등 브릿지 C2", "MidE_Elem Bridge C2"],
    // 수학 — 요일·개별/단체·특강
    ["고등M 개별 BS4F 토", "HighM Individual BS4F Sat"],
    ["고등M_일 개별진도", "HighM_Sun Individual Pace"],
    ["중등M 중1 EL2T 화금", "MidM M1 EL2T Tue·Fri"],
    ["중등M 중3 BS4B 월목", "MidM M3 BS4B Mon·Thu"],
    ["초등M 초5 JJ1A", "ElemM E5 JJ1A"],
    ["개별(초등M) 초5 BS2C", "Individual(ElemM) E5 BS2C"],
    ["[특강] 고등개별", "[Special] High Individual"],
    ["[특강]중2-2 문제 풀이반", "[Special]M2-2 Problem Solving"],
    ["[특강]중3-2 개념 완성반", "[Special]M3-2 Concept Mastery"],
    ["내신중등특강(오전)", "Mid Exam Prep(AM)"],
    ["내신중등특강(9/5)", "Mid Exam Prep(9/5)"],
    ["고등내신특강(목)", "High Exam Prep(Thu)"],
    ["주말내신특강(고1)", "Weekend Exam Prep(H1)"],
  ])("%s → %s", (ko, en) => {
    expect(englishClassName(ko)).toBe(en);
  });

  it("🔴 모르는 낱말은 그대로 남는다 — 지어내지 않는다(구조가 남아 대조는 계속 된다)", () => {
    expect(englishClassName("중등E_중1 융합")).toBe("MidE_M1 융합");
  });

  it("공백·`_`·괄호·연속 공백 등 구조는 하나도 안 바뀐다", () => {
    const ko = "중등M 개별  BS3R";
    const en = englishClassName(ko);
    expect(en).toBe("MidM Individual  BS3R");
    // 구분자 개수가 같아야 눈으로 1:1 대조가 된다.
    expect((en.match(/ /g) ?? []).length).toBe((ko.match(/ /g) ?? []).length);
  });

  it("🔴 ko는 원문 그대로 — 한국어 화면은 한 글자도 안 바뀐다", () => {
    for (const n of ["중등E_초등 브릿지 C", "고등M 개별 TP4E", "PJ2"]) {
      expect(classNameFor(n, "ko")).toBe(n);
    }
  });

  it("빈 값·null도 안전하다", () => {
    expect(classNameFor(null, "en")).toBe("");
    expect(classNameFor(undefined, "ko")).toBe("");
    expect(englishClassName("   ")).toBe("");
  });
});

/**
 * 🔴🔴 **학부모·사무실에 나가는 경로는 한국어 반 이름 고정**(원장 2026-09-03의 지시 범위는 강사뷰 화면이다).
 * ClassNote 공지·수업보고서·엑셀·인쇄물이 이 표기를 쓰면 학부모와 데스크가 **모르는 반 이름**을 받는다.
 */
describe("🔴 학부모·사무실 표면은 이 표기를 쓰지 않는다", () => {
  const ROOT = join(process.cwd(), "src");
  const FORBIDDEN_DIRS = [
    join(ROOT, "features", "report-admin"), // ClassNote 발송·공지
    join(ROOT, "features", "onescreen"), // 수업보고서
    join(ROOT, "features", "exports"), // 엑셀 내보내기
    join(ROOT, "lib", "messaging"), // 알림톡·문자 (🔴 `features/messaging`이 아니다 — 없는 경로였다)
    join(ROOT, "app", "(print)"), // 인쇄물
  ];

  // 🔴 **없는 디렉터리를 조용히 건너뛰지 않는다** — 경로가 바뀌면 가드가 "훑을 게 없었다"는 이유로
  //    초록이 되어 보호가 사라진다(실제로 같은 실수를 이 파일들에서 한 번 냈다). 파일이 한 개도
  //    안 잡히면 아래 `expect(files.length)`가 실패해 사람이 경로를 고치게 만든다.
  const walk = (dir: string): string[] => {
    let out: string[] = [];
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) out = out.concat(walk(p));
      else if (/\.(ts|tsx)$/.test(p)) out.push(p);
    }
    return out;
  };

  it.each(FORBIDDEN_DIRS)("%s 는 teacher-view/class-name 을 import하지 않는다", (dir) => {
    const files = walk(dir);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files.filter((f) => /teacher-view\/class-name/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
