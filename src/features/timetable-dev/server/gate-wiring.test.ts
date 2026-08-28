import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 시간표(개발중) **서버 계층**의 두 가지 구조 보장.
 *
 * (격리 — 계획이 `class_schedules`·본 시간표로 새지 않는가 — 는 [`../isolation.test.ts`]가 전담한다.
 *  여기선 그 표에 닿는 **경로 자체**가 안전한지만 본다.)
 *
 * ① **게이트**: `timetable_plan_slots`는 RLS를 켜고 정책이 0개다(0231a) — 세션 클라이언트로는 에러 없이
 *    0행이 오고([[#104]]) 실제 접근은 전부 service_role(admin)로 이뤄진다. 즉 **DB가 아무도 안 막는다**.
 *    권한을 판정하는 것은 앱의 `requireTimetablePlanAccess` 하나뿐이라, 액션이 하나라도 그걸 안 거치면
 *    로그인만 하면 누구나 학원 시간표 계획을 지울 수 있다(#77 — 화면에서 숨기는 건 게이트가 아니다).
 *
 * ② **테넌트 격리**: admin 클라이언트는 RLS를 우회하므로 `tenant_id` 명시 필터가 **유일한** 학원 경계다.
 *    한 체인에서 빠지면 타 학원 계획이 조회·삭제된다.
 */

const DIR = join(process.cwd(), "src", "features", "timetable-dev");
const PLAN_NEEDLES = ['.from("timetable_plan_slots")', ".from(PLAN_TABLE)"];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) sourceFiles(p, out);
    else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리지 않게). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** `needle` 이후 다음 `.from(`까지 = 그 테이블을 향한 한 체인. */
function chainsAfter(src: string, needle: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf(needle, i)) !== -1) {
    const start = i + needle.length;
    const next = src.indexOf(".from(", start);
    out.push(src.slice(start, next === -1 ? src.length : next));
    i = start;
  }
  return out;
}

describe("시간표(개발중) 서버 계층", () => {
  const files = sourceFiles(DIR).map((f) => [f, stripComments(readFileSync(f, "utf8"))] as const);

  it("스캔이 실제로 동작한다(체인을 하나도 못 찾으면 통과는 무의미)", () => {
    const chains = files.flatMap(([, src]) => PLAN_NEEDLES.flatMap((n) => chainsAfter(src, n)));
    expect(chains.length).toBeGreaterThan(4);
  });

  it("계획 표의 조회·삭제 체인은 tenant_id로 좁힌다(admin = RLS 우회)", () => {
    const offenders: string[] = [];
    for (const [file, src] of files) {
      for (const needle of PLAN_NEEDLES) {
        for (const chain of chainsAfter(src, needle)) {
          // insert는 행 payload가 tenant_id를 갖는다(PlanInsertRow 타입이 강제) → 필터 검사 대상 아님.
          if (chain.includes(".insert(")) continue;
          if (!chain.includes("tenant_id")) {
            offenders.push(`${file.replace(process.cwd(), "")} → ${chain.slice(0, 60).trim()}`);
          }
        }
      }
    }
    expect(
      offenders,
      "admin 클라이언트는 RLS를 우회한다 — tenant_id 명시 필터가 유일한 학원 경계다.",
    ).toEqual([]);
  });

  it("🔴 서버 액션 전부가 공용 쓰기 게이트를 거친다", () => {
    const actions = readFileSync(join(DIR, "server", "actions.ts"), "utf8");
    const exported = [...actions.matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    // 목록을 고정한다 — 새 액션을 더하면 이 줄이 빨개져서 "게이트 태웠나"를 반드시 다시 보게 된다.
    expect(exported.sort()).toEqual([
      "copyPlanMonth",
      "deletePlanMonth",
      "deletePlanSlot",
      "seedPlanFromLive",
      "upsertPlanSlot",
    ]);
    // 게이트는 planWriter() 한 곳을 거친다 — 액션마다 따로 판정하면 하나가 빠져도 티가 안 난다.
    expect([...actions.matchAll(/await planWriter\(\)/g)]).toHaveLength(exported.length);
    expect(actions).toContain("requireTimetablePlanAccess({ write: true })");
  });

  it("조회도 게이트를 거친다(권한 없음을 빈 목록으로 위장하지 않는다 — #89)", () => {
    const queries = readFileSync(join(DIR, "server", "queries.ts"), "utf8");
    expect(queries).toContain("requireTimetablePlanAccess()");
    expect(queries).toMatch(/throw new Error\(gate\.error\)/);
  });

  it("쓰기 게이트는 full만 통과한다(scoped 강사가 학원 전체 격자를 못 고치게 — perm-matrix 규약)", () => {
    const access = stripComments(readFileSync(join(DIR, "server", "access.ts"), "utf8"));
    expect(access).toMatch(/level === "full"/);
    expect(access).toContain('canWriteTenant(user.systemRole, "timetable")');
    // bare canAccess/accessLevel 직접호출 금지([[#58]]) — tenant-aware 헬퍼만.
    expect(access).not.toMatch(/\bfrom "@\/lib\/permissions"/);
  });
});
