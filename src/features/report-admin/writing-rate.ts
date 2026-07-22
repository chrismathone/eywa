/**
 * 원장 보고서 관리 — 강사별 작성률 순수 헬퍼(5단계-2 Part B, edutrix WeeklyTeacherSummary 압축).
 * 이번 주 요일별 + 주간 **작성률(작성/대상)** — 오늘뿐 아니라 월~일·주간 합계도 %+n/n 표시(원장 요청 2026-07-11).
 * 서버가 raw(작성기록·오늘대상·과거일 대상)를 조립해 넘기면 여기서 버킷팅·작성률·정렬(worst 먼저).
 * CLAUDE.md: 계산 함수 분리 + Vitest.
 *
 * 대상(분모) 산출: 오늘 = 정밀(활성 수강생 − 결석, target∩reported). 과거일 = 서버가 주간 스케줄로 계산한
 * 대상 수(dailyTargets) + 작성분은 `min(그날 작성건수, 대상)` 근사(캡으로 >100% 방지). 미래일·무수업 = null("·").
 */

export type DailyCell = {
  date: string;
  count: number; // 그날 작성 건수(raw, 참고·툴팁)
  target: number | null; // 그날 대상 학생 수 (null = 미래/수업 없음/오늘 아직 시작 전 → "·")
  written: number; // 대상 대비 작성(오늘=정밀, 과거=min(count,target))
  rate: number | null; // written/target*100(반올림) — target 0/null → null
  // 오늘인데 아직 첫 수업 전 = 대상 null이지만 **"수업 없음"이 아니다**(뒤에 수업이 있다).
  pending?: boolean;
};

export type TodayTarget = {
  teacher: string;
  target: number; // 오늘 대상(강사 반 활성 수강생 − 결석)
  written: number; // 그중 오늘 작성됨(정밀)
  missing: string[]; // 미작성 학생 이름(대표)
};

/** 과거일 대상 — 서버가 주간 스케줄+결석으로 계산(강사×날짜). 오늘은 TodayTarget으로 별도 전달. */
export type DailyTarget = { teacher: string; date: string; target: number };

/**
 * 오늘 **아직 시작 안 한** 수업(강사별) — 분모(대상)에는 안 들어가지만 "수업 없음"과 구분하려고 따로 받는다.
 * ⚠️ 시작 전 수업을 대상에 넣으면 하루 시작 시점에 전 강사가 0%·전교생 미작성으로 뜬다(분모 유지가 맞다).
 */
export type TodayPending = { teacher: string; classes: number; firstStart: string };

export type TeacherRate = {
  teacher: string;
  daily: DailyCell[]; // dates 순서대로
  weekWritten: number;
  weekTarget: number;
  weekRate: number | null; // weekWritten/weekTarget*100 — 대상 0 → null
  todayTarget: number;
  todayWritten: number;
  todayMissing: string[];
  todayRate: number | null; // written/target*100(반올림), 대상 0 → null
  // 오늘 시작 전 수업이 남아 있으면 그 요약(첫 수업 시각·반 수). 없으면 null = 진짜 "수업 없음".
  todayPending: TodayPending | null;
};

/**
 * 강사별 작성률 조립.
 * @param dates 이번 주 7일(오름차순 월→일)
 * @param reports 작성기록(teacher×date×student) — 강사 집합 + 요일별 **작성 학생 수**
 *   🔴 학생 단위로 센다(보고서 건수 아님). 분모(dailyTargets)가 **학생 수**라 단위를 맞춰야 한다 —
 *   0134a로 보고서가 반 단위가 되면서 같은 날 정규+특강을 들은 학생이 2건을 만들고, 건수로 세면
 *   한 학생이 두 번 세어져 작성률이 실제보다 높게 나온다(다과목 학생도 원래 같은 문제였다).
 * @param todayTargets 오늘 대상/작성/미작성(정밀)
 * @param dailyTargets 과거일 대상(강사×날짜) — 주간 스케줄 기반
 * @param todayDate 오늘(YYYY-MM-DD) — 이 날짜 셀은 todayTargets(정밀)로, 그 이후는 null(미래)
 * @param todayPendings 오늘 시작 전 수업(강사별) — 분모엔 안 들어가고 "수업 없음"과의 구분에만 쓴다
 * 정렬 = 오늘 작성률 낮은 순(worst 먼저), 동률이면 주간 작성률 낮은 순.
 */
