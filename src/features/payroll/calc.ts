// 급여 계산 순수 함수 — DB fetch와 분리해 Vitest 가능(#Q1). queries.ts/actions.ts가 사용.

/** "HH:MM" 두 시각의 (end - start) 시간(소수). 음수면 0으로 보지 않고 그대로(데이터 이상은 호출부 책임). */
export function scheduleHours(startTime: string, endTime: string): number {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  return eh + em / 60 - (sh + sm / 60);
}

export type Schedule = { class_id: string; start_time: string; end_time: string };

/** 반별 "평균 세션 시간" — 다중 요일 schedule이면 합 / 개수(한 세션의 대표 시간). */
export function aggregateClassHours(schedules: Schedule[]): Map<string, number> {
  const sum = new Map<string, number>();
  const count = new Map<string, number>();
  for (const s of schedules) {
    sum.set(s.class_id, (sum.get(s.class_id) ?? 0) + scheduleHours(String(s.start_time), String(s.end_time)));
    count.set(s.class_id, (count.get(s.class_id) ?? 0) + 1);
  }
  const avg = new Map<string, number>();
  for (const [cid, total] of sum) avg.set(cid, total / (count.get(cid) ?? 1));
  return avg;
}

/** 출석 세션들(반,날짜) → 고유 세션만 모아 반 평균시간 합. 같은 세션의 학생 N명 중복 제거. */
export function sumSessionHours(
  sessions: { classId: string; date: string }[],
  classHours: Map<string, number>,
): number {
  const unique = new Set<string>();
  for (const s of sessions) unique.add(`${s.classId}::${s.date}`);
  let total = 0;
  for (const key of unique) {
    const cid = key.slice(0, key.indexOf("::"));
    total += classHours.get(cid) ?? 1; // schedule 미상이면 1시간으로 보수적 가정
  }
  return total;
}

export type PayrollAmounts = { baseAmount: number; hoursWorked: number; hourlyAmount: number };

/** 시간·시급·월기본 → 정산 금액(시간 2자리 반올림, 시급분 원단위 반올림). */
export function computePayrollAmounts(args: {
  monthlyBase: number;
  hourlyRate: number;
  totalHours: number;
}): PayrollAmounts {
  return {
    baseAmount: args.monthlyBase,
    hoursWorked: Math.round(args.totalHours * 100) / 100,
    hourlyAmount: Math.round(args.totalHours * args.hourlyRate),
  };
}

/** 최종 지급액 = 기본 + 시급분 + 보너스 − 공제. */
export function payrollTotal(args: {
  baseAmount: number;
  hourlyAmount: number;
  bonus?: number;
  deduction?: number;
}): number {
  return args.baseAmount + args.hourlyAmount + (args.bonus ?? 0) - (args.deduction ?? 0);
}
