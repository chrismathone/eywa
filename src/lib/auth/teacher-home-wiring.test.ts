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

/** 착지 지점 → 그 파일이 반드시 통과해야 하는 단일 소스 심볼. */
const LANDING_SURFACES: { file: string[]; via: string; what: string }[] = [
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
    file: ["src", "app", "home", "route.ts"],
    via: "landingPath",
    what: "로그인 착지 리다이렉터(/home)",
  },
  {
    // 🔴 로그인 폼은 **목적지를 스스로 정하면 안 된다** — 담당 과목을 모르는 데다, 로그인 직후엔
    // 세션 쿠키가 서버 요청에 아직 안 실릴 수 있어 클라가 물어봐도 답이 왔다갔다 한다(2026-08-07 경합).
    // 판정은 /home이 문서 요청에서 한다. 여기 있어야 할 것은 그리로 보내는 한 줄뿐이다.
    // (2026-09-23 M1 — 로그인 기록을 남기려고 `/home?login=1`로 가며, 그 주소는 login-next.ts 한 곳이 만든다.)
    file: ["src", "app", "(auth)", "login", "login-form.tsx"],
    via: "loginLandingHref",
    what: "로그인 직후 착지",
  },
  {
    file: ["src", "lib", "auth", "login-next.ts"],
    via: '"/home?login=1"',
    what: "로그인 착지 주소",
  },
  {
    file: ["src", "app", "(shell)", "me", "page.tsx"],
    via: "landingPath",
    what: "'내 정보'에서 홈으로 되돌아가기",
  },
  {
    // 급여명세서는 원장 전용이라 강사가 URL로 들어오면 되돌린다 — 그 되돌림도 착지 지점이다.
    file: ["src", "app", "(print)", "payroll", "[teacherId]", "payslip", "page.tsx"],
    via: "landingPath",
    what: "급여명세서 비-원장 되돌림",
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
    const offenders = LANDING_SURFACES.filter(({ file }) => read(file).includes('"/onescreen"'));
    expect(
      offenders.map((o) => o.file.join("/")),
      "착지 지점이 강사 홈을 하드코딩했다 — 영어 전담 강사가 빈 원스크린으로 떨어진다",
    ).toEqual([]);
  });

  it("착지 단일 소스가 자리 담당 착지(landingPathFromDuties)를 거친다", () => {
    expect(read(["src", "lib", "auth", "teacher-home.ts"])).toContain("landingPathFromDuties");
  });

  it("착지 단일 소스가 셔틀 담당 착지(getShuttleDuty)를 거치고, 그 화면이 메뉴 권한 없이 열린다", () => {
    // 🔴 짝으로 봐야 한다 — 착지만 넣고 페이지 우회를 빠뜨리면 셔틀 담당 계정이 로그인하는 순간
    //    착지 → requireAccess 거부 → 다시 착지로 무한히 돈다(ECS 홈에서 겪은 함정과 같은 모양).
    expect(read(["src", "lib", "auth", "teacher-home.ts"])).toContain("getShuttleDuty");
    expect(read(["src", "app", "(shell)", "shuttle", "today", "page.tsx"])).toContain(
      "requireShuttleView",
    );
    expect(read(["src", "features", "shuttle", "server", "access.ts"])).toContain("getShuttleDuty");
  });

  it("폴백 종점(원스크린)은 ROLE_LOCKED라 무한 리다이렉트가 없다", () => {
    // teacher_onescreen이 잠금 해제되면 "홈으로 폴백 → 홈이 거부 → 다시 폴백"이 무한히 돈다.
    // ECS는 잠기지 않은 메뉴라, teacher-home이 접근 확인 후에만 ECS를 준다(ecsHomeIfAllowed).
    const perms = read(["src", "lib", "permissions.ts"]);
    expect(perms).toMatch(/ROLE_LOCKED_MENUS\s*=\s*new Set<MenuKey>\(\[[^\]]*"teacher_onescreen"/);
    expect(read(["src", "lib", "auth", "teacher-home.ts"])).toContain('canAccess("teacher", "ecs"');
  });
});
