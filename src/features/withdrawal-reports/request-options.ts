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
 * 관리자 승인을 맡을 수 있는 역할 — 관리자·매니저뿐이다. **원장급(master)은 어떤 경우에도 아니다**(원장 2026-11-05 *"관리자 승인에 '원일' 넣지 말것 …
 * 원장이상급은 뺴기로 했는데 자꾸 들어가있네"*). 운영자 계정(superadmin)은 `reportStaff`가 역할을 admin으로, 승인 과목을 빈 값으로 넘기고
 * '퇴원보고서 승인자' 표시도 하지 않는다.
 */
const approverRole = (u: Pick<StaffOption, "role">) => canRequestReport(u.role) && u.role !== "master";
/**
 * 학원 설정 '퇴원보고서 승인자'(`specialAccess.withdrawalApproverIds`) — 사람마다 `withdrawalApprover`를 단다
 * (원장 2026-10-30 *"수학의 경우 허은진 부원장 한명만"* · 2026-11-05 *"항상 '정유진' 혹은 '허은진'. 지정된 사람으로"*):
 * `true` = 지정된 관리자·매니저 · `false` = 명단이 있는데 이 사람은 아님 · 없음 = 명단 자체가 없다(종전 — 과목 관리자 전원 · 원장급 제외).
 * 지정한 사람이 있으면 관리자 승인은 **그 사람들 중에서만** 나온다(`reportApprovalPlan`). 다른 사람의 승인 과목 좁히기는 종전대로 둔다
 * (지정이 있으면 승인 계획은 지정 밖 사람의 과목을 보지 않는다 — 과목 칸에 기대지 않으려고).
 * 🔴 명단은 있는데 유효한 사람이 0명(퇴사·비활성 · 평강사·원장급만 · 운영자 계정만)이면 **모두 `false`** — '승인자 없음'으로 요청을 막는다
 *    (지정 밖 관리자로 조용히 돌아가면 김그린이 쓴 영어 보고서가 생략된다 — 리뷰 2026-11-06). `configured` = 원본 명단이 비어 있지 않은가
 *    (`reportStaff`가 운영자 계정을 걸러 낸 뒤에도 원본 기준으로 넘긴다).
 * 원장급(master)은 명단에 있어도 지정하지 않는다. 운영자 계정은 부르는 쪽(`reportStaff`)이 명단에서 뺀다.
 */
export function narrowApprovalSubjects(staff: readonly StaffOption[], approverIds: readonly string[], configured = approverIds.length > 0): StaffOption[] {
  const listed = new Set(staff.filter(u => approverIds.includes(u.id) && approverRole(u)).map(u => u.id));
  if (!configured) return [...staff];
  if (!listed.size) return staff.map(u => ({ ...u, withdrawalApprover: false }));
  const owned = new Set(staff.filter(u => listed.has(u.id)).flatMap(u => u.approvalSubjects ?? u.subjects));
  return staff.map(u => listed.has(u.id) ? { ...u, withdrawalApprover: true } : { ...u, withdrawalApprover: false, approvalSubjects: (u.approvalSubjects ?? u.subjects).filter(s => !owned.has(s)) });
}
/** 학원 설정 '퇴원보고서 승인자' 명단이 있는가(유효한 사람이 0명이어도 — `narrowApprovalSubjects`가 단 표시로 본다). */
export function approverListConfigured(staff: readonly Pick<StaffOption, "withdrawalApprover">[]) {
  return staff.some(u => u.withdrawalApprover !== undefined);
}
/** 지정 명단이 있는데 유효한 지정자가 0명일 때의 안내(요청 창 · 서버 같은 글 — 리뷰 2026-11-06). */
export const NO_DESIGNATED_APPROVER = "지정된 퇴원보고서 승인자가 없습니다 — 학원 설정에서 지정해 주세요";
/** 학원 설정을 읽지 못해 승인자를 정할 수 없을 때(요청 창 — 목록·상세는 열고 작성 요청만 막는다 · 서버는 `reportStaff({ forRequest })`가 멈춘다). */
export const APPROVER_SETTINGS_UNAVAILABLE = "학원 설정을 확인하지 못했습니다 — 잠시 후 다시 시도해 주세요";
/** 지정자는 있는데 그 보고서 과목의 지정 승인자가 작성 강사 본인뿐일 때(지정자가 아무도 맡지 않은 과목 · 지정자 한 명이 직접 씀). */
export const WRITER_ONLY_APPROVER = "이 과목의 지정 승인자가 작성 강사 본인뿐이라 승인할 사람이 없습니다 — 학원 설정에서 승인자를 더 지정해 주세요";
/**
 * 지정 명단이 있는데 이 보고서를 승인할 사람이 없을 때 그 까닭 — 생략이 아니고 후보가 0명일 때만(명단이 없는 학원은 null — 부르는 쪽의 종전 문구).
 * 유효한 지정자가 0명이면 `NO_DESIGNATED_APPROVER`, 지정자가 있는데도 0명이면 남은 지정자가 작성 강사뿐이다(`WRITER_ONLY_APPROVER`).
 * 요청 창(경고 줄 · 보고서별 안내)과 서버(`decideReportApprovals`)가 이 한 곳을 본다(리뷰 2026-11-06 2차).
 */
export function missingApproverNotice(staff: readonly StaffOption[], p: Pick<ReportApproval, "skip" | "candidates">, settingsUnavailable = false): string | null {
  if (p.skip || p.candidates.length) return null;
  // 학원 설정을 못 읽었다(목록이 '아무도 지정 아님'으로 접힘) — 설정을 고치러 가지 않게 다시 시도하라고만 알린다(3차 재리뷰 2026-11-06).
  if (settingsUnavailable) return APPROVER_SETTINGS_UNAVAILABLE;
  if (!approverListConfigured(staff)) return null;
  return staff.some(u => u.withdrawalApprover && approverRole(u)) ? WRITER_ONLY_APPROVER : NO_DESIGNATED_APPROVER;
}
/**
 * 보고서 하나(작성 강사)의 승인 계획 — 원장 2026-11-03 *"작성 강사가 그 과목 관리자 본인이면 관리자 승인 생략"*, **보고서마다** 판정한다.
 * - 보고서 과목 = DB가 보고서에 싣는 과목과 같은 규칙: 작성 강사가 한 명이면 고른 반 전부, 여럿이면 그 강사가 담임인 반(`request_withdrawal_report_group`).
 * - 과목 승인 담당(`approversFor`) — 원장급(master)은 **어떤 경우에도 아니다**(원장 2026-11-05):
 *   · 학원 설정 '퇴원보고서 승인자'가 있으면 그 사람들 중 그 과목을 승인 과목으로 가진 사람.
 *   · 그런 사람이 없는 과목(지정자가 아무도 맡지 않은 과목)은 '그 과목 승인 담당 본인'이 없다 — **생략하지 않고** 지정한 사람 전원(작성 강사 제외)이 승인한다
 *     (과목 칸이 비거나 어긋나도 지정 밖의 사람·원장이 들어오지 않게 — 원장 2026-11-05 *"항상 '정유진' 혹은 '허은진'. 지정된 사람으로"* · 리뷰 2026-11-06 결정).
 *   · 명단은 있는데 유효한 사람이 0명이면 승인 담당도 0명 — 후보 없음 · 생략 없음 → 요청을 막는다(`NO_DESIGNATED_APPROVER`).
 *   · 명단이 없으면 그 과목을 승인 과목으로 가진 관리자·매니저 전원(종전 · 원장급 제외).
 * - 생략(`skip`) = 작성 강사가 그 보고서 과목 **모두**의 승인 담당 본인 — 원장으로 대신하지 않는다(11-03 · 11-05). 제출이 곧 승인(DB s2_0025).
 * - 후보(`candidates`) = 작성 강사 본인을 뺀, 그 보고서의 **작성 강사가 맡지 않은 과목**의 승인 담당
 *   (같은 묶음의 다른 작성 강사도 후보가 될 수 있다 — EiE·일반 영어처럼 같은 과목에 작성자가 둘이면 승인 담당인 작성자가 평강사 보고서를 승인한다).
 *   지정 명단이 있는데 후보가 0명이면(유효한 지정자 없음 · 지정자가 작성 강사 한 명뿐인 과목) '승인자 없음'이다.
 * - 승인 과목 = `approvalSubjects`(직원 과목 범위 덮어쓰기 → 학원 설정 '퇴원보고서 승인자' 좁히기까지 반영된 값 — `reportStaff`) · 없으면 담당 과목.
 * 🔴 침산 지점 superadmin(lsy93@gmail.com · st2000423@gmail.com 등)을 여기에 넣으면 안 된다 — `reportStaff`가 역할을 admin으로, 승인 과목을 빈 값으로 넘기고
 *    '퇴원보고서 승인자' 표시도 하지 않아 후보에서도 생략에서도 빠진다. `role`을 실제 system_role로 바꾸거나 다른 직원 목록을 넘기면 이 보호가 사라진다.
 */
export type ReportApproval = { teacherId: string; subjects: string[]; skip: boolean; candidates: StaffOption[] };
const approves = (u: Pick<StaffOption, "approvalSubjects" | "subjects">, subject: string) => (u.approvalSubjects ?? u.subjects).includes(subject);
export function reportApprovalPlan(
  staff: readonly StaffOption[],
  courses: readonly Pick<CourseSnapshot, "subject" | "teacherId">[],
  teacherIds: readonly string[],
): ReportApproval[] {
  const configured = approverListConfigured(staff);
  const designated = staff.filter(u => u.withdrawalApprover && approverRole(u));
  // 과목의 승인 담당 — `own` = 그 과목 '승인 담당 본인'(생략 판정에 쓴다) · `all` = 후보(지정자가 아무도 맡지 않은 과목은 지정자 전원).
  const approversFor = (subject: string): { own: readonly StaffOption[]; all: readonly StaffOption[] } => {
    if (!configured) { const list = staff.filter(u => approverRole(u) && approves(u, subject)); return { own: list, all: list }; }
    const own = designated.filter(u => approves(u, subject));
    return { own, all: own.length ? own : designated };
  };
  return teacherIds.map(teacherId => {
    const own = teacherIds.length === 1 ? courses : courses.filter(c => c.teacherId === teacherId);
    const subjects = [...new Set(own.map(c => c.subject))];
    const managed = subjects.filter(s => approversFor(s).own.some(u => u.id === teacherId));
    const skip = subjects.length > 0 && managed.length === subjects.length;
    const rest = subjects.filter(s => !managed.includes(s));
    const candidates = skip ? [] : staff.filter(u => u.id !== teacherId && rest.some(s => approversFor(s).all.some(a => a.id === u.id)));
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
