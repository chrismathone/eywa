/**
 * 강사 홈 착지 지점이 **다시 하드코딩으로 새지 않게** 잠근다 (2026-08-07 영어 강사뷰 차별화).
 *
 * 강사 홈은 이제 담당 과목으로 갈린다(영어 전담=`/ecs`·그 외=`/onescreen`). 착지 지점이 여러 곳이라
 * 한 곳만 `"/onescreen"`을 그대로 들고 있으면 **그 경로로 들어온 영어 강사만** 빈 원스크린에 떨어진다
 * — 화면은 멀쩡해 보이고 제보도 "가끔 그래요"로 흐려져서, 눈으로는 못 잡는 종류의 회귀다.
 *
 * ⚠️ 착지 지점을 새로 만들면 **여기에도 추가**할 것. 그게 "전부 배선했나"의 체크리스트다.
 * (`teacher-home-rule.test.ts`가 규칙 자체를, 이 파일이 규칙의 소비처를 담당한다.)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 착지 지점 → 그 파일이 반드시 통과해야 하는 단일 소스 심볼.
 * `literalOk`는 **의도된 하드코딩 폴백**이 있는 자리(현재 로그인 폼 하나) — 이유는 그 항목 주석에.
 */
const LANDING_SURFACES: { file: string[]; via: string; what: string; literalOk?: true }[] = [
  {
    file: ["src", "lib", "auth", "require-access.ts"],
    via: "landingPath",
    what: "권한 거부 폴백",
  },
  {
    file: ["src", "app", "(shell)", "layout.tsx"],
    via: "teacherViewHome",
    what: "강사 미니셸 뷰-경로 정합성 가드",
  },
  {
    file: ["src", "app", "(marketing)", "page.tsx"],
    via: "landingPath",
    what: "로그인 상태 랜딩 폴백",
  },
  {
    file: ["src", "features", "shell", "view-actions.ts"],
    via: "teacherHomeForSubjects",
    what: "관리자 → 강사뷰 전환 착지",
  },
  {
    file: ["src", "app", "(auth)", "login", "login-form.tsx"],
    via: "resolveLoginLanding",
    what: "로그인 직후 착지",
    // 클라라 서버에 물어보는 것 외엔 방법이 없고, 세션 쿠키가 아직 안 실린 찰나엔 그 질문이 빈손으로
    // 돌아온다. 그때의 최후 폴백만 role 기반 리터럴로 남는다 — **로그인을 절대 막지 않기 위한** 자리다.
    literalOk: true,
  },
  {
    file: ["src", "app", "(shell)", "me", "page.tsx"],
    via: "landingPath",
    what: "'내 정보'에서 홈으로 되돌아가기",
  },
];

function read(parts: string[]): string {
  return readFileSync(join(process.cwd(), ...parts), "utf8");
}

describe("강사 홈 착지 지점 배선", () => {
  for (const { file, via, what } of LANDING_SURFACES) {
    it(`${what}(${file.at(-1)})가 ${via}를 통과한다`, () => {
      expect(read(file), `${file.join("/")}가 강사 홈을 단일 소스 없이 정한다`).toContain(via);
    });
  }

  it("착지 지점 어디에도 강사 홈이 하드코딩돼 있지 않다", () => {
    // 문자열 리터럴 "/onescreen"을 직접 들고 있으면 영어 강사가 그 경로로 새 원스크린에 떨어진다.
    // (알림 링크·prefetch 목록 등 "원스크린 그 화면을 가리키는" 용도는 대상이 아니다 — 여기 목록은
    //  '홈이 어디냐'를 정하는 자리뿐이다.)
    const offenders = LANDING_SURFACES.filter(
      ({ file, literalOk }) => !literalOk && read(file).includes('"/onescreen"'),
    );
    expect(
      offenders.map((o) => o.file.join("/")),
      "착지 지점이 강사 홈을 하드코딩했다 — 영어 전담 강사가 빈 원스크린으로 떨어진다",
    ).toEqual([]);
  });

  it("폴백 종점(원스크린)은 ROLE_LOCKED라 무한 리다이렉트가 없다", () => {
    // teacher_onescreen이 잠금 해제되면 "홈으로 폴백 → 홈이 거부 → 다시 폴백"이 무한히 돈다.
    // ECS는 잠기지 않은 메뉴라, teacher-home이 접근 확인 후에만 ECS를 준다(ecsHomeIfAllowed).
    const perms = read(["src", "lib", "permissions.ts"]);
    expect(perms).toMatch(/ROLE_LOCKED_MENUS\s*=\s*new Set<MenuKey>\(\[[^\]]*"teacher_onescreen"/);
    expect(read(["src", "lib", "auth", "teacher-home.ts"])).toContain('canAccess("teacher", "ecs"');
  });
});
