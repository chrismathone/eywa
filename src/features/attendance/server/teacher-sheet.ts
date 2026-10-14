import "server-only";
import { cache } from "react";
import { monthRange } from "@/lib/date-kst";
import { isModuleEnabled } from "@/lib/modules";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { foldedReason } from "@/lib/folded-read";
import { getTenantSettings } from "@/features/owner/server/queries";
import { getHomeroomSinceIndex } from "@/features/classes/server/teacher-as-of-queries";
import { buildHolidayMap } from "../calendar";
import { teacherSheetSalary, type SheetSalaryResult } from "../sheet-salary";
import { teacherSheetClasses } from "../teacher-sheet-classes";
import { TeacherSheetError } from "../teacher-sheet-error";
import { attendanceUnitSuffix, type AttendanceUnitSuffix } from "../unit-suffix";
import type { AttendanceSalaryRates } from "../salary-rates";
import { getAttendanceClassBilledAmounts, mergeAttendanceClassBilling, type AttendanceClassBilling } from "./class-billing";
import { attendanceReadContext } from "./read-context";
import { findMakeupPoolClass } from "./makeup-pool";
import { getMonthlyAttendanceMatrix, type AttendanceMatrix } from "./queries";
import { taughtByColumnState } from "./taught-by-db";

/**
 * **강사 한 명의 그 달 출석부(강사 전체 보기)** 를 서버에서 조립한다 — 프리랜서 명세서와 그 별지가 쓴다
 * (원장 2026-10-06 *"전부 통일 출석부 그대로"* · *"프리랜서만."*).
 *
 * 🔴 **출석부 화면(`app/(shell)/attendance/page.tsx` 강사 전체 보기)과 같은 호출을 같은 인자로** 부른다:
 *    반 목록 = `teacherSheetClasses`(화면과 공용) · 칸 = `getMonthlyAttendanceMatrix(달, 반, "month", 강사, 담임 시작일)` ·
 *    청구액·등록 차수·단가 = `getAttendanceClassBilledAmounts`(영어 반은 교시 담당별 몫) · 보이지 않는 '보강' 반 묶음.
 *    화면 쪽 조립을 바꾸면 여기도 같이 바꿔야 한다 — `teacher-sheet-wiring.test.ts`가 두 곳의 호출 모양을 잠근다.
 * 🔴 **이 조립은 금액이 된다** — 화면은 조회가 일부 실패해도 표를 살리려고 접지만, 여기서는 접힌 재료가 곧 틀린 금액이다.
 *    그래서 아래 여섯 경우엔 [`TeacherSheetError`](../teacher-sheet-error.ts)를 던진다(호출부는 산정하지 않고 사유를 보인다):
 *     ① 보는 사람이 **다른 강사의 보기**로 들어와 있다 — 아래 조회들은 보는 사람의 강사 렌즈(`effectiveTeacherId`)로 반을 좁힌다.
 *        렌즈가 대상 강사와 다르면 두 사람이 함께 가르치는 반만 남은 **부분 금액**이 오류 없이 나온다(적대 리뷰 2026-10-06).
 *     ② 담임 변경 기록을 못 읽었다(이력이 비면 그 달 뒤에 받은 반이 되돌아온다) ③ 대신 보강 귀속을 확인 못 했다
 *     ④ 보강 반을 못 읽었다 ⑤ 청구 조회가 재료(금액 이월·보강 반 청구)를 접었다
 *     ⑥ **조회 하나하나가 접은 재료** — 학원 설정(휴일·과목·기능 스위치가 기본값이 된다)과 반별 매트릭스의 담임 이력.
 *        🔴 ②의 머리 확인만으로는 부족하다: 서버 액션(명세서 발행) 안에선 요청 캐시가 없어 반마다 부르는 매트릭스가 담임 이력을
 *        **각자 다시** 읽는다 — 머리 한 번이 성공해도 그 반의 조회만 실패하면 넘긴 뒤의 칸까지 이 강사 몫으로 센다(재리뷰 2026-10-06).
 *        그래서 접은 쪽이 결과물에 표식을 남기고(`folded-read.ts` · 매트릭스 `degraded`) 여기서 전부 확인한다.
 * ⚠️ 화면과 다른 점은 **과목 필터가 없다**는 것뿐이다(명세서는 그 강사의 모든 과목 — 화면의 '전체 과목'과 같다).
 * ⚠️ 날짜축은 달력월 고정(강사 전체 보기와 같다). 표시용 반 이름 번역은 하지 않는다(특강 판정이 원래 이름을 읽는다).
 * 🔑 요청당 1회(React cache) — 명세서 데이터와 별지가 같은 조립을 나눠 쓴다.
 */
