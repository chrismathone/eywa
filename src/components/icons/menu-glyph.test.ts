import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { isConnectedAppMenu } from "@/lib/permissions";
import { MENU_GLYPH_NAMES } from "./menu-glyph";

const ROOT = join(__dirname, "..", "..", "..");
const ICON_DIR = join(ROOT, "public", "icons");
const SRC = join(ROOT, "src");

/**
 * 탭 아이콘은 **그림 파일**이다(원장 2026-09-08, B 스티커 화풍). 그림이 빠지면 화면에선 조용히
 * 깨진 이미지·엉뚱한 선화가 되므로 여기서 파일 존재를 잠근다.
 */
describe("탭 아이콘 그림 파일", () => {
  it("MENU_GLYPH_NAMES의 이름은 전부 public/icons에 파일이 있다", () => {
    const missing = [...MENU_GLYPH_NAMES].filter((n) => !existsSync(join(ICON_DIR, `${n}.png`)));
    expect(missing).toEqual([]);
  });

  it("public/icons의 파일은 전부 MENU_GLYPH_NAMES에 등록돼 있다 — 쓰이지 않는 그림을 남기지 않는다", () => {
    const files = readdirSync(ICON_DIR)
      .filter((f) => f.endsWith(".png"))
      .map((f) => f.replace(/\.png$/, ""));
    const orphan = files.filter((n) => !MENU_GLYPH_NAMES.has(n));
    expect(orphan).toEqual([]);
  });

/**
 * **스티커가 아직 안 그려진 아이콘** — 이름을 여기 적어 두는 동안만 선화(`EyIcon`)로 돈다.
 *
 * 🔴 이건 가드를 무르는 게 아니라 **"아직 없음"을 기록**하는 자리다. 비워 두는 것이 정상이고, 여기 적힌
 *    이름은 메뉴 보드에서 혼자 선화로 서서 눈에 띈다(그게 목적이다 — 잊히지 않게).
 * 🔴 **같은 그림을 다른 이름으로 복사해 때우지 말 것** — 보드에 똑같은 그림 두 장이 서는 건 원장이
 *    2026-09-08에 이미 반려한 모양이다. 선화 한 칸이 거짓 스티커보다 낫다.
 *
 * · `bookText` — 교재목록(2026-09-16 신설). `book`(수업목록)·`bookMarked`(교재 요청)과 뜻이 달라
 *   같은 그림을 쓸 수 없고, `public/icons`에 남는 그림 중 책 계열이 없다. 스티커가 생기면 이 줄을 지운다.
 * · `pieChart` — 원생 기여도(2026-10-22 신설). 처음 단 `listChecks`(출결 모드)·`clipboardList`(오늘 출결)가
 *   겹쳤고, 남은 그림(alert·trash)은 뜻이 다르다. 스티커가 생기면 이 줄을 지운다.
 */
// edit = 원생목록의 영어이름 편집 권한. 독립 메뉴 없이 이름 칸 안에서만 쓰는 조작이다.
const PENDING_GLYPH = new Set<string>(["bookText", "calendarClock", "checkbox", "edit", "eye", "pieChart", "search", "layers", "target", "merge", "filePlus", "send", "barChart", "message", "shieldCheck"]); // target·merge·filePlus·send·barChart = 시안 이식 메뉴(조직·OKR · 지식그래프 · 업무 작성센터 · 홍보·마케팅, 2026-11-09) · message = 학원 비서 권한 키(2026-11-09 — 메뉴 타일이 아니라 단추로 그린다) · shieldCheck = 셔틀 관리자 화면 권한 키(2026-11-10 — 메뉴 타일 아님) // search = 셔틀 가까운 노선 찾기(2026-10-26) · checkbox = 비포클래스체크리스트(초안, 2026-10-28) · layers = 셔틀 탑승 학생 시간표(2026-10-29) — 스티커 생성 전 선화 폴백

  it("메뉴가 쓰는 아이콘 이름은 전부 그림이 있다 — MENU_ICON + 허브 면 override", () => {
    const icons = readFileSync(join(SRC, "components", "icons", "aywa-icons.tsx"), "utf8");
    const menuBlock = icons.slice(
      icons.indexOf("export const MENU_ICON"),
      icons.indexOf("} as const satisfies Record<MenuKey"),
    );
    // 연결 앱 권한 키(app_* · 2026-11-05)는 메뉴 보드의 탭이 아니다 — 연결 앱 줄이 선화(EyIcon)로 그리므로 스티커를 요구하지 않는다.
    const used = new Set<string>(
      [...menuBlock.matchAll(/(\w+):\s*"(\w+)"/g)].filter((m) => !isConnectedAppMenu(m[1]!)).map((m) => m[2]!),
    );
    const hub = readFileSync(join(SRC, "lib", "menu-hub.ts"), "utf8");
    for (const m of hub.matchAll(/icon:\s*"(\w+)"/g)) used.add(m[1]!);

    const missing = [...used].filter((n) => !MENU_GLYPH_NAMES.has(n) && !PENDING_GLYPH.has(n)).sort();
    expect(missing).toEqual([]);
  });

  /**
   * 🔴 **뜻이 다르면 그림도 다르다**(원장 2026-09-08 *"같은 아이콘을 안쓰면 좋겠는데"* — 메뉴 보드에서
   * 출석부와 수업 평가가 같은 클립보드였다). 선화 시절엔 공유해도 티가 덜 났지만, 색이 박힌 그림은
   * 나란히 선 타일에서 곧바로 같은 것으로 읽힌다.
   */
  it("스티커 미제작 목록에 **이미 그림이 있는 이름**을 남겨 두지 않는다", () => {
    const stale = [...PENDING_GLYPH].filter((n) => MENU_GLYPH_NAMES.has(n));
    expect(stale).toEqual([]);
  });

  it("서로 다른 메뉴가 같은 그림을 쓰지 않는다", () => {
    const icons = readFileSync(join(SRC, "components", "icons", "aywa-icons.tsx"), "utf8");
    const menuBlock = icons.slice(
      icons.indexOf("export const MENU_ICON"),
      icons.indexOf("} as const satisfies Record<MenuKey"),
    );
    const keyToIcon = new Map<string, string>();
    for (const m of menuBlock.matchAll(/(\w+):\s*"(\w+)"/g)) keyToIcon.set(m[1]!, m[2]!);

    // ⚠️ **같은 곳으로 가는 두 입구**는 예외다 — 그림을 가르면 다른 데로 간다는 거짓 신호가 된다.
    //    (수납관리 ↔ 월별 청구·수납 / 교재 신청 ↔ billing 교재 탭 / 지출 ↔ billing 지출 탭 / 연동 ↔ 설정 연동 면)
    const SAME_DESTINATION = new Set(["wallet", "bookMarked", "receipt", "sync"]);

    /** 판정 단위는 **한 화면에 나란히 서는 목록**이다 — 다른 화면끼리는 같은 그림이어도 헷갈릴 일이 없다. */
    function dupsIn(surface: string, entries: [string, string][]): string[] {
      const byIcon = new Map<string, string[]>();
      for (const [icon, who] of entries) byIcon.set(icon, [...(byIcon.get(icon) ?? []), who]);
      return [...byIcon.entries()]
        .filter(([icon, who]) => who.length > 1 && !SAME_DESTINATION.has(icon))
        .map(([icon, who]) => `${surface} — ${icon}: ${who.join(" / ")}`)
        .sort();
    }

    // ① 메뉴 보드·사이드바 = MENU_ICON + 허브 면 override가 한 화면에 함께 선다.
    const board: [string, string][] = [...keyToIcon].map(([k, v]) => [v, k]);
    const hub = readFileSync(join(SRC, "lib", "menu-hub.ts"), "utf8");
    for (const line of hub.split("\n")) {
      const icon = /icon:\s*"(\w+)"/.exec(line);
      if (!icon) continue;
      const label = [...line.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).find((v) => /[가-힣]/.test(v));
      board.push([icon[1]!, `hub:${label ?? line.trim().slice(0, 24)}`]);
    }

    // ② 강사 '내 메뉴' 드롭다운 — 한 목록 안에서 출결 모드와 출석부가 같은 클립보드였다.
    //    🔴 강사(폰)에겐 사이드바가 없어 이 드롭다운이 유일한 메뉴라 여기서의 중복이 더 아프다.
    //    이 목록은 MENU_ICON을 거치기도 하고 문자열을 직접 적기도 해서 ①만 봐서는 안 잡힌다.
    // 항목 표는 2026-09-22부터 순수 모듈 한 곳(학원 설정 '탭 및 메뉴 구성 → 강사뷰'와 공유) — 그 표를 읽는다.
    const teacher = readFileSync(join(SRC, "lib", "teacher-menu-links.ts"), "utf8");
    const from = teacher.indexOf("TEACHER_MENU_LINKS: readonly TeacherMenuLink[] = [");
    const links = teacher.slice(from, teacher.indexOf("];", from));
    const menu: [string, string][] = [];
    for (const line of links.split("\n")) {
      const icon = /icon:\s*(?:MENU_ICON\.(\w+)|"(\w+)")/.exec(line);
      if (!icon) continue;
      const href = /href:\s*"([^"]+)"/.exec(line);
      menu.push([icon[2] ?? keyToIcon.get(icon[1]!) ?? icon[1]!, href?.[1] ?? line.trim().slice(0, 20)]);
    }
    expect(menu.length, "강사 메뉴 LINKS를 못 읽었다").toBeGreaterThan(5);

    const dup = [...dupsIn("메뉴 보드", board), ...dupsIn("강사 내 메뉴", menu)];
    expect(dup, `같은 그림을 쓰는 서로 다른 메뉴:\n${dup.join("\n")}`).toEqual([]);
  });

  /**
   * 🔴 탭 표면은 MenuGlyph로 그린다 — **선화(EyIcon)로 되돌리지 말 것**(그 이유로 한 번 반려됐다).
   *
   * 🔑 “한 번이라도 나오면 통과”로는 부족하다 — `app-sidebar`엔 MenuGlyph가 둘(업무군 줄·메뉴 항목 줄)이라
   *    메뉴 항목 전부를 EyIcon으로 되돌려도 업무군 한 줄이 남아 초록이 된다(실증으로 확인됨).
   *    그래서 **몇 군데서 그리는지**를 세고, 아이콘 이름을 받는 자리에 EyIcon이 서 있는지도 본다.
   */
  const TAB_SURFACES: [string[], number][] = [
    [["components", "app-sidebar.tsx"], 2], // 업무군 줄 + 메뉴 항목 줄
    [["components", "workspace", "menu-hub-grid.tsx"], 1],
    [["components", "teacher-navigation-items.tsx"], 2], // 폴더 + 내부 메뉴
    // 폰 상단 메뉴 줄도 같은 MENU_ICON을 그린다 — 사이드바가 없는 화면의 탭이라 같은 규약.
    [["components", "mobile-top-nav.tsx"], 2], // 큰 탭 + 내부 메뉴
  ];

  it("🔴 탭 표면은 MenuGlyph를 쓴다 — 선화(EyIcon)로 되돌리지 말 것", () => {
    for (const [rel, count] of TAB_SURFACES) {
      const src = readFileSync(join(SRC, ...rel), "utf8");
      // 🔴 import 한 줄이 아니라 **실제로 그리는 자리 수**를 센다 — 문자열 포함만 보면
      //    본문을 EyIcon으로 되돌려도 남은 한 줄·import가 초록을 만든다.
      const drawn = [...src.matchAll(/<MenuGlyph\b/g)].length;
      expect(drawn, `${rel.join("/")} — MenuGlyph로 그리는 자리 수`).toBe(count);
    }
  });

  it("탭 표면에서 아이콘 이름을 EyIcon에 넘기지 않는다", () => {
    const bad: string[] = [];
    for (const [rel] of TAB_SURFACES) {
      const src = readFileSync(join(SRC, ...rel), "utf8");
      // 화살표·꺾쇠 같은 **고정 이름** EyIcon은 그대로 둔다(`name="arrowRight"`) — 막는 것은
      //    메뉴/업무군의 아이콘 이름을 받아 그리는 자리다(`name={item.icon}`·`name={icon}`).
      for (const m of src.matchAll(/<EyIcon\b[\s\S]*?\/>/g)) {
        if (/name=\{[^}]*\bicon\b/.test(m[0]))
          bad.push(`${rel.join("/")}: ${m[0].replace(/\s+/g, " ").slice(0, 60)}`);
      }
    }
    expect(bad, `탭 표면이 아이콘을 선화로 그린다:\n${bad.join("\n")}`).toEqual([]);
  });
});
