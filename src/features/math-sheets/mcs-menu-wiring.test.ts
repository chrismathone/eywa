/**
 * 수학 시트로 **가는 길이 있는가**를 잠근다.
 *
 * 2026-09-01 실측: 수학만 맡은 강사 9명에게 MCS 링크가 **하나도 없었다.** 강사는 사이드바도 검색
 * 팰릿도 없는 미니셸을 쓰고 유일한 이동 수단이 헤더 '내 메뉴' 드롭다운인데, 그 목록에 `/mcs`가
 * 아예 빠져 있었다(권한은 있어서 주소를 직접 치면 열렸다 — 그래서 아무도 에러를 못 봤다).
 *
 * ⚠️ 새 진입로를 만들면 여기에도 추가할 것. 화면 없는 기능은 없는 기능이다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...p: string[]) => readFileSync(join(process.cwd(), ...p), "utf8");

describe("강사 '내 메뉴' — 수학 강사 시트 진입로", () => {
  const src = read("src", "components", "teacher-menu.tsx");

  it("🔴 `/mcs` 항목이 있다(이게 강사의 유일한 진입로다)", () => {
    expect(src).toMatch(/href:\s*"\/mcs"/);
    expect(src).toMatch(/menu:\s*"mcs"/);
    expect(src).toContain("수학 강사 시트");
  });

  it("노출은 담당 과목으로 가른다 — 영어(`showEcs`)와 대칭인 `showMcs`", () => {
    expect(src).toContain("showMcs");
    expect(src).toMatch(/l\.menu !== "mcs" \|\| showMcs/);
  });
});

describe("셸 레이아웃 — showMcs 배선", () => {
  const src = read("src", "app", "(shell)", "layout.tsx");

  it("🔴 담당 과목에 math가 있을 때만 + 권한도 함께 본다", () => {
    expect(src).toMatch(/subjects\.includes\("math"\)/);
    expect(src).toMatch(/canAccess\(user\.systemRole, "mcs", permMatrix\)/);
  });

  it("계산한 값을 실제로 넘긴다(계산만 하고 안 넘기면 아무 일도 안 난다)", () => {
    expect(src).toMatch(/showMcs=\{mcsForTeacher\}/);
  });
});

describe("영어 시트 빈 목록 — 막다른 안내 금지", () => {
  const src = read("src", "app", "(shell)", "ecs", "page.tsx");

  it("🔴 담당 영어 반이 0개일 때 수학 시트로 가는 길을 적는다", () => {
    expect(src).toMatch(/href="\/mcs"/);
    // 2026-09-03 화면 언어(한/영) 전환 후 링크 글자는 사전(`class-sheets/i18n.ts`)에서 온다 →
    // 문자열이 아니라 **그 키를 실제로 그리는지**를 본다. 한국어 원문은 사전 쪽 가드가 지킨다.
    expect(src).toContain('sheetT(lang, "landing.empty.noScoped.link")');
  });
});