export type TeacherSheetGroup = {
  classId: string;
  className: string;
  subject: string | null;
  isSpecial: boolean;
  /** 보이지 않는 '보강' 반 묶음인가. */
  makeupPool: boolean;
  matrix: AttendanceMatrix;
};

export type TeacherSheet = {
  groups: TeacherSheetGroup[];
  billing: AttendanceClassBilling;
  /** 회차 정산 기능이 켜져 있나 — 꺼진 학원은 단가·등록 차수가 없어 실급여를 못 낸다. */
  sessionBillingOn: boolean;
  /** 표의 반들이 한 단위일 때만(영어만 U · 수학만 T). 섞이면 null. */
  unitSuffix: AttendanceUnitSuffix;
  /** 표에 선 반 가운데 담임이 바뀐 반(`teacherSheetClasses`의 `handovers` + 반 이름) — 명세서 '발행 전 확인' 재료. */
  handovers: { className: string; kind: "took" | "gave"; since: string | null }[];
};

const RETRY = "잠시 후 다시 열어 주세요.";

/** 접힌 재료가 하나라도 있으면 산정을 멈춘다 — 사유는 접은 쪽이 남긴 말 그대로(중복은 한 번만). */
function stopIfFolded(reasons: readonly (string | null | undefined)[]): void {
  const list = [...new Set(reasons.filter((r): r is string => !!r))];
  if (list.length > 0) throw new TeacherSheetError(`${list.join(" · ")} — 수업료를 산정하지 않았습니다. ${RETRY}`);
}

