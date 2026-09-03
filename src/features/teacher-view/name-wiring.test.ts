import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHEET_DICT,
  sheetDowLabelByIndex,
  sheetMonthLabel,
  sheetT,
  sheetTf,
} from "./i18n";
import { ROSTER_FIXED_LABEL, ROSTER_TEXT_COLS } from "@/features/class-sheets/lib/roster-form";
import {
  ATTENDANCE_LABEL,
  ATTENDANCE_LABEL_EN,
  attendanceLabelOf,
} from "@/features/class-sheets/lib/attendance-label";
import { REASON_LABEL, REASON_LABEL_EN } from "@/features/withdrawals/types";
import { ATTITUDE } from "@/features/onescreen/attitude";
import { attitudeLabelFor } from "./attitude-label";

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

  it("🔴🔴 태도 사전의 ko는 **저장값과 글자까지 같다** — 저장은 한국어로 남아야 한다", () => {
    // 태도는 라벨 = **DB 저장값**이고 학부모 문장(`attitudeClause`)이 그 한국어를 읽는다.
    // ko가 어긋나면 영어로 고른 값이 저장될 때 옛 기록과 갈리고 학부모 문장이 폴백으로 떨어진다.
    const koLabels = ATTITUDE.map((v) => attitudeLabelFor(v, "ko"));
    expect(koLabels).toEqual([...ATTITUDE]);
    // 영어 쪽은 다섯 눈금이 **서로 다른 낱말**이어야 한다(뭉치면 정도를 못 고른다).
    const enLabels = ATTITUDE.map((v) => attitudeLabelFor(v, "en") ?? "");
    expect(new Set(enLabels).size).toBe(ATTITUDE.length);
    for (const v of enLabels) expect(v).not.toMatch(/[가-힣]/);
    // 🔴 선택지 밖(옛 값·자유입력)은 원문 그대로 — 옮길 표가 없으니 원문이 정답이다.
    expect(attitudeLabelFor("최고 책없음", "en")).toBe("최고 책없음");
  });

  it("🔴 태도 표시 규칙이 학부모 표면으로 새지 않는다", () => {
    // `onescreen`이 이 모듈을 import하면 영어 라벨이 학부모 문장·보고서에 실릴 수 있다.
    const dir = join(process.cwd(), "src", "features", "onescreen");
    const offenders: string[] = [];
    let scanned = 0;
    const walk = (d: string) => {
      for (const e of readdirSync(d)) {
        const p = join(d, e);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(p)) {
          scanned += 1;
          if (/teacher-view\/attitude-label/.test(readFileSync(p, "utf8"))) offenders.push(p);
        }
      }
    };
    walk(dir);
    // 🔴 **훑은 파일이 0개면 이 가드는 아무것도 안 본 것이다** — try/catch로 감싸 두면 경로가 바뀌거나
    //    함수가 없을 때 조용히 초록으로 통과한다(실제로 그랬다: `readdirSync` import 누락).
    expect(scanned).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});

