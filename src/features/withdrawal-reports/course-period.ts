import { isSpecialLecture } from "@/features/classes/special-lecture";

/** 달력 기준 온전한 개월 수 + 남은 일수. 월말은 해당 월의 마지막 날로 맞춘다. */
export function courseDuration(from: string, to: string): string {
  const parse = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00Z`) : new Date(NaN);
  const start = parse(from), end = parse(to);
  if (!Number.isFinite(+start) || !Number.isFinite(+end) || start.toISOString().slice(0, 10) !== from || end.toISOString().slice(0, 10) !== to || end < start) return "기간 확인 필요";
  let months = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth();
  const anniversary = (n: number) => {
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(start.getUTCDate(), last));
    return first;
  };
  if (anniversary(months) > end) months--;
  const days = Math.round((+end - +anniversary(months)) / 86400000);
  return `${months}개월, ${days}일`;
}

/** 그 과목에서 다닌 반 하나(지난 반 포함). 완료 보고서에 고정된 옛 이력엔 `isSpecial`이 없다 — 그땐 반 이름으로 판정한다. */
export type SubjectHistoryRow = { enrollmentId?: string; subject: string; className: string; startDate: string; endDate: string | null; isSpecial?: boolean };

/** 반 사이 공백을 '중단'으로 치는 기준 — 한 달 넘게 비었을 때(반 옮기며 생기는 주말·방학 며칠은 중단이 아니다). */
const afterBreak = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 31 * 86_400_000).toISOString().slice(0, 10);

/**
 * 수강기간 칸 — 그 반이 아니라 **그 과목의 전체 수강기간**(지난 반 포함). 원장 2026-10-29 *"수강기간도 해당 반에서 수강기간이라기보다
 * 해당 과목의 수강기간을 전체 보여줘야함. 지나간 반 포함 … 그래야 그 과목의 학생 역사를 볼 수 있으니까"*. 퇴원하는 반 칸은 그대로 마지막 반.
 * - 과목마다 첫 줄 = 그 과목 처음 시작일 ~ 퇴원일 (기간). 과목이 둘 이상이면 앞에 과목 이름.
 * - 반을 두 개 이상 거쳤으면 아래에 반마다 한 줄(시작 순) — 끝나지 않은 반은 퇴원일까지.
 * - 이력이 없는 과목(조회 실패·이전 보고서)은 지금 반 시작일로.
 * - 퇴원일 뒤에도 이어지는데 이 보고서가 끝내지 않는 수강(같은 과목의 다른 반을 계속 다님)은 뺀다 — 퇴원한 것처럼 보이지 않게(리뷰).
 * - 쉬었다가 다시 다닌 공백(한 달 넘게)이 있으면 첫 줄에 '중단 N회'(기간은 처음~퇴원일이라 공백이 들어 있다).
 * - 특강은 수강기간에 적지 않는다(원장 2026-11-02 *"특강은 수강기간을 적지말고, 특강 수강 x n회 같은 별도로"*) — 첫날·중단 계산에서도 빼고
 *   `specials`로 따로 낸다(판정 = `isSpecialLecture`). 특강만 다닌 과목은 특강이 곧 그 과목의 수강기간이다.
 */
export type CoursePeriod = { className: string; startDate: string; endDate: string };
export type SubjectPeriodGroup = {
  /** 과목이 둘 이상일 때만 과목 이름. */
  subjectLabel: string | null;
  first: string; until: string; duration: string; gaps: number;
  /** 그 과목에서 다닌 정규 반(시작 순) — 화면은 반 이름을 라벨처럼 따로 보인다(원장 2026-10-30). */
  classes: CoursePeriod[];
  /** 그 과목에서 들은 특강(시작 순) — 화면은 '특강 수강 × n회' 라벨 뒤 겹판으로 보인다. */
  specials: CoursePeriod[];
};

/** 특강 라벨 글자 — 화면과 글이 같은 문구를 쓴다. */
export const specialCourseLabel = (count: number) => `특강 수강 × ${count}회`;

/** 수강기간 칸의 내용(과목마다) — 화면(라벨)과 글(subjectPeriods)이 같은 계산을 쓴다. */
export function subjectPeriodGroups(
  courses: readonly { id?: string; subject: string; className: string; startDate: string }[],
  history: readonly SubjectHistoryRow[],
  effectiveDate: string,
  labelOf: (subject: string) => string,
): SubjectPeriodGroup[] {
  const subjects = [...new Set(courses.map(c => c.subject))];
  const endedIds = new Set(courses.flatMap(c => (c.id ? [c.id] : [])));
  return subjects.map(subject => {
    const rows = history.filter(h => h.subject === subject && h.startDate <= effectiveDate)
      .filter(h => !h.enrollmentId || endedIds.has(h.enrollmentId) || (h.endDate != null && h.endDate <= effectiveDate))
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.className.localeCompare(b.className, "ko"));
    const own = courses.filter(c => c.subject === subject);
    const regularRows = rows.filter(h => !isSpecialLecture(h));
    const specialRows = rows.filter(h => isSpecialLecture(h));
    // 보고서 스냅숏(own)엔 특강 토글 칸이 없다 — 토글만 켠 반도 이력으로 알아보게 수강 id로 잇는다.
    const specialIds = new Set(specialRows.flatMap(h => (h.enrollmentId ? [h.enrollmentId] : [])));
    const ownSpecial = (c: { id?: string; className: string }) => (!!c.id && specialIds.has(c.id)) || isSpecialLecture(c);
    const regularOwn = own.filter(c => !ownSpecial(c));
    const onlySpecial = !regularRows.length && !regularOwn.length;
    const spine = onlySpecial ? rows : regularRows;
    const starts = [...spine.map(h => h.startDate), ...(onlySpecial ? own : regularOwn).map(c => c.startDate)].sort();
    const first = starts[0] ?? effectiveDate;
    let gaps = 0;
    let reach = "";
    for (const h of spine) {
      if (reach && h.startDate > afterBreak(reach)) gaps++;
      const end = h.endDate && h.endDate < effectiveDate ? h.endDate : effectiveDate;
      if (end > reach) reach = end;
    }
    // 정규 반이 끝나고 특강만 다니다 퇴원하면 그 공백도 중단이다 — 뒤쪽 특강이 공백을 가리지 않게.
    if (!onlySpecial && reach && specialRows.length && effectiveDate > afterBreak(reach)) gaps++;
    const fromHistory = (h: SubjectHistoryRow): CoursePeriod => ({ className: h.className, startDate: h.startDate, endDate: h.endDate && h.endDate < effectiveDate ? h.endDate : effectiveDate });
    const fromOwn = (c: { className: string; startDate: string }): CoursePeriod => ({ className: c.className, startDate: c.startDate, endDate: effectiveDate });
    return {
      subjectLabel: subjects.length > 1 ? labelOf(subject) : null, first, until: effectiveDate, duration: courseDuration(first, effectiveDate), gaps,
      classes: regularRows.length ? regularRows.map(fromHistory) : regularOwn.map(fromOwn),
      specials: rows.length ? specialRows.map(fromHistory) : own.filter(ownSpecial).map(fromOwn),
    };
  });
}

export function subjectPeriods(
  courses: readonly { id?: string; subject: string; className: string; startDate: string }[],
  history: readonly SubjectHistoryRow[],
  effectiveDate: string,
  labelOf: (subject: string) => string,
): string {
  return subjectPeriodGroups(courses, history, effectiveDate, labelOf).map(g => {
    const head = `${g.subjectLabel ? `${g.subjectLabel}: ` : ""}${g.first} ~ ${g.until} (${g.duration}${g.gaps ? ` · 중단 ${g.gaps}회` : ""})`;
    const lines = g.classes.length < 2 ? [] : g.classes.map(c => `· ${c.className} ${c.startDate} ~ ${c.endDate}`);
    return [head, ...lines, ...(g.specials.length ? [`· ${specialCourseLabel(g.specials.length)}`] : [])].join("\n");
  }).join("\n");
}