export function computeWritingRates(
  dates: string[],
  reports: { teacher: string; date: string; studentId?: string | null }[],
  todayTargets: TodayTarget[],
  dailyTargets: DailyTarget[],
  todayDate: string,
  todayPendings: TodayPending[] = [],
): TeacherRate[] {
  const teachers = new Set<string>();
  reports.forEach((r) => teachers.add(r.teacher));
  todayTargets.forEach((t) => teachers.add(t.teacher));
  dailyTargets.forEach((t) => teachers.add(t.teacher));
  // 오늘 수업이 아직 안 시작된 강사는 작성 기록도 대상도 없을 수 있다 — 여기서 넣어야 행이 사라지지 않는다.
  todayPendings.forEach((t) => teachers.add(t.teacher));

  // (teacher,date) → 작성 **학생 수**. 같은 학생의 여러 보고서(정규+특강, 다과목)는 1로 친다.
  // studentId가 없는 호출(구 픽스처·테스트)은 행마다 고유 키를 만들어 예전처럼 건수로 센다.
  const seen = new Map<string, Set<string>>();
  reports.forEach((r, i) => {
    const k = `${r.teacher} ${r.date}`;
    const set = seen.get(k) ?? new Set<string>();
    set.add(r.studentId ?? `#${i}`);
    seen.set(k, set);
  });
  const counts = new Map<string, number>([...seen].map(([k, set]) => [k, set.size]));
  const todayByTeacher = new Map(todayTargets.map((t) => [t.teacher, t]));
  const dailyTargetMap = new Map(dailyTargets.map((t) => [`${t.teacher} ${t.date}`, t.target]));
  const pendingByTeacher = new Map(todayPendings.map((t) => [t.teacher, t]));

  const rows: TeacherRate[] = [...teachers].map((teacher) => {
    const today = todayByTeacher.get(teacher);
    const pending = pendingByTeacher.get(teacher) ?? null;
    let weekWritten = 0;
    let weekTarget = 0;
    const daily: DailyCell[] = dates.map((date) => {
      const count = counts.get(`${teacher} ${date}`) ?? 0;
      let target: number | null;
      let written: number;
      if (date === todayDate) {
        // 오늘 = 정밀(활성 수강생−결석, target∩reported).
        target = today ? today.target : null;
        written = today ? today.written : 0;
      } else if (date > todayDate) {
        // 미래일 = 아직 수업 전 → 대상 없음("·").
        target = null;
        written = 0;
      } else {
        // 과거일 = 주간 스케줄 기반 대상 + min(작성건수, 대상) 근사.
        const t = dailyTargetMap.get(`${teacher} ${date}`);
        target = t ?? null;
        written = target != null ? Math.min(count, target) : 0;
      }
      const rate = target && target > 0 ? Math.round((written / target) * 100) : null;
      if (target != null) {
        weekTarget += target;
        weekWritten += written;
      }
      // 오늘 칸이 비었는데 뒤에 수업이 남았으면 "수업 없음"이 아니라 "수업 전"이다(거짓 표기 방지).
      const isPending = date === todayDate && (target == null || target === 0) && pending != null;
      return isPending ? { date, count, target, written, rate, pending: true } : { date, count, target, written, rate };
    });
    return {
      teacher,
      daily,
      weekWritten,
      weekTarget,
      weekRate: weekTarget > 0 ? Math.round((weekWritten / weekTarget) * 100) : null,
      todayTarget: today?.target ?? 0,
      todayWritten: today?.written ?? 0,
      todayMissing: today?.missing ?? [],
      todayRate: today && today.target > 0 ? Math.round((today.written / today.target) * 100) : null,
      // 시작된 수업이 있어도(0/8) 뒤에 남은 수업이 있으면 그대로 넘긴다 — "아직 진행 중"을 툴팁에 쓴다.
      todayPending: pending,
    };
  });

  // worst 먼저: 오늘 대상 있는 강사 중 작성률 낮은 순 → 대상 없는(null) 강사는 뒤로(주간 작성률 desc).
  return rows.sort((a, b) => {
    if (a.todayRate == null && b.todayRate == null) return (b.weekRate ?? -1) - (a.weekRate ?? -1);
    if (a.todayRate == null) return 1;
    if (b.todayRate == null) return -1;
    return a.todayRate - b.todayRate || (a.weekRate ?? 101) - (b.weekRate ?? 101);
  });
}
