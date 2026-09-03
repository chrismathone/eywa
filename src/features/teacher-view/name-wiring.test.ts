import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SHEET_DICT } from "./i18n";
import { ROSTER_FIXED_LABEL, ROSTER_TEXT_COLS } from "@/features/class-sheets/lib/roster-form";
import { ATTENDANCE_LABEL, ATTENDANCE_LABEL_EN } from "@/features/class-sheets/lib/attendance-label";
import { REASON_LABEL, REASON_LABEL_EN } from "@/features/withdrawals/types";

const read = (...p: string[]) => readFileSync(join(process.cwd(), "src", ...p), "utf8");

/**
 * 주석을 걷어낸 코드 — 🔴 **금지 패턴을 원문에서 찾으면 그 패턴을 인용한 주석에 걸린다**(실제로 걸렸다:
 * `roster-slot-cells`가 *"화면마다 `lang === "en" ? …`를 적지 말 것"*이라고 적어 둔 줄).
 * 이 프로젝트는 주석에 규약을 길게 적는 관례라 **금지 검사는 반드시 코드만** 봐야 한다.
 */
const codeOnly = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/**
 * 원장 2026-09-03: *"아직 영문으로 전환 안된 멘트들이 너무 많음 전환시킬것"* → *"평시 및 계획이 없습니다
 * 도 한글로 해야지 하드코딩된것들 전부"* · *"선생님 이름도 영어선생님의 경우 영어 이름으로"* ·
 * *"이런 반 이름도 … 스마트하게 영문전환"* · *"출석 결석 같은 출결 상태도"*.
 *
 * 🔴 배선만 보는 가드는 **키가 빈 문자열이어도 통과**한다 — 그래서 사전 쪽 값도 함께 잠근다.
 */
describe("🔴 시트 본문 문구가 사전을 탄다 — 화면 파일에 한글을 다시 박지 않는다", () => {
  it("계획 표: 시기 칩·머리·'계획이 없습니다'가 전부 사전 경유", () => {
    const src = read("features", "class-sheets", "components", "plan-table.tsx");
    for (const key of [
      "plan.term.regular",
      "plan.term.exam",
      "plan.col.kind",
      "plan.col.book",
      "plan.col.pageTime",
      "plan.col.progress",
      "plan.col.homework",
      "plan.empty",
      "plan.addRow",
      "plan.copy",
    ]) {
      expect(src).toContain(key);
    }
    // 🔴 하드코딩이 남아 있지 않은지 — 이 파일에서 그 낱말이 나오면 사전을 우회한 것이다.
    //    (주석에는 인용이 있으므로 **JSX 텍스트/문자열 리터럴 모양**으로만 본다.)
    const code = codeOnly(src);
    expect(code).not.toContain(">계획이 없습니다<");
    expect(code).not.toContain('label: "평시"');
    expect(code).not.toContain(">구분<");
    expect(code).not.toContain(">진도<");
  });

  it("로스터 표 머리: 출결·유닛·태도·특이사항 + 폼별 자유 입력이 사전 경유(두 표 모두)", () => {
    for (const f of ["roster-table.tsx", "today-roster-table.tsx"]) {
      const src = read("features", "class-sheets", "components", f);
      for (const key of [
        "roster.col.attendance",
        "roster.col.unit",
        "roster.col.attitude",
        "roster.col.note",
      ]) {
        expect(src, f).toContain(key);
      }
      // 자유 입력 열은 폼이 정한 **짝 키**(labelKey/titleKey)를 그대로 쓴다 — 문자열 조립 금지.
      expect(src, f).toContain("t(col.labelKey)");
      expect(src, f).toContain("t(col.titleKey)");
      const code = codeOnly(src);
      expect(code, f).not.toContain("${col.labelKey}.title");
      expect(code, f).not.toContain(">출결<");
      expect(code, f).not.toContain(">태도<");
    }
  });

  it("🔴 자유 입력 열마다 라벨·툴팁 사전 키가 **짝으로** 있고 사전에 실재한다", () => {
    for (const cols of Object.values(ROSTER_TEXT_COLS)) {
      for (const col of cols) {
        expect(SHEET_DICT[col.labelKey].ko).toBe(col.label);
        expect(SHEET_DICT[col.labelKey].en.trim()).not.toBe("");
        expect(SHEET_DICT[col.titleKey].ko).toBe(col.title);
        expect(SHEET_DICT[col.titleKey].en.trim()).not.toBe("");
        // 🔴 열 폭은 한글 머리 기준이라 영어 라벨이 그보다 길면 머리가 두 줄이 되고 `grid-rows-subgrid`
        //    줄맞춤이 깨진다(roster-form ⚠️). 11px bold ≈ 글자당 6px로 보수적으로 잡는다.
        expect(SHEET_DICT[col.labelKey].en.length * 6).toBeLessThan(col.width);
      }
    }
  });

  it("🔴 한국어에서는 자리(JJ) 출석부와 **글자가 같다** — 사전이 갈라 놓는 건 영어뿐", () => {
    // 자리 출석부는 비로그인 PIN으로도 열리는 한국어 표면이라 상수(`ROSTER_FIXED_LABEL`)를 계속 읽는다.
    // 두 표면이 한국어에서 다른 낱말을 쓰면 "한 화면에서 배운 이름이 다른 화면에서 안 통한다".
    expect(SHEET_DICT["roster.col.attitude"].ko).toBe(ROSTER_FIXED_LABEL.attitude);
    expect(SHEET_DICT["roster.col.note"].ko).toBe(ROSTER_FIXED_LABEL.progressNote);
  });

  it("🔴 출결 상태는 한·영 표가 **같은 키 집합**이다 — 빠진 키는 raw enum이 화면에 샌다", () => {
    expect(Object.keys(ATTENDANCE_LABEL_EN).sort()).toEqual(Object.keys(ATTENDANCE_LABEL).sort());
    for (const v of Object.values(ATTENDANCE_LABEL_EN)) expect(v).not.toMatch(/[가-힣]/);
  });

  it("🔴 퇴원 사유도 한·영 표가 같은 키 집합이다", () => {
    expect(Object.keys(REASON_LABEL_EN).sort()).toEqual(Object.keys(REASON_LABEL).sort());
    for (const v of Object.values(REASON_LABEL_EN)) expect(v).not.toMatch(/[가-힣]/);
  });
});

