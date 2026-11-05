/**
 * '수업보고서 미발송'(0174a)이 **표면 하나에서 빠지는 것**을 막는 회귀 테스트.
 *
 * 이 기능의 유일한 실패 모드는 #77 — "화면에선 숨겼는데 다른 데선 보인다"이다. 실제 소비처가 여럿이고
 * (작성률 · 영어 작성률 · 오늘 미작성 신호 · 로스터 · 직접 발송 · 반 구성 대조 · 미발송 재촉 · 출결 파생)
 * 그중 하나라도 놓치면 원장 화면에서 숫자가 갈리거나 강사가 여전히 그 반을 본다.
 *
 * 🔴 **2026-08-19부터 방향이 둘이다.** 원장 지시 *"보고서는 안보내지만 이제부터라도 출결은 찍을것"*으로
 *    **출결** 표면(당일 출결 보드·원스크린 로스터)은 이 반을 **빼면 안 된다**. 그래서 아래 두 묶음이 있다:
 *      ① SURFACES  = 보고서 쪽에서 이 플래그를 **봐야** 하는 곳(빠뜨리면 미발송 반이 되살아난다)
 *      ② 아래 반대 방향 가드 = 출결 쪽에서 이 플래그로 **거르면 안 되는** 곳(되돌리면 출결을 못 찍는다)
 *
 * 그래서 **파일 목록을 못 박고** 각 파일이 이 컬럼을 실제로 보는지 검사한다. 새 보고서 화면을 추가하는
 * 다음 사람은 여기서 걸려야 한다.
 *
 * ⚠️ 이건 "무엇을 하는가"까지는 못 본다(참조만 확인). 정확한 동작은 각 소비처의 코드 주석과
 *    derive-from-reports 단위테스트가 담당한다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** 이 컬럼을 **반드시 봐야 하는** 소비 표면. 새로 생기면 여기에 추가할 것. */
const SURFACES: { path: string; why: string }[] = [
  {
    path: "src/features/onescreen/server/roster.ts",
    why: "로스터 **행에 플래그를 실어** 보고서 칸만 잠근다(2026-08-19 — 목록에서 빼지는 않는다)",
  },
  { path: "src/features/onescreen/grid.ts", why: "원스크린 행 입력 잠금·발송/자동작성 게이트(isReportOptoutRow)" },
  {
    path: "src/features/onescreen/server/classnote-match.ts",
    why: "C.N 아이콘 대상 반 — 미발송 반은 ClassNote 반 보드 대상이 아니다(원장 2026-11-04 · 그 줄엔 아이콘 없음)",
  },
  { path: "src/features/onescreen/server/actions.ts", why: "강사 발송 서버 재검증(#77) — 저장은 하고 큐잉만 막는다" },
  { path: "src/features/report-admin/server/queries.ts", why: "작성률 분모 + 영어 작성률(요구 ②)" },
  { path: "src/features/dashboard/server/action-signals.ts", why: "대시보드/브리핑 '오늘 미작성' — 작성률과 별도 경로" },
  { path: "src/features/report-admin/server/compose-actions.ts", why: "직접 발송 서버 재검증(#77)" },
  { path: "src/features/report-admin/server/notice-actions.ts", why: "반 목록 옵션에 플래그 실어 보내기" },
  { path: "src/features/report-admin/server/board-roster-queries.ts", why: "'반 구성' 보드 대조" },
  { path: "src/features/notifications/server/events.ts", why: "'미발송 보고서' 재촉 알림" },
  { path: "src/features/attendance/server/queries.ts", why: "🔴 출결 파생 — 빼면 지난 등원일이 전부 결석으로 뒤집힌다" },
  { path: "src/features/classes/server/delegation.ts", why: "로스터에 값 실어 나르기" },
  { path: "src/features/classes/server/actions.ts", why: "반 생성/수정 저장" },
  { path: "src/app/(shell)/lesson-reports/_components/bulk-compose-face.tsx", why: "직접 발송 반 체크박스 목록" },
  { path: "src/app/(shell)/classes/_components/class-report-fields.tsx", why: "반 설정 토글 UI" },
];

