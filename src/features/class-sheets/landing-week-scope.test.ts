/**
 * **그 주에 수업이 없는 반은 ECS 목록에 세우지 않는다** — 원장 2026-08-29
 * *"ecs도 9/1 이후에 수업 없을때 차단할 수 있는지 확인체크. 미래보기의 경우."*
 *
 * 시간표는 칸을 슬롯에서 그려 저절로 사라지지만, ECS 랜딩은 **반을 먼저 세워 놓고** 그 주 교시를
 * 세는 구조라 안 걸러내면 `0/0` 카드가 남는다. 실측(2026-08-29, injaewon):
 *   · 9/1 신설 반 `PL1b` · `중등E_초6 MED b` → 6월 말부터 **매주** 0교시로 목록에 떠 있었다
 *   · 6월 중순 주차엔 그런 반이 **17개**
 * 분모가 0인 카드는 담임에게 **할 수 없는 일**(미작성 N반)을 재촉한다.
 *
 * 이 파일이 잠그는 것은 규약 셋이다 — 하나만 어긋나도 에러 없이 틀린다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const queries = strip(read("src", "features", "class-sheets", "server", "queries.ts"));
const access = strip(read("src", "features", "class-sheets", "server", "access.ts"));
const page = read("src", "app", "(shell)", "ecs", "page.tsx");

describe("주 배정 0인 반은 목록에서 뺀다", () => {
  it("목록·개수·필터가 모두 `running`(그 주 배정 있는 반)에서 나온다", () => {
    expect(queries).toMatch(/const running = inScope\.filter\(/);
    // 개수도 같은 집합에서 세야 한다 — 안 그러면 "전체 9"를 눌렀는데 카드가 7장 뜬다.
    expect(queries).toMatch(/all: running\.length/);
    expect(queries).toMatch(/eie: keepEnglishTrack\(running, "eie"\)/);
    expect(queries).toMatch(/injaewon: keepEnglishTrack\(running, "injaewon"\)/);
    expect(queries).toMatch(/keepEnglishTrack\(running, trackFilter\)/);
  });

  it("🔴 판정은 `hasLiveSlotInWeek` — 작성률 분모(scheduled)로도, 행 유무로도 세지 않는다", () => {
    // `scheduled`는 LAB을 빼고 JJ는 **개인 표시 토글**로 갈린다. 그걸로 거르면 토글 한 번에
    // 반이 목록에서 사라진다(보기 설정이 목록을 지우는 것은 사용자가 예측할 수 없다).
    // 행 유무로 세면 `valid_from`이 그 주 중간인 슬롯을 "그 주에 돈다"고 잘못 센다.
    expect(queries).toMatch(/const running = inScope\.filter\(\(c\) =>\s*hasLiveSlotInWeek\(/);
    const decl = queries.slice(queries.search(/const running =/), queries.search(/const trackCounts =/));
    expect(decl).not.toContain("scheduledSlotKeySet");
    expect(decl).not.toContain("showSelfStudy");
    expect(decl).not.toMatch(/\.length \?\? 0\) > 0/);
  });

  it("슬롯 조회가 **필터보다 먼저** 돈다(스코프 묶음과 한 번에 — B4)", () => {
    // 필터 뒤에서 조회하면 `running`을 만들 재료가 없다. 순서가 뒤집히면 조용히 옛 동작으로 돌아간다.
    const at = (re: RegExp) => queries.search(re);
    expect(at(/allClassIds/)).toBeGreaterThan(-1);
    expect(at(/allClassIds, \(chunk\) =>/)).toBeLessThan(at(/const running =/));
    expect(at(/const running =/)).toBeLessThan(at(/const classIds = classes\.map/));
  });

  it("빈 목록 사유를 '담당 반 없음'과 구분한다(고칠 수 없는 일을 시키지 않는다)", () => {
    expect(queries).toContain('"no-week-classes"');
    expect(queries).toMatch(
      /running\.length > 0\s*\?\s*"filtered"\s*:\s*emptyOnlyThisWeek\s*\?\s*"no-week-classes"/,
    );
    // 화면이 그 사유를 실제로 말해야 한다 — 타입만 늘리고 안내가 없으면 옛 문구로 떨어진다.
    expect(page).toContain('res.emptyReason === "no-week-classes"');
    expect(page).toContain("위 주 이동으로 다른 주를 확인하세요");
  });

  it("부담임 갈래도 그 주로 좁힌다 — 관계가 끝난 반은 미래 주차에서 사라진다", () => {
    // 원장 2026-08-29 *"미래 시간이동할때 9/1 이후에 수업하는 반이 아니면 사라져야하는데"*.
    // 반은 계속 도는데 **내 슬롯만** 끝난 경우라, 위 `running`(반 단위)으로는 안 잡힌다.
    expect(queries).toMatch(/ecsVisibleClassFilter\(weekMonday\)/);
    expect(access).toMatch(/englishAssistantClassIdsOf\(teacherId, weekMonday\)/);
    // 좁힘은 **부담임 갈래만** — 담임은 시간 축이 없고(9/1 cron 몫), 위임은 이미 오늘 ±7일 창이다.
    expect(access).toMatch(/englishAssistantClassIdsOf\(\s*teacherId: string,/);
  });

  it("🔴 부담임만 하는 강사에게 '담당 반이 없습니다'라고 하지 않는다", () => {
    // 스코프가 그 주에만 비었을 뿐이면 주를 옮기면 보인다 — 반 배정을 문의하라는 건 거짓 안내다.
    expect(access).toContain("hasScopeAnyWeek");
    expect(queries).toMatch(/const emptyOnlyThisWeek = inScope\.length > 0 \|\| \(scopeSet !== null && hasScopeAnyWeek\)/);
  });

  it("⚠️ 게이트는 주로 좁히지 않는다 — 과거 주차 시트 열람은 유지된다", () => {
    // 목록에서 빠져도 URL로 그 주를 여는 건 그대로여야 한다(빈 시트가 뜰 뿐).
    // 게이트에 주를 끼워 넣으면 지난 주 시트가 통째로 "담당 반이 아닙니다"가 된다.
    const gate = access.slice(
      access.search(/export async function requireEcsClassAccess/),
      access.search(/export const ecsAssistantClassIds/),
    );
    expect(gate.length).toBeGreaterThan(200);
    expect(gate).not.toContain("weekMonday");
    // 게이트가 쓰는 부담임 스코프는 **인자 없는** 캐시판이어야 한다(전 기간).
    expect(gate).toMatch(/ecsAssistantClassIds\(\)/);
  });
});
