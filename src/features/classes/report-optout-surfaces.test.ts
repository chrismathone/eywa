/**
 * '수업보고서 미발송'(0174a)이 **표면 하나에서 빠지는 것**을 막는 회귀 테스트.
 *
 * 이 기능의 유일한 실패 모드는 #77 — "화면에선 숨겼는데 다른 데선 보인다"이다. 실제 소비처가 7곳이고
 * (작성률 · 영어 작성률 · 오늘 미작성 신호 · 로스터 · 직접 발송 · 반 구성 대조 · 미발송 재촉 · 출결 파생)
 * 그중 하나라도 놓치면 원장 화면에서 숫자가 갈리거나 강사가 여전히 그 반을 본다.
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
  { path: "src/features/onescreen/server/roster.ts", why: "강사 보고서 작성 화면의 반 목록(요구 ①)" },
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