describe("🔴 이름 표기는 단일 소스를 지난다 — 화면마다 삼항을 적지 않는다", () => {
  const SURFACES: Array<[string, string[], string]> = [
    ["반 이름 · 주간/오늘 시트 머리", ["features", "class-sheets", "components", "sheet-client.tsx"], "classNameFor"],
    ["반 이름 · 오늘 보드 카드", ["features", "class-sheets", "components", "today-board.tsx"], "classNameFor"],
    ["반 이름 · 상단 바(ECS·MCS 공용)", ["features", "class-sheets", "components", "sheet-chrome.tsx"], "classNameFor"],
    ["반 이름 · ECS 랜딩 카드", ["app", "(shell)", "ecs", "_components", "landing-list.tsx"], "classNameFor"],
    ["강사 이름 · 교시 카드 머리", ["features", "class-sheets", "components", "period-block.tsx"], "teacherNameFor"],
    ["학생 이름 · 로스터 이름 칸", ["features", "class-sheets", "components", "roster-slot-cells.tsx"], "studentNameParts"],
  ];

  it.each(SURFACES)("%s → %s", (_label, path, fn) => {
    const src = read(...path);
    expect(src).toContain(fn);
    // 🔴 화면 파일이 스스로 언어를 갈라 이름을 만들면(삼항) 한쪽만 고쳐진다.
    expect(codeOnly(src)).not.toMatch(/lang === "en" \?/);
  });

  it("🔴 ECS 랜딩은 언어를 **prop으로 받는다** — 페이지가 실제로 넘기는지까지", () => {
    // 🔴 이 컴포넌트를 async로 만들어 언어를 직접 읽으면 RTL이 못 렌더해 단위 테스트 17개가 통째로
    //    죽는다(실측 2026-09-03). 기본값이 `ko`라 안 넘겨도 화면은 살지만 **영문 전환이 조용히 빠지므로**
    //    페이지가 넘기는지를 여기서 잠근다.
    const list = read("app", "(shell)", "ecs", "_components", "landing-list.tsx");
    expect(codeOnly(list)).not.toContain("getTeacherViewLang");
    expect(list).toContain("lang?: SheetLang");
    const page = read("app", "(shell)", "ecs", "page.tsx");
    expect(page).toMatch(/<EcsLandingList[^>]*lang=\{lang\}/);
  });

  it("🔴 강사 이름 표는 provider 한 곳에서만 흘린다(셸 레이아웃)", () => {
    const layout = read("app", "(shell)", "layout.tsx");
    expect(layout).toContain("TeacherNamesProvider");
    expect(layout).toContain("getTeacherEnglishNames");
    // 창(embed)·미니셸 **둘 다** — 한쪽만 감싸면 창 안에서만 한국어 이름이 남는다.
    expect((layout.match(/<TeacherNamesProvider/g) ?? []).length).toBe(2);
  });

  it("🔴 영어 화면이 아니면 강사 이름 표를 조회하지 않는다(왕복 0)", () => {
    const src = read("features", "teacher-view", "server", "teacher-names.ts");
    expect(src).toMatch(/lang !== "en"/);
    // 표(whitelist)로 쓰는 조회라 무페이징 select 금지(B2).
    expect(src).toContain("fetchAllPaged");
    // RLS 우회(admin)라 테넌트 필터 필수.
    expect(src).toContain('.eq("tenant_id", user.tenantId)');
  });
});
