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
import {
  SEAT_MARK_LABEL,
  SEAT_MARK_LABEL_EN,
} from "@/features/attendance/live/mark-state";
import { ABSENCE_REASON_PRESETS, LATE_REASON_PRESETS } from "@/features/attendance/quick/reason-presets";
import { absenceReasonLabelFor, lateReasonLabelFor } from "./reason-label";
import {
  ATTENDANCE_SORT_KEYS,
  ATTENDANCE_SORT_LABEL,
  ATTENDANCE_SORT_LABEL_EN,
} from "@/features/attendance/sort-rows";
import { STATUS_TEXT, STATUS_TEXT_EN } from "@/features/attendance/cell-display";
import { BADGE_LABEL, BADGE_LABEL_EN } from "@/features/attendance/enrollment-span";
import {
  STUDENT_STATUS_LABEL,
  STUDENT_STATUS_LABEL_EN,
  studentStatusLabel,
} from "@/features/students/status/status-labels";
import {
  EMPLOYMENT_TYPE_EN,
  EMPLOYMENT_TYPES,
  RESUME_CHECKS,
  RESUME_COMPANIES,
  RESUME_DEPARTMENTS,
  WORKDAYS,
} from "@/features/staff/resume/resume";
import { CLASS_GROUP_NONE, CLASS_GROUP_OTHER, CLASS_TAG_ALL } from "@/features/onescreen/class-tags";
import {
  attendanceMarkLabel,
  MARK_ABSENT,
  MARK_EARLY_LEAVE,
  MARK_LATE,
  MARK_PRESENT,
} from "@/features/onescreen/attendance-mark";
import { classnoteBadge } from "@/features/onescreen/classnote-badge";
import {
  ONESCREEN_FONT_SIZES,
  onescreenFontSizeLabel,
} from "@/features/onescreen/font-size";
import { bulkPickLabel } from "@/features/onescreen/bulk-label";
import { evaluateSendGate } from "@/features/onescreen/send-gate";
import { MENT_WARNING_HINT, MENT_WARNING_LABEL } from "@/features/onescreen/ment-consistency";
import { makeupBadgeLabel, makeupTitleSuffix } from "@/features/onescreen/makeup-label";
import { NOT_SUBMITTED } from "@/features/onescreen/homework-rate";
import { NONE_LABEL } from "@/features/onescreen/none-marker";
import { makeupRemoveBlockReason } from "@/features/onescreen/makeup-remove-plan";
import { recallBlockReason } from "@/features/report-admin/report-recall";
import { makeupRowName, MAKEUP_ONLY_SUFFIX } from "@/features/onescreen/makeup-label";
import { formatDays, formatMinutes } from "@/features/classes/schedule-summary";
import { delegationRangeLabel, validateDelegationRange } from "@/features/classes/delegation-window";
import { scheduledChangeLabel } from "@/features/enrollments/scheduled-changes";
import { readAtLabel } from "@/features/onescreen/components/report-card";
import {
  REPORT_OPTOUT_NOTICE,
  REPORT_OPTOUT_SHORT,
  reportOptoutNotice,
  reportOptoutShort,
} from "@/features/classes/report-optout";
import {
  describeAttendanceSkips,
  planBulkAttendance,
} from "@/features/onescreen/bulk-attendance";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "../onescreen/components/onescreen-screen-source.test-util";

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

  it("🔴 월별 출석부 왼쪽 값 열 머리는 열 폭 안에 든다(한·영 모두)", () => {
    // `th`엔 말줄임이 없어 넘친 글자는 옆 칸 머리에 덮여 **잘린 채** 보인다(적대 리뷰 2026-09-17).
    // 폭은 화면이 정하므로 상수를 **거기서 읽는다**(둘이 갈리면 가드가 거짓으로 통과한다).
    const table = readFileSync(
      join(process.cwd(), "src", "app", "(shell)", "attendance", "_components", "matrix-table.tsx"),
      "utf8",
    );
    // 🔴 파일 전체가 아니라 **`COL_W` 한 줄**에서 읽는다 — 다른 곳의 `units: 2` 같은 값이 섞이면 가드가 거짓으로 통과한다.
    const colW = table.match(/const COL_W = \{([^}]+)\}/)![1]!;
    const widths = Object.fromEntries(
      [...colW.matchAll(/(\w+): (\d+)/g)].map((m) => [m[1]!, Number(m[2])]),
    );
    /**
     * 글자당 폭 — 헤드리스 Chrome 실측(Pretendard · 14px · letter-spacing 0.02em = `.micro`)에
     * 2026-09-18 **굵게** 전환분 약 4%를 얹었다. 한글 12.38 → 12.9 · 라틴 7.66 → 8.0.
     * 🔴 공백·가운뎃점을 한글 폭으로 세지 말 것 — `학교·학년`(57.6px)이 64.5px로 부풀어, 들어가는 라벨을
     *    가드가 막는다(그러면 폭을 도로 넓히게 된다).
     */
    const textWidth = (t: string) =>
      [...t].reduce((w, ch) => w + (ch === " " ? 4 : ch === "·" ? 6 : /[가-힣]/.test(ch) ? 12.9 : 8), 0);
    for (const [key, col, pad] of [
      // 학교·학년만 `px-1.5`(12px), 나머지는 `px-1`(8px).
      ["att.col.schoolGrade", "school", 12],
      ["att.col.classBilled", "classBilled", 8],
      ["att.col.lessonCount", "units", 8],
      ["att.col.termSessions", "termSessions", 8],
      ["att.col.sessionDiff", "diff", 8],
    ] as const) {
      const room = widths[col]! - pad;
      expect(room, col).toBeGreaterThan(0);
      expect(textWidth(SHEET_DICT[key].ko), `${key} ko`).toBeLessThanOrEqual(room);
      expect(textWidth(SHEET_DICT[key].en), `${key} en`).toBeLessThanOrEqual(room);
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
    expect(codeOnly(src).match(/studentName=\{names.primary\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("🔴 오늘 면 학생에 영어 이름이 실려 온다(서버) — 없으면 화면이 영원히 한국어다", () => {
    const src = read("features", "class-sheets", "server", "today.ts");
    expect(src).toContain("englishName: string | null");
    expect(src).toContain("english_name");
    // 같은 값을 넣는 세 조립 지점(정규 수강 · 보강 방문자 · 수업 나누기로 들어온 학생)에 **전부** 실려야 한다.
    expect((src.match(/englishName: meta\?\.english_name \?\? null/g) ?? []).length).toBe(3);
  });

  it("출결·태도 빈 칸 '선택'은 사전(select.choose) — 영어 화면에 한글이 안 남는다", () => {
    expect(sheetT("ko", "select.choose")).toBe("선택");
    expect(sheetT("en", "select.choose")).toBe("Choose");
    const att = codeOnly(read("features", "class-sheets", "components", "attendance-check.tsx"));
    expect(att).toContain('t("select.choose")');
    expect(att).toContain("att.cycle.tipClick");
    expect(att).toContain("att.makeup.removeConfirm");
    expect(att).not.toContain("선택 안 함");
    expect(att).not.toContain("출결 없음");
    expect(codeOnly(read("features", "class-sheets", "components", "attitude-check.tsx"))).toContain(
      'sheetT(lang, "select.choose")',
    );
  });

  it("오늘·주간 카드의 샤우팅은 사전 · 시간변경 배지는 없다", () => {
    const period = read("features", "class-sheets", "components", "period-block.tsx");
    expect(period).toContain("landing.col.shouting");
    // 🔴 '시간 변경됨' 배지는 2026-09-23에 없앴다(원장 *"앞으로 안뜨게하면 되고 이전 데이터들은 무시해"*) — 되살리지 말 것.
    expect(codeOnly(period)).not.toContain("slot.orphan");
    expect(codeOnly(period)).not.toContain(">Shouting<");
    expect(codeOnly(period)).not.toContain(">시간 변경됨<");
    const editor = read("features", "class-sheets", "components", "today-plan-editor.tsx");
    expect(editor).toContain("plan.editor.noLines");
    expect(codeOnly(editor)).not.toContain(">Shouting<");
    const list = read("app", "(shell)", "ecs", "_components", "landing-list.tsx");
    expect(list).toContain("landing.rename.note");
    expect(codeOnly(list)).not.toContain("부터");
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
    // 기간 축 `월 | 세션`(2026-09-21) — EiE 반을 맡은 원어민 강사도 본다.
    "month-period-switch.tsx",
    // 교재 배정 창(0266a·0268a) — 월간 툴바에서 열리고, 담당 슬롯이 있는 **원어민 강사도 연다**.
    "textbook-fill-dialog.tsx",
    // 교재 배정 창 맨 위의 '이 반의 배정' 목록(감사 F4) — 같은 창 안이라 같은 규약.
    "textbook-fill-existing.tsx",
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

/**
 * 🔴 **출결 모드(/attendance/quick)에 한국어 리터럴이 남지 않는다.**
 *
 * 원장 2026-09-04: *"강사가 접근 가능한 모든 메뉴를 전환시켜줘"*. 이 화면은 강사가 수업 직후 복도에서
 * 여는 주 진입로('내 메뉴' 맨 위)라 한 줄이라도 한국어가 남으면 바로 눈에 띈다.
 *
 * 🔴🔴 **저장값은 여전히 한국어다** — 사유 프리셋 문자열이 곧 `attendance_records.note`이고
 *    `classifyAbsenceReason`이 그 한국어를 읽는다(영어로 저장하면 사유를 골랐는데도 '연락 안 됨
 *    긴급'이 뜬다). 그래서 아래 두 검사는 **표시 라벨만** 바뀌었는지를 함께 잠근다.
 */
describe("🔴 출결 모드는 사전만 본다 — 화면 파일에 한글 리터럴 0", () => {
  const FILES = [
    "quick-board.tsx",
    "quick-class-card.tsx",
    "quick-mark-sheet.tsx",
    "quick-reason-panels.tsx",
  ];

  it.each(FILES)("%s", (f) => {
    const code = codeOnly(
      read("features", "attendance", "quick", "components", f),
    );
    const hits = code
      // ⚠️ `\n`으로만 자르면 CRLF 파일에서 줄 끝에 `\r`이 남고, JS의 `.`는 `\r`을 안 먹어
      //    아래 줄-끝 주석 제거가 **조용히 아무 일도 안 한다**(실제로 걸렸다).
      .split(/\r?\n/)
      // 줄 끝 주석(`// …`)은 규약을 적는 자리라 검사에서 뺀다(파일 머리 주석과 같은 이유).
      .map((l) => l.replace(/\/\/.*$/, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("라우트(page.tsx)도 사전 경유 — 머리·휴원일 안내가 하드코딩이 아니다", () => {
    const src = read("app", "(shell)", "attendance", "quick", "page.tsx");
    for (const key of [
      "quick.title",
      "quick.eyebrow",
      "quick.header.desc",
      "quick.embed",
      "quick.holiday.title",
      "quick.holiday.desc",
    ]) {
      expect(src).toContain(key);
    }
    const code = codeOnly(src).replace(/\/\/[^\n\r]*/g, "");
    expect(code.split(/\r?\n/).filter((l) => /[가-힣]/.test(l))).toEqual([]);
  });

  it("🔴 표시 상태 5색은 한·영 표가 같은 키 집합이다 — 빠진 키는 raw enum이 샌다", () => {
    expect(Object.keys(SEAT_MARK_LABEL_EN).sort()).toEqual(Object.keys(SEAT_MARK_LABEL).sort());
    for (const v of Object.values(SEAT_MARK_LABEL_EN)) expect(v).not.toMatch(/[가-힣]/);
  });

  it("🔴🔴 사유 프리셋의 **저장값**은 한국어 그대로 — 표시만 영어다", () => {
    // ko를 부르면 저장값과 글자까지 같아야 한다(칩을 눌러 저장되는 값이 그것이다).
    for (const v of ABSENCE_REASON_PRESETS) expect(absenceReasonLabelFor(v, "ko")).toBe(v);
    for (const v of LATE_REASON_PRESETS) expect(lateReasonLabelFor(v, "ko")).toBe(v);
    // en은 전건이 영어여야 한다(하나라도 한글이면 그 칩만 한국어로 남는다).
    for (const v of ABSENCE_REASON_PRESETS) {
      expect(absenceReasonLabelFor(v, "en")).not.toMatch(/[가-힣]/);
    }
    for (const v of LATE_REASON_PRESETS) {
      expect(lateReasonLabelFor(v, "en")).not.toMatch(/[가-힣]/);
    }
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "quick.title")).toBe("출결 모드");
    expect(sheetT("ko", "quick.saveFailed")).toBe("저장하지 못했습니다 — 다시 눌러 주세요");
    expect(sheetTf("ko", "quick.blocked", { n: 3 })).toBe("3명은 이미 입력되어 있어 건너뛰었습니다");
    expect(
      `${sheetT("ko", "quick.sum.pre")}3${sheetT("ko", "quick.sum.mid")}8/9`,
    ).toBe("미출결 3명 · 입력 8/9");
    expect(sheetTf("ko", "quick.late.arrivalAt", { time: "17:05" })).toBe("17:05 등원");
  });
});

/**
 * 🔴 **월별 출석부(/attendance)에 한국어 리터럴이 남지 않는다.**
 *
 * 강사가 지난 날짜를 고치러 오는 화면이고 툴바·격자·팝오버·합계까지 문구가 100개가 넘어서,
 * 목록으로 잠그면 새 문구가 늘 때 가드가 조용히 뒤처진다 — **파일에 한글이 있는지**를 본다.
 *
 * ⚠️ **결석 통보 접수 다이얼로그(`absence-intake-*`)는 이 목록에 없다** — `canManageTenant`(사무실
 *    full)만 여는 화면이라 강사에겐 버튼 자체가 안 보인다. 사무실에 열 때 함께 옮긴다.
 * ⚠️ 서버가 만드는 거절 사유(서버 액션 반환 문자열)도 아직 한국어다 — 옮길 표가 없고, 지어낸
 *    번역이 학생 기록에 대한 거절 사유를 뒤집으면 안 된다.
 */
describe("🔴 월별 출석부는 사전만 본다 — 화면 파일에 한글 리터럴 0", () => {
  const FILES = [
    "attendance-hub.tsx",
    "matrix-table.tsx",
    "matrix-row.tsx",
    "attendance-cell.tsx",
    "cell-popover.tsx",
    "ghost-popover.tsx",
    "totals-row.tsx",
    "live-totals.tsx",
    "hub-student-search.tsx",
    "hide-retired-toggle.tsx",
    "sort-select.tsx",
    "period-mode-toggle.tsx",
    "payslip-window-button.tsx",
    "class-group.tsx",
    "grid-context.tsx",
    "search-context.tsx",
  ];

  it.each(FILES)("%s", (f) => {
    const code = codeOnly(read("app", "(shell)", "attendance", "_components", f));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("라우트(page.tsx)도 사전 경유 — 툴바·안내·빈 화면이 하드코딩이 아니다", () => {
    const src = read("app", "(shell)", "attendance", "page.tsx");
    for (const key of [
      "att.title",
      "att.role.former",
      "att.filter.subject",
      "att.filter.teacher",
      "att.filter.class",
      "att.nav.prev",
      "att.notice.lock.a",
      "att.notice.scope.b",
      "att.notice.derived.d",
      "att.empty.desc",
    ]) {
      expect(src).toContain(key);
    }
    // 🔴 남는 한글은 **한국어 정본 월 표기 한 줄뿐**이다(`formatMonth`의 ko 인자).
    const code = codeOnly(src).replace(/\/\/[^\n\r]*/g, "");
    const hits = code.split(/\r?\n/).filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([`  return sheetMonthLabel(month, \`\${y}년 \${Number(m)}월\`, lang);`]);
  });

  it("🔴 정렬·출결 표기·뱃지는 한·영 표가 같은 키 집합이다", () => {
    expect(Object.keys(ATTENDANCE_SORT_LABEL_EN).sort()).toEqual(
      Object.keys(ATTENDANCE_SORT_LABEL).sort(),
    );
    expect(ATTENDANCE_SORT_KEYS.every((k) => !!ATTENDANCE_SORT_LABEL_EN[k])).toBe(true);
    expect(Object.keys(STATUS_TEXT_EN).sort()).toEqual(Object.keys(STATUS_TEXT).sort());
    expect(Object.keys(BADGE_LABEL_EN).sort()).toEqual(Object.keys(BADGE_LABEL).sort());
    for (const v of [...Object.values(STATUS_TEXT_EN), ...Object.values(BADGE_LABEL_EN)]) {
      expect(v).not.toMatch(/[가-힣]/);
    }
  });

  it("🔴🔴 공결은 여기서도 '결석'으로 접힌다 — ECS 표와 일부러 다르다", () => {
    // 이 표는 시수 0을 말하는 표기라 한국어가 이미 그렇게 접고 있다(cell-display.ts 주석).
    expect(STATUS_TEXT.excused).toBe(STATUS_TEXT.absent);
    expect(STATUS_TEXT_EN.excused).toBe(STATUS_TEXT_EN.absent);
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "att.title")).toBe("출석부");
    expect(sheetT("ko", "att.filter.classAll")).toBe("전체 반");
    expect(sheetTf("ko", "att.nClasses", { n: 7 })).toBe("7개 반");
    expect(sheetTf("ko", "att.notices", { n: 2 })).toBe("안내 2");
    expect(
      `${sheetT("ko", "att.notice.scope.a")}X${sheetT("ko", "att.notice.scope.e")}`,
    ).toBe("칸 숫자는 X에서 봅니다.");
  });
});

/**
 * 🔴 **학생목록(/students) 머리·툴바에 한국어 리터럴이 남지 않는다.**
 *
 * ⚠️ 이 목록엔 **쓰기 화면이 없다**(학생 등록·수정 폼·엑셀 가져오기·상태 변경) — 강사는 학생 기록이
 *    **열람 전용**이라 그 버튼 자체가 안 보인다(상위 결정 2026-08-18). 사무실에 열 때 함께 옮긴다.
 */
describe("🔴 학생목록은 사전만 본다 — 화면 파일에 한글 리터럴 0", () => {
  // ⚠️ 옛 `student-filter-bar.tsx`는 디자인 v5에서 사라졌다(필터가 표의 **열 머리**로 들어갔다) —
  //    남은 조각(더보기 메뉴)과 라우트가 이 규칙의 대상이다.
  it.each(["students-more-menu.tsx"])("%s", (f) => {
    const code = codeOnly(read("app", "(shell)", "students", "_components", f));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/.*$/, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("라우트(page.tsx)도 사전 경유 — 머리·열 제목·빈 화면이 하드코딩이 아니다", () => {
    const src = read("app", "(shell)", "students", "page.tsx");
    // ⚠️ 빈 화면의 **설명 문장**은 v5 §4에서 지웠다(제목만 남긴다) — 없는 문구를 요구하지 않는다.
    for (const key of ["stu.title", "stu.desc", "stu.col.student", "stu.empty.title"]) {
      expect(src).toContain(key);
    }
    const code = codeOnly(src).replace(/\/\/[^\n\r]*/g, "");
    expect(code.split(/\r?\n/).filter((l) => /[가-힣]/.test(l))).toEqual([]);
  });

  it("엑셀 내보내기·가져오기 문구는 엑셀 버튼 조각이 사전에서 가져온다(2026-09-29 공용 ExcelMenu · 검색 줄)", () => {
    const src = read("app", "(shell)", "students", "_components", "students-more-menu.tsx");
    for (const key of ["stu.excel", "stu.excelImport"]) expect(src).toContain(key);
  });

  it("🔴 학생 상태는 한·영 표가 같은 키 집합이다 — 빠진 키는 raw enum이 샌다", () => {
    expect(Object.keys(STUDENT_STATUS_LABEL_EN).sort()).toEqual(
      Object.keys(STUDENT_STATUS_LABEL).sort(),
    );
    for (const v of Object.values(STUDENT_STATUS_LABEL_EN)) expect(v).not.toMatch(/[가-힣]/);
    // 인자를 안 주면 한국어 — 기존 호출부(사무실 화면)는 한 글자도 안 바뀐다.
    expect(studentStatusLabel("enrolled")).toBe("재원");
    expect(studentStatusLabel("enrolled", "en")).toBe("Enrolled");
    // 모르는 코드는 raw 반환(표시 전 매핑 추가가 정석) — 두 언어 모두.
    expect(studentStatusLabel("weird", "en")).toBe("weird");
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    // ⚠️ 2026-09-09에 **이름만** 바뀌었다(원장 *"메뉴와 관련된 모든 학생을 원생으로"*) — 이 핀은
    //    en 전환 때 한국어가 조용히 바뀌는 것을 막는 자물쇠라, 의도적 개명이면 여기 값을 함께 고친다.
    expect(sheetT("ko", "stu.title")).toBe("원생목록");
    expect(sheetTf("ko", "stu.desc", { n: 3, basis: sheetT("ko", "stu.basis.mine") })).toBe(
      "재원 3명 · 담당 과목 기준",
    );
    expect(`${sheetT("ko", "stu.count.pre")}12${sheetT("ko", "stu.count.post")}`).toBe("결과 12명");
  });
});

describe("🔴 이력서 종이 서식 — 화면만 언어를 타고 인쇄물은 언제나 한국어", () => {
  const sheet = () => read("app", "(shell)", "staff", "resumes", "_components", "resume-sheet.tsx");

  it.each(["resume-sheet.tsx", "resume-buttons.tsx"])("%s — 한글 리터럴 0", (f) => {
    const code = codeOnly(read("app", "(shell)", "staff", "resumes", "_components", f));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 인쇄물은 한국어다 — 두 낱말을 함께 싣고 CSS로 가른다", () => {
    const code = codeOnly(sheet());
    // 영어 조각은 인쇄에서 빠지고 한국어 조각이 인쇄에서만 나타난다.
    // 한쪽을 지우면 학원이 보관하는 인사 서류가 영어로 인쇄된다.
    expect(code).toContain('<span className="print:hidden">{en}</span>');
    expect(code).toContain('<span className="hidden print:inline">{ko}</span>');
  });

  it("🔴 인쇄되는 칸 이름은 전부 <P>를 지난다 — t()로 적으면 인쇄물이 영어가 된다", () => {
    const code = codeOnly(sheet());
    const heads = code.split(/\r?\n/).filter((l) => l.includes("<th className="));
    expect(heads.length).toBeGreaterThanOrEqual(30);
    // 🔴 예외는 **두 언어에서 글자가 같은 칸**뿐이고 명단으로만 늘린다 — "한글이 없으면 통과"로
    //    두면 영어만 적은 칸이 조용히 통과해 그대로 인쇄된다.
    const NEUTRAL = ["<th className={head}>E-mail</th>"];
    const missing = heads.filter(
      (l) => !l.includes("<P k=") && !NEUTRAL.some((n) => l.trim() === n),
    );
    expect(missing).toEqual([]);
    expect(code.match(/<SectionHead><P k="res\.sec\./g)?.length).toBe(6);
  });

  it("🔴 저장값(근무요일·근무형태·서류)은 한 글자도 안 바뀐다 — 영어는 표시 전용", () => {
    expect(WORKDAYS.map((d) => d.key)).toEqual(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
    expect(WORKDAYS.map((d) => d.label)).toEqual(["월", "화", "수", "목", "금", "토", "일"]);
    // '혼합'(근로 + 용역)은 2026-10-16 원장 결정으로 더한 값 — 기존 세 값은 그대로다.
    expect(EMPLOYMENT_TYPES).toEqual(["정규직", "아르바이트", "프리랜서", "혼합"]);
    expect(RESUME_CHECKS.map((c) => c.key)).toEqual([
      "sexCrime",
      "childAbuse",
      "eduOffice",
      "etcDocs",
    ]);
  });

  it("🔴 한·영 표가 같은 키 집합이다 — 빠진 값은 한글로 새거나 raw로 샌다", () => {
    for (const d of WORKDAYS) expect(d.en).not.toMatch(/[가-힣]/);
    for (const c of RESUME_CHECKS) expect(c.en).not.toMatch(/[가-힣]/);
    expect(Object.keys(EMPLOYMENT_TYPE_EN).sort()).toEqual([...EMPLOYMENT_TYPES].sort());
    for (const v of Object.values(EMPLOYMENT_TYPE_EN)) expect(v).not.toMatch(/[가-힣]/);
  });

  it("🔴 회사 구분·근무부서·직급은 언어를 안 탄다 — 조직·직급 이름은 한국어가 정본", () => {
    // 뷰 모드에서 이 셋은 저장값을 그대로 그린다(V(...)) — 영어 표를 만들면 편집 화면과 갈린다.
    expect(RESUME_COMPANIES.some((v) => /[가-힣]/.test(v))).toBe(true);
    expect(RESUME_DEPARTMENTS).toContain("영어과");
    const code = codeOnly(sheet());
    for (const v of ["V(c.company)", "V(c.division)", "V(c.jobTitle)"]) expect(code).toContain(v);
    expect(code).not.toContain("RESUME_DEPARTMENT_EN");
    expect(code).not.toContain("RESUME_COMPANY_EN");
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "res.title.resume")).toBe("이력서");
    expect(sheetT("ko", "res.title.roster")).toBe("직원 명부");
    expect(sheetT("ko", "res.sec.personal")).toBe("1. 인적사항");
    expect(sheetT("ko", "res.f.rrn")).toBe("주민등록번호");
    expect(sheetT("ko", "res.hint.view")).toBe("종이 서식 그대로 — 인쇄하거나 수정할 수 있습니다.");
    expect(sheetTf("ko", "res.opt.existing", { v: "국어과" })).toBe("국어과 (기존)");
    expect(sheetTf("ko", "res.del.askNamed", { name: "박소선" })).toBe("박소선 이력서 삭제?");
  });
});

describe("🔴 원스크린 상단 바·격자·출결 알약·발송 현황은 사전만 본다 — 한글 리터럴 0", () => {
  it.each([
    "top-bar.tsx",
    "grid-toolbar.tsx",
    "onescreen-grid.tsx",
    "student-list.tsx",
    "attendance-pills.tsx",
    "status-board.tsx",
  ])("%s", (f) => {
    const code = codeOnly(read("features", "onescreen", "components", f));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 반 필터 '전체'는 라벨이 아니라 값이다 — 한 곳에서만 정의한다", () => {
    expect(CLASS_TAG_ALL).toBe("전체");
    // 서버가 목록을 만들고 클라가 판정하는 두 곳이 같은 상수를 읽는지(문자열을 다시 적으면 조용히 갈린다).
    for (const f of [
      read("features", "onescreen", "server", "roster.ts"),
      read("features", "onescreen", "components", "onescreen-client.tsx"),
      read("features", "onescreen", "components", "top-bar.tsx"),
    ]) {
      expect(f).toContain("CLASS_TAG_ALL");
    }
    expect(CLASS_GROUP_OTHER).toBe("기타");
    expect(CLASS_GROUP_NONE).toBe("반 미배정");
  });

  it("🔴 출결 배지 값은 비교용이라 안 바뀐다 — 글자만 언어를 탄다", () => {
    expect([MARK_PRESENT, MARK_LATE, MARK_EARLY_LEAVE, MARK_ABSENT]).toEqual(["출석", "지각", "조퇴", "결석"]);
    expect(attendanceMarkLabel(MARK_PRESENT)).toBe("출석");
    expect(attendanceMarkLabel(MARK_LATE, "en")).toBe("Late");
    expect(attendanceMarkLabel(MARK_EARLY_LEAVE)).toBe("조퇴");
    expect(attendanceMarkLabel(MARK_EARLY_LEAVE, "en")).toBe("Left early");
    expect(attendanceMarkLabel(MARK_ABSENT, "en")).toBe("Absent");
  });

  it("🔴 출결 알약이 라벨 사본을 다시 들지 않는다 — 앱 전역 단일 소스만 본다", () => {
    const code = read("features", "onescreen", "components", "attendance-pills.tsx");
    expect(code).toContain("attendanceLabelOf");
    expect(code).not.toMatch(/const LABEL: Record<string, string>/);
  });

  it("🔴 ClassNote 배지는 상태마다 두 언어를 함께 적는다 — 한쪽만 적으면 그 상태가 화면에서 사라진다", () => {
    const STATUSES = [
      "queued",
      "processing",
      "success",
      "failed",
      "too_old",
      "revoked",
      "recall_requested",
      "recalled",
      "recall_failed",
      "name_conflict",
      "blocked_shared",
      "subject_off",
      "absent",
      "report_optout",
      "no_attendance",
    ];
    for (const st of STATUSES) {
      const ko = classnoteBadge(st);
      const en = classnoteBadge(st, "en");
      expect(ko, st).not.toBeNull();
      expect(en, st).not.toBeNull();
      expect(en!.label, st).not.toMatch(/[가-힣]/);
      expect(en!.short, st).not.toMatch(/[가-힣]/);
      // 색은 언어를 안 탄다(의미색 캐논).
      expect(en!.cls, st).toBe(ko!.cls);
    }
    // 인자를 안 주면 한국어 — 사무실 발송 콘솔은 한 글자도 안 바뀐다.
    expect(classnoteBadge("success")?.label).toBe("ClassNote 발송 완료");
    expect(classnoteBadge("nope")).toBeNull();
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(bulkPickLabel(37, 37)).toBe("선택 37");
    expect(bulkPickLabel(37, 12)).toBe("선택 37 중 12");
    expect(bulkPickLabel(37, 12, "en")).toBe("12 of 37 selected");
    for (const size of ONESCREEN_FONT_SIZES) {
      expect(onescreenFontSizeLabel(size)).toMatch(/[가-힣]/);
      expect(onescreenFontSizeLabel(size, "en")).not.toMatch(/[가-힣]/);
    }
    expect(sheetT("ko", "os.quick")).toBe("출결 모드");
    expect(sheetT("ko", "os.col.ment")).toBe("학부모 문구");
    expect(sheetTf("ko", "os.status.unsent", { n: 3, total: 8 })).toBe("아직 안 보낸 3 / 전체 8");
    expect(sheetTf("ko", "os.list.count", { n: 5 })).toBe("5명");
  });
});

describe("🔴 원스크린 표 본문·점수 칸·진도 카드도 사전만 본다 — 한글 리터럴 0", () => {
  it.each([
    "grid-row.tsx",
    "test-card.tsx",
    "progress-card.tsx",
    "score-input.tsx",
    "test-max-input.tsx",
    "homework-rate-input.tsx",
    "delta-chip.tsx",
    "prev-row.tsx",
    "makeup-adder.tsx",
    "bulk-present-button.tsx",
    "grid-attach.tsx",
  ])("%s", (f) => {
    const code = codeOnly(read("features", "onescreen", "components", f));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("발송 게이트도 사전만 본다 — 한글 리터럴 0", () => {
    const code = codeOnly(read("features", "onescreen", "send-gate.ts"));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 발송 게이트의 판정은 언어를 안 탄다 — 글자만 갈린다", () => {
    const args = {
      alreadySent: false,
      isAbsent: true,
      hasProgress: true,
      hasDraft: true,
      attendanceUnchecked: false,
    };
    const ko = evaluateSendGate(args);
    const en = evaluateSendGate({ ...args, lang: "en" as const });
    expect(en.canSend).toBe(ko.canSend);
    expect(en.reasons).toEqual(ko.reasons);
    expect(ko.label).toBe("결석 — 발송 제외");
    expect(en.label).not.toMatch(/[가-힣]/);
    // 입력 필요 라벨은 사유를 이어 붙인다 — 두 언어 모두 사유 수만큼 담긴다.
    const need = evaluateSendGate({
      alreadySent: false,
      isAbsent: false,
      hasProgress: false,
      hasDraft: false,
      attendanceUnchecked: true,
    });
    expect(need.label).toBe("출결 · 진도 · 멘트 입력 필요");
    const needEn = evaluateSendGate({
      alreadySent: false,
      isAbsent: false,
      hasProgress: false,
      hasDraft: false,
      attendanceUnchecked: true,
      lang: "en",
    });
    expect(needEn.label).not.toMatch(/[가-힣]/);
    expect(needEn.reasons).toEqual(need.reasons);
  });

  it("🔴 멘트 경고는 사전 키를 담고, 두 소비처가 모두 글자로 푼다", () => {
    for (const v of [...Object.values(MENT_WARNING_LABEL), ...Object.values(MENT_WARNING_HINT)]) {
      expect(v).toMatch(/^os\.warn\./);
      expect(SHEET_DICT[v]).toBeDefined();
    }
    // 🔴 키를 그대로 그리면 화면에 `os.warn.…`이 뜬다 — 두 화면 다 t()를 지나야 한다.
    for (const f of ["grid-row.tsx", "report-card.tsx"]) {
      const code = read("features", "onescreen", "components", f);
      expect(code, f).toMatch(/\{t\w*\(MENT_WARNING_LABEL\[w\]\)\}/);
      expect(code, f).toMatch(/title=\{t\w*\(MENT_WARNING_HINT\[w\]\)\}/);
    }
  });

  it("🔴 보강 제목 접미사는 언어를 안 탄다 — 학부모 보고서 제목이다", () => {
    expect(makeupTitleSuffix({ makeup: true, hasClass: true })).toBe(" (정규+보강)");
    expect(makeupTitleSuffix({ makeup: true, hasClass: false })).toBe(" (보강)");
    // 배지(화면 표기)만 갈린다.
    expect(makeupBadgeLabel({ makeup: true, hasClass: false })).toBe("보강");
    expect(makeupBadgeLabel({ makeup: true, hasClass: false }, "en")).toBe("Makeup");
    expect(makeupBadgeLabel({ makeup: false })).toBeNull();
  });

  it("🔴 과제 '미제출'·'없음'은 저장값이라 안 바뀐다 — 버튼 글자만 언어를 탄다", () => {
    expect(NOT_SUBMITTED).toBe("미제출");
    expect(NONE_LABEL).toBe("없음");
    expect(sheetT("ko", "os.hw.notSubmitted")).toBe(NOT_SUBMITTED);
    expect(sheetT("ko", "os.hw.none")).toBe(NONE_LABEL);
    expect(sheetT("en", "os.hw.notSubmitted")).not.toMatch(/[가-힣]/);
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "os.row.send")).toBe("발송");
    expect(sheetT("ko", "os.row.sent")).toBe("발송 완료");
    expect(sheetT("ko", "os.row.gen")).toBe("자동작성");
    expect(sheetTf("ko", "os.row.unread", { n: 3 })).toBe("학부모 미확인 3회");
    expect(sheetTf("ko", "os.prev.date", { date: "8/29" })).toBe("이전 8/29");
    expect(sheetTf("ko", "os.attach.title", { n: 2 })).toBe("첨부 2개 — 보기·추가·삭제");
    expect(sheetT("ko", "os.pc.heading")).toBe("오늘 어디까지 나갔나요");
  });
});

/**
 * 원스크린 **12차** — 보고서 카드·미리보기 껍데기·진도 선택기·반 서술·시트 카드·발송 시간대·값 일괄·
 * 지난 보고서·월간 달력.
 *
 * 🔴 여기서 **번역하지 않는 것**이 규약의 핵심이다:
 *  · [ParentReportCard](../onescreen/components/parent-report-card.tsx) = `/r`·인쇄·ClassNote 이미지가
 *    쓰는 **학부모가 보는 것 그대로**라 한국어 고정. 미리보기가 발송물과 달라지면 미리보기의 존재 이유가 없다.
 *  · [ReportTrendGraph](../onescreen/components/report-trend-graph.tsx)도 그 캡처 영역 안에서 렌더된다.
 */
describe("🔴 원스크린 보고서 카드·잔여 화면도 사전만 본다 — 한글 리터럴 0", () => {
  it.each([
    "report-card.tsx",
    "report-preview.tsx",
    "progress-selector.tsx",
    "class-narrative.tsx",
    "sheet-source-card.tsx",
    "send-window-notice.tsx",
    "bulk-apply.tsx",
    "history-board.tsx",
    "send-calendar.tsx",
  ])("%s", (f) => {
    const code = codeOnly(read("features", "onescreen", "components", f));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 학부모가 보는 카드·추이 그래프는 언어를 타지 않는다 — 사전 import 자체가 없다", () => {
    for (const f of ["parent-report-card.tsx", "report-trend-graph.tsx"]) {
      const code = codeOnly(read("features", "onescreen", "components", f));
      expect(code, f).not.toMatch(/teacher-view\/(lang-context|i18n)/);
      expect(code, f).not.toMatch(/useSheet(Lang|T|Tf)/);
    }
    // 미리보기는 **껍데기만** 사전을 타고 안쪽 카드는 그대로 넘긴다.
    const prev = read("features", "onescreen", "components", "report-preview.tsx");
    expect(prev).toMatch(/<ParentReportCard/);
  });

  it("🔴 발송 상태 배지를 그리는 강사 화면은 전부 lang을 넘긴다", () => {
    // 🔴 안 넘기면 영어 화면에 "ClassNote 발송 완료"가 한글로 남는다 — 에러가 안 나서 눈으로만 잡힌다.
    for (const f of ["grid-row.tsx", "report-card.tsx", "history-board.tsx", "status-board.tsx"]) {
      const code = codeOnly(read("features", "onescreen", "components", f));
      const calls = code.match(/classnoteBadge\([^)]*\)/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, `${f} — ${c}`).toMatch(/,\s*lang\s*\)$/);
    }
  });

  it("🔴 학부모 읽음 시각은 언제나 KST — 바뀌는 건 글자 형식뿐", () => {
    const iso = "2026-07-18T04:01:00.000Z"; // KST 13:01
    expect(readAtLabel(iso)).toBe("7월 18일 13:01");
    const en = readAtLabel(iso, "en");
    expect(en).not.toMatch(/[가-힣]/);
    expect(en).toContain("13:01"); // 시각대가 안 흔들린다
  });

  it("🔴 '미발송 반' 문장은 한글 옆에 영어를 둔다 — ko 기본값 불변", () => {
    expect(reportOptoutNotice()).toBe(REPORT_OPTOUT_NOTICE);
    expect(reportOptoutShort()).toBe(REPORT_OPTOUT_SHORT);
    expect(reportOptoutNotice("en")).not.toMatch(/[가-힣]/);
    expect(reportOptoutShort("en")).not.toMatch(/[가-힣]/);
    // 발송 게이트도 같은 문장을 쓴다(판정은 불변).
    const args = {
      alreadySent: false,
      reportOptout: true,
      isAbsent: false,
      hasProgress: true,
      hasDraft: true,
      attendanceUnchecked: false,
    };
    expect(evaluateSendGate(args).label).toBe(REPORT_OPTOUT_SHORT);
    const en = evaluateSendGate({ ...args, lang: "en" as const });
    expect(en.reasons).toEqual(evaluateSendGate(args).reasons);
    expect(en.label).not.toMatch(/[가-힣]/);
  });

  it("🔴 일괄 출결 '건너뛴 사유'도 한 표에서 온다 — ko 기본값 불변", () => {
    // 픽스처는 bulk-attendance.test.ts가 이미 잠근 것과 같은 조합(사유 3종).
    const rows = [
      { studentId: "s1", classId: "c1", raw: "present" },
      { studentId: "s2", classId: "c1", raw: "excused" },
      { studentId: "s3", classId: null },
    ];
    const plan = planBulkAttendance(rows, "present", { onlyEmpty: false });
    expect(describeAttendanceSkips(plan)).toBe("이미 같은 상태 1 · 조퇴·공결·보강 1 · 반 없음 1");
    expect(describeAttendanceSkips(plan, "en")).not.toMatch(/[가-힣]/);
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "os.card.saved")).toBe("기록 저장");
    expect(sheetT("ko", "os.card.queue")).toBe("ClassNote 발송");
    expect(sheetT("ko", "os.card.save")).toBe("저장");
    expect(sheetT("ko", "os.card.saveSent")).toBe("발송됨 — 수정 불가");
    expect(sheetTf("ko", "os.card.title", { name: "김민수" })).toBe("김민수 · 학부모 보고");
    expect(sheetTf("ko", "os.card.views", { n: 3 })).toBe("3회 열람");
    expect(sheetT("ko", "os.ps.pickPh")).toBe("진도 선택…");
    expect(sheetT("ko", "os.cn.btn")).toBe("반 서술");
    expect(sheetT("ko", "os.ss.title")).toBe("ECS 시트 · 오늘 계획");
    expect(sheetT("ko", "os.bulk.btn")).toBe("일괄 입력");
    expect(sheetT("ko", "os.bulk.apply")).toBe("적용");
    expect(sheetTf("ko", "os.hist.countOnDay", { n: 4 })).toBe("이 날짜 보고서 4건");
    expect(sheetTf("ko", "os.cal.sum", { n: 9, sent: 7, target: 8 })).toBe("작성 9건 · 학부모 발송 7/8");
    expect(sheetT("ko", "os.preview.title")).toBe("학부모 화면 미리보기");
  });
});

/**
 * 회수 버튼은 **강사 카드와 사무실 목록이 같은 컴포넌트**를 쓴다 — 사무실 풀셸엔 언어 Provider가 없어
 * 한국어로 떨어지므로 배선해도 안전하다. 🔴 다만 **막힌 사유 함수는 서버·일괄 회수도 쓴다** →
 * 인자를 안 주면 한국어라는 계약이 깨지면 사무실 화면에 영어가 샌다.
 */
describe("🔴 회수 버튼·막힌 사유도 사전만 본다 — ko 기본값 불변", () => {
  it("recall-button.tsx 한글 리터럴 0", () => {
    const code = codeOnly(read("features", "report-admin", "components", "recall-button.tsx"));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 인자를 안 주면 한국어 — 사무실·서버 경로가 그대로다", () => {
    const row = { classnoteStatus: "recalled", shareToken: "t" };
    expect(recallBlockReason(row)).toBe("이미 회수된 보고서입니다");
    expect(recallBlockReason(row, "en")).not.toMatch(/[가-힣]/);
    expect(makeupRemoveBlockReason("queued")).toBe("발송 처리 중인 보강입니다 — 끝난 뒤에 다시 시도하세요");
    expect(makeupRemoveBlockReason("queued", "en")).not.toMatch(/[가-힣]/);
    // 뺄 수 있는 행은 두 언어 모두 사유가 없다(판정은 언어를 안 탄다).
    expect(makeupRemoveBlockReason(null)).toBeNull();
    expect(makeupRemoveBlockReason(null, "en")).toBeNull();
    expect(recallBlockReason({ classnoteStatus: "success", shareToken: "t" })).toBeNull();
    expect(recallBlockReason({ classnoteStatus: "success", shareToken: "t" }, "en")).toBeNull();
  });
});

/**
 * 원스크린 **13차** — 화면 껍데기(`onescreen-client`)와 학부모 공지 작성.
 *
 * 🔴 이 파일은 토스트가 대부분이라 **저장값과 화면 글자가 한 줄에 섞여 있다** — 아래 가드가
 *    저장값(보강 행 이름·출결 배지값)이 언어를 안 타는지까지 함께 본다.
 */
describe("🔴 원스크린 화면 껍데기·공지 작성도 사전만 본다 — 한글 리터럴 0", () => {
  // 화면에서 옮겨 낸 훅(P3-O)도 같은 규칙이다.
  it.each(["onescreen-client.tsx", "use-session-autosave.ts", "use-roster-view.ts", "use-report-attachments.ts", "use-auto-write.ts", "use-bulk-ops.ts", "bulk-ops-types.ts", "../bulk-apply-plan.ts", "use-bulk-apply.ts", "use-bulk-copy.ts", "use-prev-import.ts", "use-bulk-send.ts", "use-english-template-mode.ts", "english-template-types.ts", "../english-row-facts.ts", "use-english-templates.ts", "use-english-output.ts", "use-english-generate.ts", "use-makeup-flow.ts", "makeup-flow-types.ts", "../makeup-ask-plan.ts", "use-makeup-ask.ts", "use-makeup-apply.ts", "use-makeup-resolve.ts", "use-makeup-row.ts", "use-makeup-prev.ts", "use-send-core.ts", "use-report-save-input.ts", "use-report-save-effects.ts", "use-report-send.ts", "onescreen-card-column.tsx", "notice-composer.tsx", "notice-attachment-picker.tsx"])(
    "%s",
    (f) => {
      const code = codeOnly(read("features", "onescreen", "components", f));
      const hits = code
        .split(/\r?\n/)
        .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
        .filter((l) => /[가-힣]/.test(l));
      expect(hits).toEqual([]);
    },
  );

  it("🔴 보강 행 이름은 **맵 키**라 언어를 안 탄다", () => {
    // `reports[학생][이 이름]`의 키이자 저장 단위 — 영어로 바꾸면 그 행의 기록이 통째로 길을 잃는다.
    expect(makeupRowName("수학")).toBe(`수학${MAKEUP_ONLY_SUFFIX}`);
    expect(makeupRowName("수학")).toBe("수학 (보강)");
    expect(makeupRowName("수학", 2)).toBe("수학 (보강 2)");
    expect(makeupRowName("수학", 1)).toBe("수학 (보강)"); // 1은 번호를 안 붙인다(옛 동작)
    // 화면 어디에도 이 문자열을 손으로 짓지 않는다.
    const client = codeOnly(readOnescreenScreen());
    expect(client).toContain("makeupRowName(su.name)");
  });

  it("🔴 공지 상태 라벨은 사전 키를 담고 화면이 글자로 푼다", () => {
    const src = read("features", "onescreen", "components", "notice-composer.tsx");
    for (const key of [
      "os.n.st.queued",
      "os.n.st.processing",
      "os.n.st.success",
      "os.n.st.partial",
      "os.n.st.failed",
      "os.n.st.revokeRequested",
      "os.n.st.revoking",
      "os.n.st.editRequested",
      "os.n.st.editing",
      "os.n.st.revoked",
      "os.n.st.revokePartial",
    ]) {
      expect(SHEET_DICT[key as keyof typeof SHEET_DICT], key).toBeDefined();
      expect(src, key).toContain(`"${key}"`);
    }
    // 🔴 키를 그대로 그리면 화면에 `os.n.st.…`가 뜬다 — 반드시 t()를 지난다.
    expect(src).toContain("{st.key ? t(st.key) : st.raw}");
    // 모르는 상태는 raw로 떨어진다(옛 default 분기 그대로).
    expect(src).toContain("{ key: null, raw: s,");
  });

  it("🔴 첨부 라벨은 호출부가 덮을 수 있고, 기본값은 사전이 든다", () => {
    // 사무실 공지 화면은 자기 라벨을 넘긴다 — prop 기본값을 사전으로 바꿔도 그 화면은 그대로다.
    const src = read("features", "onescreen", "components", "notice-attachment-picker.tsx");
    expect(src).toContain('label ?? t("os.na.label")');
    expect(sheetT("ko", "os.na.label")).toBe("이미지 첨부 (선택 학생 모두에게)");
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "os.c.autosaveFail")).toBe("자동 저장에 실패했습니다");
    expect(sheetT("ko", "os.c.markSend")).toBe("학부모 발송");
    expect(sheetT("ko", "os.c.markSave")).toBe("보고서 저장");
    expect(sheetT("ko", "os.c.bulkBusy")).toBe("일괄 작업이 진행 중입니다 — 완료 후 다시 시도하세요");
    expect(sheetT("ko", "os.c.needProgress")).toBe("오늘 진도를 먼저 입력하세요");
    expect(sheetT("ko", "os.c.pickStudent")).toBe("학생을 선택하세요");
    expect(sheetT("ko", "os.c.reportHeading")).toBe("수업보고서");
    expect(sheetTf("ko", "os.c.makeupAdded", { name: "김민수" })).toBe("김민수 보강 추가됨");
    expect(sheetTf("ko", "os.c.saveDone", { n: 4 })).toBe("4건 저장 완료");
    expect(sheetTf("ko", "os.c.sentBannerTitle", { n: 2 })).toBe(
      "이 날짜는 이미 학부모에게 발송된 보고서가 2건 있습니다",
    );
    expect(sheetT("ko", "os.n.heading")).toBe("학부모 공지");
    expect(sheetT("ko", "os.n.test")).toBe("테스트 발송(학원이)");
    expect(sheetT("ko", "os.n.st.success")).toBe("게시 완료");
    expect(sheetTf("ko", "os.n.queued", { n: 7 })).toBe("7명 발송 대기(연동 PC가 순차 게시)");
    expect(sheetTf("ko", "os.na.hint", { n: 5 })).toBe("사진(JPG·PNG·WebP) · 한 글에 최대 5장");
  });

  it("🔴 줄 앞 개행이 살아 있다 — 일괄 발송 확인창은 줄바꿈으로 읽는다", () => {
    // 사전으로 옮기면서 `\n`이 사라지면 확인창이 한 줄로 뭉쳐 아무도 안 읽는다.
    for (const k of ["os.c.lineProgress", "os.c.lineUnchecked", "os.c.lineGap", "os.c.lineMent", "os.c.lineAbsent", "os.c.lineSent"] as const) {
      expect(SHEET_DICT[k].ko.startsWith("\n"), k).toBe(true);
      expect(SHEET_DICT[k].en.startsWith("\n"), k).toBe(true);
    }
  });
});

/**
 * 수업목록 **14차** — 목록 화면 + 목록 화면들이 함께 쓰는 조각 둘(페이저·makeedu 동기화 배지).
 *
 * 🔑 이 두 조각은 **화면 5곳이 같은 모양으로** 쓴다 — 화면마다 배선하면 한 곳만 빠뜨려도
 *    그 화면만 한글로 남고 아무도 에러를 못 본다. 그래서 언어를 조각 쪽에서 해결한다:
 *    · 배지 = async 서버 컴포넌트라 **자기가 읽는다**(`getTeacherViewLang`).
 *    · 페이저 = **클라 컴포넌트도 import**하므로 server-only 조회를 넣을 수 없어 **prop**(기본 한국어).
 */
describe("🔴 수업목록(목록)·공용 조각 — 한글 리터럴 0", () => {
  it.each([
    ["app", "(shell)", "classes", "page.tsx"],
    // ⚠️ 옛 `class-filter-bar.tsx`·`filter-shared.ts`는 디자인 v5에서 사라졌다(필터 = 열 머리, 어휘는
    //    `features/classes/list-filters.ts`로 이사). 지금 화면에서 한글을 들 수 있는 자리는 요일 머리 필터다.
    ["app", "(shell)", "classes", "_components", "header-day-filter.tsx"],
    ["components", "pagination.tsx"],
    ["components", "makeedu-sync-badge.tsx"],
  ])("%s/%s", (...seg) => {
    const code = codeOnly(read(...seg));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 페이저에 server-only 조회를 넣지 않는다 — 클라 컴포넌트도 이 모듈을 import한다([[#61]])", () => {
    const src = read("components", "pagination.tsx");
    expect(src).not.toContain("getTeacherViewLang");
    expect(src).not.toContain('import "server-only"');
    // 언어는 prop이고 **기본값이 한국어**라, 안 넘기는 사무실 화면은 한 글자도 안 바뀐다.
    expect(src).toContain("lang = DEFAULT_SHEET_LANG");
  });

  it("🔴 동기화 배지의 `issue`는 워커가 쓴 한국어 사실 문장이라 번역하지 않는다", () => {
    const src = read("components", "makeedu-sync-badge.tsx");
    // 사전엔 자리(`{issue}`)만 있고 문장은 없다 — 원문을 그대로 실어 보낸다.
    expect(src).toContain('sheetTf(lang, "sync.titleIssue", { issue: state.issue })');
    expect(SHEET_DICT["sync.titleIssue"].en).toContain("{issue}");
    // 배지는 자기가 언어를 읽는다(화면 5곳에 prop을 배선하지 않는다).
    expect(src).toContain("getTeacherViewLang()");
  });

  it("🔴 툴팁 줄바꿈이 살아 있다 — '확인 필요'는 다음 줄에 붙는다", () => {
    for (const lang of ["ko", "en"] as const) {
      expect(SHEET_DICT["sync.titleIssue"][lang].startsWith("\n"), lang).toBe(true);
    }
  });

  it("🔴 영어 요일은 세 글자라 요일 알약이 20px 고정이면 넘친다", () => {
    // `size-5`(20×20 고정)로 되돌리면 `Mon`이 잘린다 — 높이만 고정하고 가로는 늘어나야 한다.
    const src = read("app", "(shell)", "classes", "page.tsx");
    expect(src).toContain("h-5 min-w-5");
    expect(src).not.toContain("inline-flex size-5 items-center justify-center rounded-full");
  });

  it("🔴 필터 선택지 라벨은 사전 키다 — 값(enum)은 URL 파라미터라 불변", () => {
    // ⚠️ 어휘는 v5에서 `features/classes/list-filters.ts`로 이사했다(옛 `_components/filter-shared.ts`).
    //    정렬 라벨은 라우트가 사전에서 고르므로 그 파일도 함께 본다.
    const src =
      read("features", "classes", "list-filters.ts") + read("app", "(shell)", "classes", "page.tsx");
    for (const k of [
      "cls.status.operating",
      "cls.status.ended",
      "cls.status.retired",
      "cls.filter.all",
      "cls.sort.name",
      "cls.sort.name.desc",
      "cls.sort.students",
      "cls.sort.students.asc",
      "cls.sort.teacher",
      "cls.sort.teacher.desc",
    ]) {
      expect(SHEET_DICT[k as keyof typeof SHEET_DICT], k).toBeDefined();
      expect(src, k).toContain(`"${k}"`);
    }
    // 값은 그대로 — 하나라도 바뀌면 저장된 링크·복원값이 통째로 깨진다.
    for (const v of ["operating", "ended", "retired", "all", "name", "students", "teacher", "name_desc", "students_asc", "teacher_desc"]) {
      expect(src, v).toContain(`"${v}"`);
    }
    // 🔴 **어휘 파일엔 문구를 두지 않는다**(값 + 사전 키만) — 라우트는 그 키를 `sheetT`로 풀어 쓰므로
    //    `label:`이 나와도 정상이다. 그래서 이 검사는 어휘 파일 하나만 본다.
    expect(read("features", "classes", "list-filters.ts")).not.toContain("label:");
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "cls.title")).toBe("수업목록");
    expect(sheetT("ko", "cls.eyebrow")).toBe("수업 운영");
    expect(sheetTf("ko", "cls.desc", { active: 78, seats: 1240 })).toBe(
      "운영 78개 반 · 등록 학생 1240명",
    );
    expect(sheetT("ko", "cls.stat.total")).toBe("전체 반");
    expect(sheetT("ko", "cls.stat.active")).toBe("운영 중");
    expect(sheetT("ko", "cls.unit.class")).toBe("개");
    expect(sheetT("ko", "cls.unit.people")).toBe("명");
    expect(sheetT("ko", "cls.count.pre")).toBe("결과 ");
    expect(sheetT("ko", "cls.count.post")).toBe("개");
    expect(sheetTf("ko", "cls.count.pages", { page: 2, total: 5 })).toBe("2/5 페이지");
    expect(sheetT("ko", "cls.empty.desc")).toBe(
      "폐지·종강된 반은 기본으로 숨깁니다. 상태를 바꾸면 함께 보입니다.",
    );
    expect(sheetT("ko", "cls.status.operating")).toBe("운영");
    expect(sheetT("ko", "cls.status.ended")).toBe("종강");
    expect(sheetT("ko", "cls.status.retired")).toBe("폐지");
    expect(sheetT("ko", "cls.stale")).toBe("운영 기간 밖");
    expect(sheetTf("ko", "cls.dayAt", { dow: "월", time: "14:30" })).toBe("월14:30");
    expect(sheetTf("en", "cls.dayAt", { dow: "Mon", time: "14:30" })).toBe("Mon 14:30");
    expect(sheetT("ko", "cls.filter.searchPh")).toBe("수업명, 강사, 강의실 검색");
    expect(sheetT("ko", "common.prev")).toBe("이전");
    expect(sheetT("ko", "common.next")).toBe("다음");
    expect(sheetTf("ko", "common.pageCount", { n: 401 })).toBe(" · 401건");
    expect(sheetT("ko", "sync.failed")).toBe("동기화 실패");
    expect(sheetTf("ko", "sync.ago", { when: "5분 전" })).toBe("동기화 5분 전");
    expect(sheetTf("ko", "sync.minAgo", { n: 5 })).toBe("5분 전");
    expect(sheetT("ko", "sync.issue")).toBe("· 확인 필요");
  });
});

/**
 * 수업 상세 **15차** — 반 상세 화면과 그 위에 서는 조각들(시간표 요약·레벨 변경·인수인계·위임·이력).
 *
 * 🔑 이 차수의 위험은 **화면 글자와 기록이 한 줄에 섞여 있다**는 것이다. 아래 가드가 둘을 가른다:
 *    · 번역하는 것 = 우리가 쓴 UI 문구(열 제목·버튼·배지·안내).
 *    · 번역하지 않는 것 = 감사로그가 쓴 **한국어 사실 문장**(이력 줄의 제목·설명·행위자).
 */
describe("🔴 수업 상세 — 한글 리터럴 0", () => {
  it.each([
    ["app", "(shell)", "classes", "[id]", "page.tsx"],
    ["app", "(shell)", "classes", "[id]", "_components", "schedule-summary-view.tsx"],
    ["app", "(shell)", "classes", "[id]", "_components", "class-level-action.tsx"],
    ["app", "(shell)", "classes", "[id]", "_components", "teacher-handover.tsx"],
    ["app", "(shell)", "classes", "[id]", "_components", "class-delegation.tsx"],
    ["app", "(shell)", "classes", "[id]", "_components", "history-section.tsx"],
    ["components", "scheduled-change-banner.tsx"],
    ["features", "enrollments", "components", "editable-attendance-cell.tsx"],
    ["features", "enrollments", "scheduled-changes.ts"],
    ["features", "classes", "delegation-window.ts"],
    ["features", "timetable", "server", "scheduled-class-change.ts"],
  ])("%s/%s", (...seg) => {
    const code = codeOnly(read(...seg));
    const hits = code
      .split(/\r?\n/)
      .map((l) => l.replace(/\/\/[^\n\r]*/g, ""))
      .filter((l) => /[가-힣]/.test(l));
    expect(hits).toEqual([]);
  });

  it("🔴 인자를 안 주면 한국어 — 서버 액션·감사로그가 같은 함수를 쓴다", () => {
    // 이 다섯은 **서버에서도** 불린다(위임 검증·감사로그 문구·예약 배너). 기본값이 흔들리면
    // 사무실 화면과 기록이 함께 영어가 된다.
    expect(formatDays(["mon", "tue", "wed"])).toBe("월~수");
    expect(formatDays(["mon", "thu"])).toBe("월·목");
    expect(formatMinutes(100)).toBe("1시간 40분");
    expect(formatMinutes(40)).toBe("40분");
    expect(formatMinutes(120)).toBe("2시간");
    expect(validateDelegationRange("2026-09-10", "2026-09-01")).toBe("종료일이 시작일보다 빠릅니다");
    expect(validateDelegationRange("nope", "2026-09-01")).toBe("기간을 날짜로 선택해주세요");
    expect(delegationRangeLabel("2026-08-03", "2026-08-03")).toBe("8월 3일");
    expect(delegationRangeLabel("2026-08-03", "2026-08-07")).toBe("8월 3일 ~ 8월 7일");
    expect(
      scheduledChangeLabel(
        { enrollmentId: "e", kind: "join", className: "DP3", date: "2026-09-01" } as never,
        "2026-08-29",
      ),
    ).toBe("9/1부터 DP3 합류");
    // 0이거나 깨진 값은 예전처럼 빈 문자열(문구를 지어내지 않는다).
    expect(formatMinutes(0)).toBe("");
    expect(formatDays([])).toBe("");
  });

  it("영어도 같은 자리에 같은 사실이 온다", () => {
    expect(formatDays(["mon", "tue", "wed"], "en")).toBe("Mon~Wed");
    expect(formatMinutes(100, "en")).toBe("1 h 40 min");
    expect(delegationRangeLabel("2026-08-03", "2026-08-07", "en")).toBe("8/3 – 8/7");
    expect(validateDelegationRange("2026-09-10", "2026-09-01", "en")).toMatch(/before/i);
  });

  it("🔴 이력 줄의 내용은 감사로그가 쓴 한국어 사실 문장이라 번역하지 않는다", () => {
    const src = read("app", "(shell)", "classes", "[id]", "_components", "history-section.tsx");
    // 출처 알약만 사전을 탄다.
    expect(src).toContain('schedule: "cls.hist.src.schedule"');
    expect(src).toContain("{t(SOURCE_LABEL[e.source])}");
    // 제목·설명·행위자는 원문 그대로.
    expect(src).toContain("{e.title}");
    expect(src).toContain("{e.detail}");
    expect(src).toContain("{e.actor}");
  });

  it("🔴 출결 상태 이름은 `seatMarkLabelOf` 단일 소스 — 낱말을 새로 짓지 않는다", () => {
    const src = read("app", "(shell)", "classes", "[id]", "page.tsx");
    expect(src).toContain('seatMarkLabelOf("absent", lang)');
    expect(src).toContain('seatMarkLabelOf("late", lang)');
    // 사전에 같은 뜻의 키를 새로 만들지 않았는지(뜻 하나에 표 하나).
    expect(SHEET_DICT).not.toHaveProperty("cls.d.absent");
    expect(SHEET_DICT).not.toHaveProperty("cls.d.late");
  });

  it("🔴 요일 글자 사본을 되살리지 않는다 — 앱 전역 `sheetDowLabel` 단일 소스", () => {
    const summary = read("features", "classes", "schedule-summary.ts");
    expect(summary).not.toContain("DAY_LABEL");
    expect(summary).toContain("sheetDowLabel");
    const cell = read("features", "enrollments", "components", "editable-attendance-cell.tsx");
    expect(cell).not.toContain("DAY_LABEL");
    expect(cell).toContain("sheetDowLabel");
  });

  it("🔴 영어 요일이 들어가도록 요일 칩이 늘어난다", () => {
    for (const seg of [
      ["app", "(shell)", "classes", "[id]", "_components", "schedule-summary-view.tsx"],
      ["features", "enrollments", "components", "editable-attendance-cell.tsx"],
    ]) {
      const src = read(...seg);
      expect(src, seg.join("/")).toContain("h-5 min-w-5");
      expect(src, seg.join("/")).not.toContain("inline-flex size-5 items-center");
    }
  });

  it("🔴 예정 배너는 언어를 prop으로 받고 기본값이 한국어 — 아직 안 배선된 학생 상세는 그대로다", () => {
    const src = read("components", "scheduled-change-banner.tsx");
    expect(src).toContain("lang = DEFAULT_SHEET_LANG");
    expect(src).not.toContain("getTeacherViewLang");
    expect(src).toContain('title={sheetT(lang, "sched.makeupDetail")}');
    const cls = read("app", "(shell)", "classes", "[id]", "page.tsx");
    expect(cls).toMatch(/subject="class"\s+lang=\{lang\}/);
  });

  it("🔴 ko 결과가 옛 문자열과 글자까지 같다", () => {
    expect(sheetT("ko", "cls.d.back")).toBe("수업목록으로");
    expect(sheetT("ko", "cls.d.eyebrow")).toBe("수업 · 반");
    expect(sheetTf("ko", "cls.d.endedAt", { date: "2026-08-31" })).toBe("종강 2026-08-31");
    expect(sheetT("ko", "cls.d.enrolledPre")).toBe("· 재원생 ");
    expect(sheetT("ko", "cls.d.enrolledPost")).toBe("명");
    expect(sheetT("ko", "cls.d.edit")).toBe("반 수정");
    expect(sheetT("ko", "cls.d.attendance")).toBe("오늘 출석 입력");
    expect(sheetT("ko", "cls.d.schedHint")).toBe(
      "그날 자동으로 바뀝니다. 되돌리려면 시간표 화면의 적용 예정 배지에서 취소하세요.",
    );
    expect(sheetT("ko", "cls.d.rate")).toBe("출석률");
    expect(sheetT("ko", "cls.d.unitCount")).toBe("건");
    expect(sheetTf("ko", "cls.d.rosterCount", { n: 12 })).toBe("12명");
    expect(sheetTf("ko", "cls.d.upcomingCount", { n: 2 })).toBe("· 예정 2");
    expect(sheetT("ko", "cls.d.rosterEmpty")).toBe("활성 재원생이 없습니다");
    expect(sheetT("ko", "cls.d.toNow")).toBe("~ 현재");
    expect(sheetT("ko", "cls.d.onHold")).toBe("휴원");
    expect(sheetTf("ko", "cls.d.onlyDays", { days: "화·목" })).toBe("화·목만");
    expect(sheetT("ko", "cls.sch.none")).toBe("등록된 시간표가 없습니다");
    expect(sheetTf("ko", "cls.sch.sessions", { n: 5 })).toBe(" · 주 5회");
    expect(sheetTf("ko", "cls.sch.pastHidden", { n: 3 })).toBe("지난 배치 3개는 숨김");
    expect(sheetT("ko", "cls.ho.open")).toBe("강사 인수인계");
    expect(sheetT("ko", "cls.ho.due")).toBe("적용일 도달");
    expect(sheetT("ko", "cls.ho.applyNow")).toBe("지금 적용");

    // 🔴 안내문 가운데의 강조 조각은 버튼과 **같은 키**를 쓴다 — 둘이 갈리면 안내가 거짓이 된다.

    expect(read("app", "(shell)", "classes", "[id]", "_components", "teacher-handover.tsx")).toContain(

      '<span className="text-foreground">{t("cls.ho.applyNow")}</span>',

    );

    expect(sheetT("ko", "cls.ho.introA")).toBe("현재 담임 ");
    expect(sheetT("ko", "cls.dg.open")).toBe("임시 위임");
    expect(sheetTf("ko", "cls.dg.bannerTitle", { n: 2 })).toBe("임시 위임 2건 — 담임은 그대로입니다");
    expect(sheetT("ko", "cls.dg.active")).toBe("진행 중");
    expect(sheetT("ko", "cls.hist.title")).toBe("이력");
    expect(sheetT("ko", "cls.hist.src.report")).toBe("보고서");
    expect(sheetT("ko", "sched.title")).toBe("예정된 변경");
    expect(sheetT("ko", "sched.makeupDetail")).toBe("보강 상세");
    expect(sheetT("en", "sched.makeupDetail")).toBe("Makeup detail");
    expect(sheetTf("ko", "sched.classChange", { md: "9/1", what: "담임", from: "김", to: "이" })).toBe(
      "9/1부터 담임 김 → 이",
    );
  });
});
