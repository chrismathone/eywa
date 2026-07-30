/**
 * 표뷰 '일괄 입력'의 **출결** 계획 — 순수 함수(Vitest로 잠금).
 *
 * 출결은 이 팝오버의 다른 필드와 성질이 다르다. 진도·태도·교재는 화면 state를 고쳐 놓고 나중에
 * 저장하지만, **출결은 누르는 즉시 출석부(attendance_records)에 기록**된다 — 원스크린에서 되돌릴 방법이
 * 없다(pill 재클릭은 no-op, 기록 삭제는 출석부에서만). 그래서 "몇 건이 새로 기록되고 몇 건을 덮는지"를
 * 미리 세어 호출부가 확인을 받게 한다(침묵 금지).
 *
 * 🔴 **조퇴·공결·보강(raw가 3종 밖)은 절대 건드리지 않는다.** 인라인 pill이 그 값을 축약 3종으로 되쓰지
 *    못하게 막아 둔 것과 같은 이유다(attendance-pills.tsx) — 일괄이 그 가드를 우회하면 출석부에만 있던
 *    상태가 통째로 뭉개진다. 변경은 출석부에서.
 * 🔴 **반이 없는 행은 대상이 아니다.** 출결 원장의 키는 (학생·반·날짜)라, 수동 추가 보강 학생이나
 *    같은 과목을 두 반에서 듣는 모호 행(classId=null)은 기록할 자리가 없다(pill도 같은 조건으로 숨는다).
 */

/** 일괄로 찍을 수 있는 상태 — 인라인 pill과 **같은 3종**. 조퇴·공결·보강은 출석부 전용(위 주석). */
export const BULK_ATTENDANCE_STATUSES = ["present", "late", "absent"] as const;
export type BulkAttendanceStatus = (typeof BULK_ATTENDANCE_STATUSES)[number];

export const BULK_ATTENDANCE_LABEL: Record<BulkAttendanceStatus, string> = {
  present: "출석",
  late: "지각",
  absent: "결석",
};

const isBasic = (raw: string | null | undefined): boolean =>
  BULK_ATTENDANCE_STATUSES.includes((raw ?? "") as BulkAttendanceStatus);

/** 일괄 출결 대상 행(경량 shape — 표뷰 GridRow에서 뽑아 넣는다). */
export type BulkAttRow = {
  studentId: string;
  /** 이 행(반)의 id — null/미지정이면 기록할 자리가 없다. */
  classId?: string | null;
  /** 수동 추가 보강 학생(로스터 밖 — 반 자체가 없다). */
  isMakeup?: boolean;
  /** 현재 raw 상태(null=기록 없음). */
  raw?: string | null;
};

/** 실제로 서버에 쓸 셀 1건 — 출결 원장 키(학생·반). 날짜는 호출부가 하나로 고정한다. */
export type BulkAttCell = { studentId: string; classId: string };

export type BulkAttPlan = {
  cells: BulkAttCell[];
  /** 기존 기록을 덮는 건수 — 확인 문구에 실수를 밝히기 위한 계산. */
  overwrite: number;
  skippedNoClass: number;
  skippedSpecial: number; // 조퇴·공결·보강 — 출석부에서만 변경
  skippedSame: number; // 이미 그 상태(재클릭 no-op과 동일)
  skippedFilled: number; // '빈 칸만 채우기'인데 이미 기록이 있음
};

/**
 * 이 행에 출결을 **찍을 수 있는가** — 반이 있고, raw가 3종(또는 미기록)인 행.
 * 팝오버가 "출결 N행" 안내를 띄우는 기준이라 상태·onlyEmpty와 무관한 구조적 판정만 본다.
 */
export function countMarkableRows(rows: readonly BulkAttRow[]): number {
  const seen = new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (r.isMakeup || !r.classId) continue;
    if (r.raw && !isBasic(r.raw)) continue;
    const k = `${r.studentId}::${r.classId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    n++;
  }
  return n;
}

/**
 * 일괄 출결 계획. 대상 행은 호출부가 이미 좁혀 놓은 집합(선택 행 없으면 표시 전체)과 **같아야** 한다 —
 * 화면과 다른 집합에 쓰면 "보이는 건 5명인데 8명이 결석 처리"가 된다.
 *
 * ⚠️ 같은 (학생·반)이 두 행으로 나올 수 있다(다과목 로스터 조립). 출결 원장은 한 칸이므로 **중복 제거**
 *    하고, 건너뛴 사유도 한 번만 센다(토스트 숫자가 부풀지 않게).
 */
export function planBulkAttendance(
  rows: readonly BulkAttRow[],
  status: BulkAttendanceStatus,
  opts: { onlyEmpty: boolean },
): BulkAttPlan {
  const plan: BulkAttPlan = {
    cells: [],
    overwrite: 0,
    skippedNoClass: 0,
    skippedSpecial: 0,
    skippedSame: 0,
    skippedFilled: 0,
  };
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.isMakeup || !r.classId) {
      plan.skippedNoClass++;
      continue;
    }
    const key = `${r.studentId}::${r.classId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const raw = r.raw ?? null;
    if (raw && !isBasic(raw)) {
      plan.skippedSpecial++;
      continue;
    }
    if (raw === status) {
      plan.skippedSame++;
      continue;
    }
    if (opts.onlyEmpty && raw) {
      plan.skippedFilled++;
      continue;
    }
    if (raw) plan.overwrite++;
    plan.cells.push({ studentId: r.studentId, classId: r.classId });
  }
  return plan;
}

/** 건너뛴 사유 요약 — 토스트/확인 문구 공용(사유를 말하지 않으면 "눌렀는데 무반응"이 된다). */
export function describeAttendanceSkips(plan: BulkAttPlan): string {
  return [
    plan.skippedSame ? `이미 같은 상태 ${plan.skippedSame}` : "",
    plan.skippedFilled ? `이미 기록됨 ${plan.skippedFilled}` : "",
    plan.skippedSpecial ? `조퇴·공결·보강 ${plan.skippedSpecial}` : "",
    plan.skippedNoClass ? `반 없음 ${plan.skippedNoClass}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
