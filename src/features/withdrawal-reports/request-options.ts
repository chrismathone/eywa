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
 * 승인 계획(`reportApprovalPlan` — 후보·관리자 승인 생략)은 이 결과의 approvalSubjects만 보므로 창·기본 선택이 함께 따른다.
 */
export function narrowApprovalSubjects(staff: readonly StaffOption[], approverIds: readonly string[]): StaffOption[] {
  const listed = new Set(approverIds);
  const owned = new Set(staff.filter(u => listed.has(u.id) && canRequestReport(u.role)).flatMap(u => u.approvalSubjects ?? u.subjects));
  if (!owned.size) return [...staff];
  return staff.map(u => listed.has(u.id) ? u : { ...u, approvalSubjects: (u.approvalSubjects ?? u.subjects).filter(s => !owned.has(s)) });
}
/**
 * 보고서 하나(작성 강사)의 승인 계획 — 원장 2026-11-03 *"작성 강사가 그 과목 관리자 본인이면 관리자 승인 생략"*, **보고서마다** 판정한다.
 * - 보고서 과목 = DB가 보고서에 싣는 과목과 같은 규칙: 작성 강사가 한 명이면 고른 반 전부, 여럿이면 그 강사가 담임인 반(`request_withdrawal_report_group`).
 * - 생략(`skip`) = 작성 강사가 관리자·매니저(원장·운영자 계정 아님)이고 그 보고서 과목을 **모두** 승인 과목으로 가진다.
 * - 후보(`candidates`) = 작성 강사 본인을 뺀 관리자급 중 그 보고서의 **작성 강사가 맡지 않은 과목**을 승인하는 사람
 *   (같은 묶음의 다른 작성 강사도 후보가 될 수 있다 — EiE·일반 영어처럼 같은 과목에 작성자가 둘이면 관리자인 작성자가 평강사 보고서를 승인한다).
 * - 승인 과목 = `approvalSubjects`(직원 과목 범위 덮어쓰기 → 학원 설정 '퇴원보고서 승인자' 좁히기까지 반영된 값 — `reportStaff`) · 없으면 담당 과목.
 * 🔴 침산 지점 superadmin(lsy93@gmail.com · st2000423@gmail.com 등)을 여기에 넣으면 안 된다 — `reportStaff`가 역할을 admin으로, 승인 과목을 빈 값으로 넘겨
 *    후보에서도 생략에서도 빠진다. `role`을 실제 system_role로 바꾸거나 다른 직원 목록을 넘기면 이 보호가 사라진다.
 */
export type ReportApproval = { teacherId: string; subjects: string[]; skip: boolean; candidates: StaffOption[] };
const approves = (u: Pick<StaffOption, "approvalSubjects" | "subjects">, subject: string) => (u.approvalSubjects ?? u.subjects).includes(subject);
export function reportApprovalPlan(
  staff: readonly StaffOption[],
  courses: readonly Pick<CourseSnapshot, "subject" | "teacherId">[],
  teacherIds: readonly string[],
): ReportApproval[] {
  return teacherIds.map(teacherId => {
    const own = teacherIds.length === 1 ? courses : courses.filter(c => c.teacherId === teacherId);
    const subjects = [...new Set(own.map(c => c.subject))];
    const writer = staff.find(u => u.id === teacherId);
    const managed = writer && canRequestReport(writer.role) && writer.role !== "master" ? subjects.filter(s => approves(writer, s)) : [];
    const skip = subjects.length > 0 && managed.length === subjects.length;
    const rest = subjects.filter(s => !managed.includes(s));
    const candidates = skip ? [] : staff.filter(u => canRequestReport(u.role) && u.id !== teacherId && rest.some(s => approves(u, s)));
    return { teacherId, subjects, skip, candidates };
  });
}
/** 창에 보일 승인 관리자 후보 — 생략이 아닌 보고서들의 후보 합집합(한 사람이 여러 보고서를 맡을 수 있다). */
export function approverOptions(plan: readonly ReportApproval[]): StaffOption[] {
  const seen = new Map<string, StaffOption>();
  for (const p of plan) for (const u of p.candidates) if (!seen.has(u.id)) seen.set(u.id, u);
  return [...seen.values()];
}
/** 기본 선택 — 후보 전원(원장 승인 칸은 없다 — 원장 2026-11-03). */
export function defaultApproverIds(plan: readonly ReportApproval[]) {
  return approverOptions(plan).map(u => u.id);
}
/**
 * 고른 관리자 → 보고서마다 승인 관리자(DB `reportManagerIds`) — 생략 보고서는 빈 목록, 그 밖은 그 보고서 후보 중 고른 사람.
 * `missing` = 고른 사람이 하나도 안 걸린(승인자가 없는) 보고서의 작성 강사 — 요청을 막는다.
 */
export function reportManagerIds(plan: readonly ReportApproval[], selected: readonly string[]): { byTeacher: Record<string, string[]>; missing: string[] } {
  const byTeacher: Record<string, string[]> = {};
  const missing: string[] = [];
  for (const p of plan) {
    byTeacher[p.teacherId] = p.skip ? [] : p.candidates.filter(u => selected.includes(u.id)).map(u => u.id);
    if (!p.skip && !byTeacher[p.teacherId].length) missing.push(p.teacherId);
  }
  return { byTeacher, missing };
}
