/**
 * 학생 목록 머리의 '일괄 출석'(빠른 출결) — 대상 산출 순수 함수(Vitest로 잠금).
 *
 * 원장 2026-08-18: *"수학 수업 보고서 표 모드에서 학생, 반 옆에 '일괄 출석' 라벨 추가. 일괄 출석
 * 누르면 전부 출석으로 체크. 추후에 지각·결석으로 담당이 변경 가능하게."* (+ 카드 모드도 같은 자리)
 *
 * 계약은 **ECS(영어 시트)에서 이미 확정된 것**을 그대로 따른다(2026-08-14,
 * [class-sheets/lib/bulk.ts](@/features/class-sheets/lib/bulk.ts) `planDayBulkAttendance`):
 *  · **빈 칸만 채운다(비파괴)** — 이미 출석·지각·결석이 찍힌 칸은 건드리지 않는다. 되돌릴 일이 안
 *    생기므로 확인창이 없다(원장이 ECS에서 "창 없이 한 번에"로 확정).
 *  · **대상 = 화면에 보이는 그 집합** — 목록에 그려진 학생 × 반 필터를 통과한 행. 표시와 대상이
 *    어긋나면 "화면엔 12명인데 28명이 출석 처리"가 된다.
 *  · **라벨에 대상 수를 밝힌다.** 0이면 비활성(누를 게 없다는 걸 눌러보기 전에 알게).
 *  · 값은 '출석' 하나뿐이라 고를 게 없다 — 지각·결석 **일괄은 만들지 않는다**(ECS에서 뺀 이유와 같다:
 *    값 고르는 단계가 생기면 창 열기→고르기→누르기 세 동작이 된다). 개별 학생을 지각·결석으로 바꾸는
 *    길은 알약([attendance-pills.tsx](./components/attendance-pills.tsx))에 그대로 열려 있다.
 *
 * 규칙 자체(반 없는 행 제외·조퇴/공결/보강 보존·중복 (학생×반) 제거)는 표뷰 일괄과 **같은 소스**를
 * 쓴다([bulk-attendance.ts](./bulk-attendance.ts)) — 두 일괄이 서로 다른 말을 하면 안 된다.
 * 🔴 비파괴는 이 계산이 아니라 **서버가 강제**한다(`setAttendanceBulk({ fillEmptyOnly: true })`) —
 *    원스크린은 출결을 재폴링하지 않아, 열어 둔 사이 데스크가 찍은 결석을 낡은 화면이 덮을 수 있다
 *    (2026-08-17 감사 P0-1). 여기 계산은 **라벨의 숫자**와 요청 범위를 정할 뿐이다.
 */
import { planBulkAttendance, type BulkAttCell } from "./bulk-attendance";
import { rowInClass } from "./grid";
import type { OneScreenStudent } from "./types";

export type QuickPresentPlan = {
  /** 실제로 기록할 칸(학생×반) — 아직 출결 기록이 없는 칸만. */
  cells: BulkAttCell[];
  /** 이미 출결이 있어 손대지 않는 칸 수 — 대상 0건일 때 "왜 0인지"를 화면이 말할 수 있게. */
  alreadyMarked: number;
};

/**
 * 표시 중인 학생 목록에서 '전원 출석' 대상을 뽑는다.
 * @param students 화면에 그려진 학생(이미 반·작성 필터를 통과한 `visible`).
 * @param classFilter 활성 반 필터(null="전체") — 학생 안의 **타 반 행**이 섞이지 않게 행 단위로 한 번 더 좁힌다.
 */
export function planQuickPresent(
  students: readonly OneScreenStudent[],
  classFilter: string | null,
): QuickPresentPlan {
  const rows = students.flatMap((s) =>
    s.subjects
      // 수업 나누기로 온 행(0351a)은 빼고 알약으로 한 칸씩 찍는다(종전 그대로). 예전엔 일괄 저장 게이트가 나누기를 못 봐
      // "N칸 출석"이 실제 기록과 갈렸다(거짓 집계) — 지금은 일괄도 나누기 표를 보지만(결정 #5) 동작은 바꾸지 않았다.
      .filter((su) => rowInClass(su, classFilter) && !su.splitIn)
      .map((su) => ({
        studentId: s.id,
        classId: su.classId,
        isMakeup: s.isMakeup,
        raw: su.attendanceRaw,
      })),
  );
  const plan = planBulkAttendance(rows, "present", { onlyEmpty: true });
  return {
    cells: plan.cells,
    // '이미 출석'·'이미 기록됨(지각·결석)'·'조퇴·공결·보강'은 전부 **이미 찍힌 칸**이라 한 수로 묶는다.
    // 반 없는 행(skippedNoClass)은 애초에 기록할 자리가 없는 행이라 여기 안 센다(다른 이야기 —
    // 그건 출석부에서도 못 찍는 행이다).
    alreadyMarked: plan.skippedSame + plan.skippedFilled + plan.skippedSpecial,
  };
}