describe("수업보고서 미발송 — 소비 표면 전수(0174a)", () => {
  it.each(SURFACES)("$path 는 report_optout을 본다 — $why", ({ path }) => {
    const code = readFileSync(join(process.cwd(), path), "utf8");
    expect(
      /report_?optout/i.test(code),
      `${path} 가 '수업보고서 미발송' 플래그를 더 이상 보지 않습니다. ` +
        `보고서 표면은 classes.report_optout을 함께 볼 것 — 한 곳만 빠져도 ` +
        `"목록에선 사라졌는데 여기선 보인다"가 됩니다(#77). ` +
        `표면을 의도적으로 없앴다면 이 목록에서도 지우고 그 이유를 커밋 메시지에 남기세요.`,
    ).toBe(true);
  });

  /**
   * 🔴 **반대 방향 가드**(2026-08-19) — 출결 표면에서 이 플래그로 반을 거르면 안 된다.
   *
   * 원장 지시: *"보고서는 안보내지만 이제부터라도 출결은 찍을것"*. 그 전까지 미발송 3반은
   * ① 원스크린 로스터(`.filter((c) => !c.reportOptout)`)와 ② 당일 출결 보드(`isReportOptout` continue)
   * 두 곳 모두에서 빠져 **담임도 데스크도 출결을 찍을 수단이 아예 없었다**(실측 전 기간 출결 0행).
   * 이 가드는 다음 사람이 "여기도 걸러야 하지 않나"로 무심코 되돌리는 것을 막는다.
   */
  it("🔴 출결 표면은 미발송 반을 목록에서 빼지 않는다 — 보고서는 안 보내도 출결은 찍는다(2026-08-19)", () => {
    const live = readFileSync(join(process.cwd(), "src/features/attendance/live/server/load.ts"), "utf8");
    expect(
      /from "@\/features\/classes\/report-optout"/.test(live),
      "당일 출결 보드(live/server/load.ts)가 다시 '수업보고서 미발송' 판정을 가져왔습니다. " +
        "이 보드에서 그 반을 거르면 데스크가 대신 출결을 찍어 줄 수도 없습니다(원장 2026-08-19). " +
        "보고서 쪽 제외는 SURFACES의 보고서 표면들이 맡습니다.",
    ).toBe(false);

    const roster = readFileSync(join(process.cwd(), "src/features/onescreen/server/roster.ts"), "utf8");
    for (const [pattern, what] of [
      [/filter\([^)]*!\s*c\.reportOptout/, "`.filter((c) => !c.reportOptout)`"],
      [/keepReportedClasses/, "`keepReportedClasses`"],
    ] as const) {
      expect(
        pattern.test(roster),
        `원스크린 로스터가 ${what}로 미발송 반을 목록에서 다시 뺐습니다. ` +
          "원스크린은 **출결 알약이 있는 유일한 강사 화면**이라, 목록에서 빼면 담임이 그 반 출결을 " +
          "찍을 방법이 사라집니다. 반은 남기고 행 플래그(`reportOptout`)로 보고서 칸만 잠그세요.",
      ).toBe(false);
    }
  });

  it("🔴 로스터는 반을 남기되 보고서 칸은 잠근다 — 행에 플래그를 실어 보낸다", () => {
    const roster = readFileSync(join(process.cwd(), "src/features/onescreen/server/roster.ts"), "utf8");
    expect(
      /reportOptout: true/.test(roster),
      "로스터가 과목 행에 `reportOptout`을 싣지 않습니다 — 플래그가 없으면 grid.ts의 잠금·발송 게이트가 " +
        "그 행을 평범한 반으로 보고 보고서 입력·발송을 열어 줍니다(#77의 뒤집힌 꼴).",
    ).toBe(true);
  });

  it("🔴 발송 게이트는 화면 한 겹이 아니다 — 서버도 미발송 반을 큐잉하지 않는다(#77)", () => {
    const actions = readFileSync(join(process.cwd(), "src/features/onescreen/server/actions.ts"), "utf8");
    expect(
      /status: "report_optout"/.test(actions),
      "강사 발송 액션(saveAndQueueClassnote)에 '수업보고서 미발송' 반 게이트가 없습니다. " +
        "화면 버튼만 잠그면 stale 화면·직접 호출로 우회돼 그 반 보고서가 학부모에게 나갑니다(#77). " +
        "관리자 일괄 발송(compose-actions)이 이미 서버에서 다시 거르는 것과 같은 축입니다.",
    ).toBe(true);
    // 저장까지 막으면 그 반의 **지난 보고서 수정**이 잠긴다(report-optout.ts가 못 박은 "숨김이지 차단이 아니다").
    expect(
      /const saved = await saveLessonReport\(input\);[\s\S]*status: "report_optout"/.test(actions),
      "미발송 반 게이트가 저장(saveLessonReport)보다 앞에 있습니다 — 발송만 막고 저장은 통과시켜야 합니다.",
    ).toBe(true);
  });

  it("🔴 작성률은 분자도 반으로 거른다 — 분모만 줄이면 미작성이 100%로 가려진다", () => {
    const code = readFileSync(join(process.cwd(), "src/features/report-admin/server/queries.ts"), "utf8");
    // 분자 소스(lesson_reports)가 class_id를 읽어야 반 단위로 거를 수 있다.
    expect(
      /\.select\("teacher_name, report_date, covers_date, student_id, class_id"\)/.test(code),
      "작성률 분자(reps) select에서 class_id가 사라졌습니다. 분모(countedHere)만 미발송 반을 빼면 " +
        "그 반 보고서가 다른 반의 미작성을 메워(과거일 근사 min(작성건수,대상)) 진짜 미작성이 100%로 가려집니다.",
    ).toBe(true);
    // 분자와 면제(discharged)가 같은 걸러진 소스를 봐야 한다.
    expect(
      /const repsCounted = /.test(code) && /const reports = repsCounted/.test(code) && /discharged = new Set\([\s\S]{0,40}repsCounted/.test(code),
      "분자(reports)와 면제(discharged)는 반으로 거른 같은 소스(repsCounted)에서 만들어야 합니다 — " +
        "면제만 원본을 보면 미발송 반 보고서의 covers_date가 집계 대상 반의 의무를 잘못 면제합니다.",
    ).toBe(true);
  });

  it("🔴 게이트용 getTeachingClassIds에는 걸지 않는다(과거 보고서 수정·첨부·출결이 막힌다)", () => {
    const code = readFileSync(join(process.cwd(), "src/features/classes/server/delegation.ts"), "utf8");
    // getTeachingClassIds 본문만 잘라 본다 — 로스터용 getTeachingClasses는 값을 싣는 게 정상이다.
    const start = code.indexOf("export async function getTeachingClassIds");
    const end = code.indexOf("export async function getTeachingClasses");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end);
    expect(
      /report_?optout/i.test(body),
      "getTeachingClassIds는 **게이트**라 여기서 좁히면 '수업보고서 미발송' 반의 지난 보고서 수정·첨부·출결 기록이 막힙니다. " +
        "숨김은 로스터(getTeachingClasses 소비처)에서만.",
    ).toBe(false);
  });
});