export const loadTeacherSheet = cache(async (tenantId: string, teacherId: string, month: string): Promise<TeacherSheet> => {
  // 로그인 없는 조립 문맥(강사평가 밤 집계 — read-context.ts)은 렌즈가 없고(관리자뷰와 같다) 학원 설정은 문맥이 읽어 둔 것이다.
  const readCtx = attendanceReadContext();
  if (readCtx && readCtx.tenantId !== tenantId) throw new TeacherSheetError("다른 지점의 출석부는 조립하지 않습니다.");
  // ① 보는 사람의 강사 렌즈 — 대상 강사와 다르면 아래 조회 전부가 그 사람 반으로 좁혀진다(같으면 결과도 같다).
  const lens = readCtx ? null : await effectiveTeacherId();
  if (lens && lens !== teacherId) {
    throw new TeacherSheetError("강사뷰 상태에서는 다른 선생님의 출석부 금액을 계산할 수 없습니다 — 관리자뷰로 돌아간 뒤 다시 열어 주세요.");
  }
  // 반 목록(경량) · 학원설정 · 담임 시작일 · 대신 보강 귀속 확인은 서로 독립(B4).
  const [base, settings, sinceIdx, taughtBy] = await Promise.all([
    getMonthlyAttendanceMatrix(month, null),
    readCtx ? Promise.resolve(readCtx.settings) : getTenantSettings(),
    getHomeroomSinceIndex(),
    taughtByColumnState(),
  ]);
  if (sinceIdx.incomplete) throw new TeacherSheetError(`담임 변경 기록을 읽지 못해 수업료를 산정하지 않았습니다 — ${RETRY}`);
  if (taughtBy === "unknown") throw new TeacherSheetError(`대신 보강 기록을 확인하지 못해 수업료를 산정하지 않았습니다 — ${RETRY}`);
  // ⑥ 학원 설정이 기본값으로 접혔거나 반 목록이 담임 이력 없이 만들어졌다.
  stopIfFolded([foldedReason(settings), ...(base.degraded ?? [])]);
  const { operations } = settings;
  const sessionBillingOn = isModuleEnabled(settings.modules.disabled, "session_billing");
  const scope = teacherSheetClasses({ classes: base.classes, teacherId, window: monthRange(month), sinceIdx });
  const matrices = await Promise.all(
    scope.classes.map((c) => getMonthlyAttendanceMatrix(month, c.id, "month", teacherId, scope.sinceByClass.get(c.id) ?? null)),
  );
  // ⑥ 반별 매트릭스가 각자 접은 재료(담임 이력 · 파생 출결의 휴일) — 서버 액션에선 위 머리 확인과 **다른 조회**다.
  stopIfFolded(matrices.flatMap((m) => m.degraded ?? []));
  const classById = new Map(base.classes.map((c) => [c.id, c]));
  const homeRoster = scope.classes.map((c, i) => ({ classId: c.id, studentIds: matrices[i]!.students.map((s) => s.id) }));

  // 보이지 않는 '보강' 반 — 찾기 → 명단 → 그 명단의 청구 판정(화면 `loadMakeupPool`과 같은 사슬).
  const loadMakeupPool = async () => {
    // ④ 화면은 "없음"과 "못 읽음"을 같은 null로 접지만, 여기서 접으면 보강 묶음의 실급여가 말없이 빠진다.
    const poolId = await findMakeupPoolClass(tenantId, teacherId, { strict: true }).catch(() => {
      throw new TeacherSheetError(`보강 반을 읽지 못해 수업료를 산정하지 않았습니다 — ${RETRY}`);
    });
    const matrix = poolId ? await getMonthlyAttendanceMatrix(month, poolId, "month", null, null, poolId) : null;
    stopIfFolded(matrix?.degraded ?? []);
    if (!poolId || !matrix || matrix.students.length === 0) return null;
    const billing = await getAttendanceClassBilledAmounts(
      month,
      [{ classId: poolId, studentIds: matrix.students.map((s) => s.id) }],
      { allowClassIds: [poolId] },
    );
    return { classId: poolId, matrix, billing };
  };
  const [homeBilling, pool] = await Promise.all([
    getAttendanceClassBilledAmounts(month, homeRoster, {
      teacherScope: {
        teacherId,
        classIds: base.classes.filter((c) => attendanceUnitSuffix(c.subject, operations.subjects) === "U").map((c) => c.id),
        holidays: Object.keys(buildHolidayMap(operations.holidays)),
        homeroomSinceByClass: Object.fromEntries(scope.sinceByClass),
      },
    }),
    loadMakeupPool(),
  ]);
  const billing = pool ? mergeAttendanceClassBilling(homeBilling, pool.billing) : homeBilling;
  // ⑤ 청구 조회가 접은 재료 — 이월이 비면 청구액 상한이, 보강 반 청구가 비면 그 묶음의 단가가 달라진다.
  stopIfFolded(billing.degraded ?? []);

  const groups: TeacherSheetGroup[] = scope.classes.map((c, i) => ({
    classId: c.id,
    className: c.className,
    subject: c.subject ?? null,
    isSpecial: classById.get(c.id)?.isSpecial ?? false,
    makeupPool: false,
    matrix: matrices[i]!,
  }));
  if (pool) {
    // 화면의 보강 묶음과 같다 — 과목이 하나가 아니라 단위 글자를 안 붙이고, 특강 판정도 없다.
    groups.push({ classId: pool.classId, className: "보강", subject: null, isSpecial: false, makeupPool: true, matrix: pool.matrix });
  }
  const suffixes = new Set(groups.map((g) => (g.makeupPool ? null : attendanceUnitSuffix(g.subject, operations.subjects))));
  return {
    groups,
    billing,
    sessionBillingOn,
    unitSuffix: suffixes.size === 1 ? [...suffixes][0]! : null,
    handovers: scope.handovers.map((h) => ({ className: classById.get(h.classId)?.className ?? "", kind: h.kind, since: h.since })),
  };
});

/**
 * 그 출석부의 **실급여**(줄 + 합계) — 화면 합계 행과 같은 식(`teacherSheetSalary`).
 * 회차 정산이 꺼진 학원은 단가·등록 차수를 싣지 않는다(화면이 그 열을 비우는 것과 같다 → 전 줄이 '단가 없음').
 */
export function sheetSalaryOf(
  sheet: TeacherSheet,
  rates: AttendanceSalaryRates,
  adjustRate?: (rate: number) => number,
): SheetSalaryResult {
  return teacherSheetSalary({
    groups: sheet.groups.map((g) => ({
      classId: g.classId,
      className: g.className,
      isSpecial: g.isSpecial,
      students: g.matrix.students.map((s) => ({ id: s.id, name: s.name, grade: s.grade })),
      marks: g.matrix.marks,
      units: g.matrix.units,
    })),
    billed: sheet.billing.billed,
    terms: sheet.sessionBillingOn ? sheet.billing.confirmedSessions : {},
    prices: sheet.sessionBillingOn ? sheet.billing.confirmedPrices : {},
    rates,
    ...(adjustRate ? { adjustRate } : {}),
  });
}