describe("🔴 오늘 면(카드·요약·학생 줄)도 사전을 탄다", () => {
  it("카드: 배지·칩·일괄 출석·빈 명단이 사전 경유", () => {
    const src = read("features", "class-sheets", "components", "today-board.tsx");
    for (const key of [
      "today.badge.plan",
      "today.badge.attendance",
      "today.badge.report",
      "today.badge.notice.posted",
      "today.chip.delegated",
      "today.chip.live",
      "today.bulkPresent.all",
      "today.noStudents",
      "today.saveFailed.attendance",
    ]) {
      expect(src).toContain(key);
    }
    const code = codeOnly(src);
    expect(code).not.toContain(">위임<");
    expect(code).not.toContain(">진행 중<");
    expect(code).not.toMatch(/계획 \{card\.fill/);
  });

  it("요약 스트립: 다섯 칸 라벨이 사전 경유", () => {
    const src = read("features", "class-sheets", "components", "today-summary.tsx");
    for (const key of [
      "today.stat.classes",
      "today.stat.plan",
      "today.stat.attendance",
      "today.stat.report",
      "today.stat.notice",
      // 글씨 크기 라벨·칩은 **주간 시트 툴바와 같은 키**를 쓴다(두 벌이면 같은 칩이
      // 화면마다 다른 영문으로 뜬다 — 실제로 "Text"/"Text size"로 갈렸었다).
      "toolbar.font",
      "FONT_SIZE_KEY",
    ]) {
      expect(src).toContain(key);
    }
    expect(codeOnly(src)).not.toMatch(/label="[가-힣]/);
  });

  it("학생 줄: 이름은 `studentNameParts` · 보고서 상태는 사전", () => {
    const src = read("features", "class-sheets", "components", "today-student-row.tsx");
    expect(src).toContain("studentNameParts");
    expect(src).toContain("today.report.sent");
    // 🔴 표시 이름과 접근성 이름이 **같은 값**을 봐야 한다(하나만 한국어면 음성으로 못 부른다).
    expect(codeOnly(src)).not.toContain("studentName={student.name}");
  });

  it("🔴 오늘 면 학생에 영어 이름이 실려 온다(서버) — 없으면 화면이 영원히 한국어다", () => {
    const src = read("features", "class-sheets", "server", "today.ts");
    expect(src).toContain("englishName: string | null");
    expect(src).toContain("english_name");
    // 같은 값을 넣는 두 조립 지점(정규 수강 · 보강 방문자)에 **둘 다** 실려야 한다.
    expect((src.match(/englishName: meta\?\.english_name \?\? null/g) ?? []).length).toBe(2);
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

/**
 * 🔴 **ko 화면은 한 글자도 안 바뀐다** — 사전으로 옮긴 문구는 원문과 글자까지 같아야 한다.
 * 눈으로는 못 잡으므로(문자열이 화면 파일에서 사라졌다) 옮긴 자리의 한국어 결과를 여기서 고정한다.
 */
describe("🔴 사전으로 옮긴 오늘 면 문구의 ko 결과가 옛 문자열과 같다", () => {
  it("출결 알약 — 라벨·잠긴 칸·사유 창", () => {
    expect(attendanceLabelOf("present", "ko")).toBe("출석");
    expect(attendanceLabelOf("present", "en")).toBe("Present");
    expect(sheetT("ko", "bulk.noPerm")).toBe("출결 입력 권한이 없거나 수정 기간이 지났습니다");
    expect(sheetT("ko", "att.pill.none")).toBe("출결 —");
    expect(sheetTf("ko", "att.pill.setWithNote", { label: "지각" })).toBe(
      "지각로 기록 — 사유 메모를 적을 수 있습니다",
    );
    expect(sheetTf("ko", "att.note.label", { name: "이지호", label: "결석" })).toBe("이지호 · 결석 사유");
  });

  it("셀 충돌 — 주간·오늘 두 화면이 **같은 키**를 쓴다", () => {
    expect(sheetT("ko", "cell.conflict.server")).toBe("다른 강사가 수정:");
    expect(sheetT("ko", "cell.conflict.empty")).toBe("(비움)");
    expect(sheetT("ko", "cell.conflict.useServer")).toBe("서버값 사용");
    for (const f of ["plan-row.tsx", "today-plan-editor.tsx"]) {
      const src = read("features", "class-sheets", "components", f);
      expect(src).toContain("cell.conflict.useServer");
      expect(codeOnly(src)).not.toContain("서버값 사용");
    }
  });

  it("'평시 내용 복사' — 라벨·툴팁·토스트", () => {
    expect(sheetT("ko", "today.copy")).toBe("평시 내용 복사 (지난 수업)");
    expect(sheetTf("ko", "today.copy.done", { source: "", n: 3 })).toBe("3줄 채웠습니다");
    expect(sheetTf("ko", "today.copy.done.source", { label: "8/28" })).toBe("8/28 수업에서 ");
    const src = read("features", "class-sheets", "components", "today-copy-slot.tsx");
    expect(codeOnly(src)).not.toMatch(/[가-힣]/);
  });

  it("계획 편집기 — '수정 중' 문장은 **통째로** 사전에 있다(어미만 남기지 않는다)", () => {
    expect(sheetTf("ko", "plan.editor.presence", { names: "김태건" })).toBe(
      "김태건 님이 이 반을 수정 중입니다",
    );
    const src = read("features", "class-sheets", "components", "today-plan-editor.tsx");
    expect(codeOnly(src)).not.toContain("님이 이 반을 수정 중입니다");
  });

  it("🔴 글씨 크기 칩은 주간 시트와 **한 벌**(FONT_SIZE_KEY)", () => {
    for (const f of ["sheet-toolbar.tsx", "today-summary.tsx"]) {
      expect(read("features", "class-sheets", "components", f)).toContain("FONT_SIZE_KEY");
    }
    // 라벨 상수(한국어)는 원스크린·시간표가 계속 쓰므로 **지우지 않는다** — 시트만 사전을 본다.
    expect(read("features", "class-sheets", "components", "today-summary.tsx")).not.toContain(
      "ECS_FONT_SIZE_LABEL",
    );
  });

  it("🔴 드롭다운은 표시만 바꾼다 — 저장값(ATTITUDE 한국어)은 그대로", () => {
    const src = read("features", "onescreen", "components", "field-select.tsx");
    // 표시 매퍼가 있어도 선택 결과는 옵션의 **원래 값**이어야 한다.
    expect(src).toContain("labelOf?.(v) ?? v");
    expect(src).toContain("onSelect(v || null)");
    const popover = read("features", "class-sheets", "components", "today-mark-popover.tsx");
    expect(popover).toContain("labelOf={(v) => attitudeLabelFor(v, lang) ?? v}");
  });
});

/**
 * 🔴 **월간 뷰(달력·진도표·계획 MP)에 한국어 리터럴이 남지 않는다.**
 *
 * 문구를 하나씩 잠그는 대신 **파일에 한글이 있는지**를 본다 — 이 화면들은 문구가 수십 개라
 * 목록으로 잠그면 새 문구가 늘 때 가드가 조용히 뒤처진다(주석은 규칙을 설명하는 자리라 검사에서 뺀다).
 * ⚠️ 인쇄물(`month-plan-paper`)은 **학부모 서식**이라 이 목록에 넣지 말 것 — 거기는 한국어가 정답이다.
 */
describe("🔴 월간 뷰는 사전만 본다 — 화면 파일에 한글 리터럴 0", () => {
  const FILES = [
    "month-client.tsx",
    "month-calendar.tsx",
    "month-day-editor.tsx",
    "month-rail.tsx",
    "month-goal-strip.tsx",
    "month-memo.tsx",
    "month-plan-bar.tsx",
    "month-plan-view.tsx",
  ];

  it.each(FILES)("%s", (f) => {
    const code = codeOnly(read("features", "class-sheets", "components", f));
    const hits = code.split("\n").filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "month.noClasses")).toBe("이 달에는 수업이 없습니다.");
    expect(sheetTf("ko", "month.weekTitle", { m: 9, w: 2, date: "2026-09-07" })).toBe(
      "9월 2째 주 (2026-09-07 시작)",
    );
    expect(sheetTf("ko", "month.unwrittenN", { n: 3 })).toBe("미작성 3");
    expect(sheetTf("ko", "month.days", { n: 4 })).toBe("4일");
    expect(sheetTf("ko", "month.seat", { seat: "JJ" })).toBe("자리 · JJ");
    // 🔴 휴강(사람이 표시) ≠ 수업 없음(배정이 없는 날) — 영어에서도 갈라져 있어야 한다.
    expect(sheetT("en", "mp.off")).not.toBe(sheetT("en", "mp.noClassDay"));
  });

  it("🔴 요일·월 라벨 표는 한 벌이다 — 화면 파일이 제 표를 만들지 않는다", () => {
    // 0=일 … 6=토(JS `getDay()`)와 같은 축이어야 달력·진도표가 같은 요일을 가리킨다.
    expect(sheetDowLabelByIndex(0, "ko")).toBe("일");
    expect(sheetDowLabelByIndex(4, "ko")).toBe("목");
    expect(sheetDowLabelByIndex(4, "en")).toBe("Thu");
    // 한국어는 **호출부가 만든 값 그대로**(앱 전역 monthLabel이 정본).
    expect(sheetMonthLabel("2026-09", "2026년 9월", "ko")).toBe("2026년 9월");
    expect(sheetMonthLabel("2026-09", "2026년 9월", "en")).toBe("September 2026");
    for (const f of ["month-calendar.tsx", "month-rail.tsx", "month-day-editor.tsx"]) {
      const src = read("features", "class-sheets", "components", f);
      expect(src).not.toContain("DOW_KO");
    }
  });
});
