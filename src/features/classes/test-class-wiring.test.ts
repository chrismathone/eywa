/**
 * ClassNote 테스트 전용 반 배선 가드 — "모든 강사에게 보인다"가 조용히 끊기지 않게.
 *
 * 이 반은 담임이 없어(`classes.teacher_id` = null) 일반 경로엔 **절대** 안 잡힌다. 그래서 배선이
 * 끊겨도 에러가 안 나고 그냥 아무에게도 안 보인다 — 그 침묵을 구조 가드로 막는다.
 * 짝 가드: 게이트(`getTeachingClassIds`)와 로스터(`getTeachingClasses`)가 **같은 집합**이어야 한다
 * (갈리면 "화면엔 뜨는데 저장하면 거절").
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEST_CLASS_NAME, isTestClassName } from "./test-class";

const read = (rel: string): string => readFileSync(join(process.cwd(), rel), "utf8");
/** 주석을 걷어낸 본문 — 주석에 적힌 이름 때문에 가드가 통과하는 것을 막는다. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("isTestClassName", () => {
  it("정확히 일치할 때만 참", () => {
    expect(isTestClassName(TEST_CLASS_NAME)).toBe(true);
    expect(isTestClassName(` ${TEST_CLASS_NAME} `)).toBe(true); // 앞뒤 공백은 허용
  });

  it("부분 일치·빈 값은 거짓 — 실제 반이 걸려들면 전 강사에게 샌다", () => {
    expect(isTestClassName("학원이")).toBe(false);
    expect(isTestClassName("초등M 학원이(테스트) 보강")).toBe(false);
    expect(isTestClassName(null)).toBe(false);
    expect(isTestClassName(undefined)).toBe(false);
    expect(isTestClassName("")).toBe(false);
  });
});

describe("delegation.ts — 게이트·로스터 둘 다 테스트 반을 넣는다", () => {
  const src = stripComments(read("src/features/classes/server/delegation.ts"));
  const bodyOf = (fn: string): string => {
    const start = src.indexOf(`export async function ${fn}`);
    expect(start).toBeGreaterThan(-1);
    const next = src.indexOf("\nexport ", start + 1);
    return src.slice(start, next === -1 ? undefined : next);
  };

  it("상수를 import한다(문자열 하드코딩 금지)", () => {
    expect(src).toContain('from "../test-class"');
    expect(src).toContain("TEST_CLASS_NAME");
  });

  for (const fn of ["getTeachingClassIds", "getTeachingClasses"]) {
    it(`${fn}가 활성 테스트 반을 조회한다`, () => {
      const body = bodyOf(fn);
      expect(body).toContain('.eq("class_name", TEST_CLASS_NAME)');
      // 회수 수단 = 반 비활성화. is_active를 빼면 지운 반이 되살아난다.
      expect(body).toContain('.eq("is_active", true)');
    });

    it(`${fn}의 테스트 반 조회가 Promise.all 안에 있다(B4: 왕복이 직렬로 붙지 않게)`, () => {
      const body = bodyOf(fn);
      const all = body.indexOf("await Promise.all([");
      const q = body.indexOf('.eq("class_name", TEST_CLASS_NAME)');
      const close = body.indexOf("]);", all);
      expect(all).toBeGreaterThan(-1);
      expect(q).toBeGreaterThan(all);
      expect(q).toBeLessThan(close);
    });

    it(`${fn}가 fail-soft다 — 조회 실패가 게이트를 죽이지 않는다`, () => {
      expect(bodyOf(fn)).toContain("testRes.data ?? []");
    });
  }
});

describe("roster.ts — 요일 필터 뒤에 덧붙이고 todayIds는 건드리지 않는다", () => {
  const src = stripComments(read("src/features/onescreen/server/roster.ts"));

  it("isTestClassName으로 판정한다", () => {
    expect(src).toContain('from "@/features/classes/test-class"');
    expect(src).toContain("isTestClassName(c.class_name)");
  });

  it("activeClasses가 정해진 **뒤에** 덧붙인다", () => {
    const active = src.indexOf("const activeClasses =");
    const push = src.indexOf("activeClasses.push(testClass)");
    const classById = src.indexOf("const classById =");
    expect(active).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(active);
    expect(push).toBeLessThan(classById); // classById·activeIds가 이 반을 포함해야 한다
  });

  it("이미 들어 있으면 두 번 넣지 않는다(showAll이면 allClasses와 같은 배열이다)", () => {
    expect(src).toContain("!activeClasses.some((c) => c.id === testClass.id)");
  });

  it("🔴 todayIds·noClassesToday에는 넣지 않는다 — '오늘 수업 없음' 신호가 죽는다", () => {
    expect(src).not.toContain("todayIds.add");
    // noClassesToday는 여전히 todayIds.size로만 정해진다.
    expect(src).toContain("const noClassesToday = todayIds.size === 0");
  });
});
