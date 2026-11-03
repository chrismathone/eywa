import { canRequestReport, type CourseSnapshot, type StaffOption } from "./model";

/**
 * 퇴원보고서는 **과목 단위**다(원장 2026-10-30 *"한 과목에 대해 하나의 반이라도 퇴원보고서를 요청한다면, 자동으로 다른반까지 함께 귀속"*).
 * 특강도 예외가 아니다(따로 끝낼 반은 수강기간을 정해 둔다). EiE만 사업자가 달라 영어와 따로 묶는다.
 */
const courseGroupKey = (c: Pick<CourseSnapshot, "subject" | "eie">) => (c.eie ? `${c.subject}:eie` : c.subject);

/** 반 하나를 켜거나 끄면 같은 과목 반이 함께 따라간다. */
export function toggleCourseGroup(courses: readonly CourseSnapshot[], selected: readonly string[], id: string) {
  const target = courses.find(c => c.id === id);
  if (!target) return [...selected];
  const group = courses.filter(c => courseGroupKey(c) === courseGroupKey(target)).map(c => c.id);
  return selected.includes(id) ? selected.filter(x => !group.includes(x)) : [...new Set([...selected, ...group])];
}

/**
 * 안내 문구용 — 고른 과목마다 함께 종료되는 수업 이름(원장 2026-11-02 *"같은 과목의 이름 뜨면서 해당 수업 모두 종료라는거 알려줘"* —
 * 권하윤 MS2A만 끝나고 짝 JJ2A가 남은 일 뒤). 반이 하나뿐인 과목도 적는다.
 */
export function subjectEndGroups(courses: readonly Pick<CourseSnapshot, "subject" | "eie" | "className">[], labels: Readonly<Record<string, string>>) {
  const groups = new Map<string, { name: string; classNames: string[] }>();
  for (const c of courses) {
    const key = courseGroupKey(c);
    const group = groups.get(key) ?? groups.set(key, { name: `${labels[c.subject] ?? c.subject}${c.eie ? " EiE" : ""}`, classNames: [] }).get(key)!;
    group.classNames.push(c.className);
  }
  return [...groups.values()];
}

/**
 * 작성 강사 기본값 — 과목마다 한 명. '수업보고서 미발송' 반 담임은 쓰지 않고 메인반에 딸린다.
 * 메인반이 여럿이면 가장 먼저 시작한 반의 담임이다(창에서 바꿀 수 있다). 빠진 담임의 반도 종료 대상에는 남는다(DB가 그룹의 `enrollment_ids`로 종료).
 */
export function reportAuthorIds(courses: readonly Pick<CourseSnapshot, "subject" | "eie" | "teacherId" | "reportOptout" | "startDate">[]) {
  const best = new Map<string, (typeof courses)[number]>();
  for (const c of courses) {
    if (!c.teacherId) continue;
    const key = courseGroupKey(c);
    const cur = best.get(key);
    if (!cur || Number(!!c.reportOptout) < Number(!!cur.reportOptout) || (!!c.reportOptout === !!cur.reportOptout && c.startDate < cur.startDate)) best.set(key, c);
  }
  return [...new Set([...best.values()].map(c => c.teacherId!))];
}
/**
 * 학원 설정 '퇴원보고서 승인자'(`specialAccess.withdrawalApproverIds`)로 승인 과목을 좁힌다 — 지정한 사람이 승인 담당인 과목은
 * 다른 사람의 승인 과목에서 뺀다(원장 2026-10-30 *"수학의 경우 허은진 부원장 한명만"*). 지정한 사람이 없는 과목은 그대로.
 * 승인 후보 판정(`requestApprovers`)은 이 결과의 approvalSubjects만 보므로 창·기본 선택이 함께 따른다.
 */
export function narrowApprovalSubjects(staff: readonly StaffOption[], approverIds: readonly string[]): StaffOption[] {
  const listed = new Set(approverIds);
  const owned = new Set(staff.filter(u => listed.has(u.id) && canRequestReport(u.role)).flatMap(u => u.approvalSubjects ?? u.subjects));
  if (!owned.size) return [...staff];
  return staff.map(u => listed.has(u.id) ? u : { ...u, approvalSubjects: (u.approvalSubjects ?? u.subjects).filter(s => !owned.has(s)) });
}
/** 기본 선택 — 과목 관리자 전원(원장 승인 칸은 없다 — 원장 2026-11-03). */
export function defaultApproverIds({ candidates }: Pick<ReturnType<typeof requestApprovers>, "candidates">) {
  return candidates.map(u => u.id);
}
/** 작성 강사가 그 과목 관리자인 과목 — 그 과목은 관리자 승인을 생략한다(원장 2026-11-03). 원장이 담임이면 해당 없다(관리자가 승인). */
export function selfManagedSubjects(
  staff: readonly StaffOption[],
  courses: readonly Pick<CourseSnapshot, "subject" | "teacherId">[],
  teacherIds: readonly string[],
) {
  return [...new Set(courses.filter(c => c.teacherId && teacherIds.includes(c.teacherId) && staff.some(u => u.id === c.teacherId
    && canRequestReport(u.role) && u.role !== "master" && (u.approvalSubjects ?? u.subjects).includes(c.subject))).map(c => c.subject))];
}

/**
 * 승인 관리자 후보 — 작성자를 생략한 반도 종료하므로 종료 대상 전체 과목에서 고른다(작성 강사 본인은 빼고).
 * 원장 2026-11-03: 원장 승인 칸은 없다. **작성 강사가 그 과목 관리자면 그 과목은 관리자 승인을 생략**한다(제출 = 관리자 승인).
 * - 모든 과목이 그렇다(`skipAll`) → 승인 관리자 0명 · 요청을 막지 않는다(DB s2_0020이 관리자 0명 묶음을 받는다).
 * - 섞여 있다 → 나머지 과목의 관리자가 묶음의 모든 보고서를 승인한다(승인 관리자는 묶음 단위다).
 * 🔴 침산 지점 superadmin(lsy93@gmail.com · st2000423@gmail.com 등)을 여기에 넣으면 안 된다 — `reportStaff`가 역할을 admin으로, 승인 과목을 빈 값으로 넘겨 후보에서 빠진다.
 *    `role`을 실제 system_role로 바꾸거나 다른 직원 목록을 넘기면 이 보호가 사라진다. 관리자 승인 생략도 같은 이유로 운영자 계정에겐 생기지 않는다.
 */
export function requestApprovers(
  staff: readonly StaffOption[],
  courses: readonly Pick<CourseSnapshot, "subject" | "teacherId">[],
  subjects: readonly string[],
  teacherIds: readonly string[],
): { candidates: StaffOption[]; selfManaged: string[]; skipAll: boolean } {
  const hasAuthor = courses.some(c => c.teacherId && teacherIds.includes(c.teacherId));
  const authorSubjects = new Set(hasAuthor ? courses.filter(c => subjects.includes(c.subject)).map(c => c.subject) : []);
  const self = new Set(selfManagedSubjects(staff, courses, teacherIds));
  const approves = (u: StaffOption, subject: string) => (u.approvalSubjects ?? u.subjects).includes(subject);
  const candidates = staff.filter(u => canRequestReport(u.role) && !teacherIds.includes(u.id) && [...authorSubjects].some(s => !self.has(s) && approves(u, s)));
  const selfManaged = [...authorSubjects].filter(s => self.has(s));
  return { candidates, selfManaged, skipAll: authorSubjects.size > 0 && selfManaged.length === authorSubjects.size };
}
