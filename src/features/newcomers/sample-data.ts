import { shiftDate, bucketOf, progressOf } from "./onboarding-items";
import type { NewcomerRow } from "./server/queries";
import { resolveSubjectManager, type FollowupReport, type FollowupStudent, type FollowupView, type Homeroom, type ManagerAssignment, type ManagerDefault, type Person } from "./followup-model";

/**
 * 신규생 90일 정착 관리 시안 — aywa-next(375d27df4)의 담당 배정·적응 피드백·후속 조치 표
 * (`student_onboarding_feedback` · `student_onboarding_subject_assignments` · `student_onboarding_manager_defaults` ·
 * `student_onboarding_assignments`)가 이 DB에 없다.
 * 🔴 학생·직원 이름과 날짜는 전부 지어낸 값이다. 실제 학생 기록과 섞지 않는다(실제 완료 체크표는 '전체 완료 체크표' 탭).
 */
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const P = (n: number, name: string): Person => ({ id: uuid(800 + n), name });
const MANAGERS = [P(1, "한서연"), P(2, "오지훈"), P(3, "문채원")];
const TEACHERS = { math: [P(11, "배준호"), P(12, "류태오")], english: [P(13, "신다은"), P(14, "Ethan")] };
const DEFAULTS: ManagerDefault[] = [{ subject: "math", manager_id: MANAGERS[0].id }, { subject: "english", manager_id: MANAGERS[2].id }];

type SubjectSeed = { subject: string | null; firstClassAfter: number | null; done: Record<string, number>; teacher?: Person; upcoming?: boolean };
type StudentSeed = { n: number; name: string; school: string; grade: string; enrolledDaysAgo: number; subjects: SubjectSeed[]; promises?: number };

const SEEDS: StudentSeed[] = [
  { n: 1, name: "김하늘", school: "가온중", grade: "중1", enrolledDaysAgo: 5, promises: 1, subjects: [
    { subject: "math", firstClassAfter: 2, done: { pre_call: 1 }, teacher: TEACHERS.math[0] }] },
  { n: 2, name: "이도윤", school: "누리초", grade: "초6", enrolledDaysAgo: 18, subjects: [
    { subject: "math", firstClassAfter: 1, done: { pre_call: 0, first_class_guide: 1, ojt: 6 }, teacher: TEACHERS.math[1] },
    { subject: "english", firstClassAfter: 3, done: { pre_call: 2, first_class_guide: 3 }, teacher: TEACHERS.english[0] }] },
  { n: 3, name: "박서준", school: "다솜중", grade: "중2", enrolledDaysAgo: 34, promises: 2, subjects: [
    { subject: "english", firstClassAfter: 2, done: { pre_call: 1, first_class_guide: 2, ojt: 7, after_first_call: 9 }, teacher: TEACHERS.english[1] }] },
  { n: 4, name: "최유나", school: "가온중", grade: "중3", enrolledDaysAgo: 41, subjects: [
    { subject: "math", firstClassAfter: 0, done: { pre_call: 0, first_class_guide: 0, ojt: 7, after_first_call: 8, month1_call: 31 }, teacher: TEACHERS.math[0] },
    { subject: "english", firstClassAfter: 4, done: { pre_call: 3, first_class_guide: 4 }, teacher: TEACHERS.english[0] }] },
  { n: 5, name: "정민재", school: "라온고", grade: "고1", enrolledDaysAgo: 12, subjects: [
    { subject: null, firstClassAfter: null, done: {} }] },
  { n: 6, name: "윤소율", school: "누리초", grade: "초5", enrolledDaysAgo: 58, subjects: [
    { subject: "math", firstClassAfter: 1, done: { pre_call: 0, first_class_guide: 1, ojt: 6, after_first_call: 8, month1_call: 33 }, teacher: TEACHERS.math[1] }] },
  { n: 7, name: "강지후", school: "다솜중", grade: "중1", enrolledDaysAgo: 2, subjects: [
    { subject: "english", firstClassAfter: 6, done: {}, teacher: TEACHERS.english[0], upcoming: true }] },
  { n: 8, name: "임하린", school: "라온고", grade: "고2", enrolledDaysAgo: 87, subjects: [
    { subject: "math", firstClassAfter: 0, done: { pre_call: 0, first_class_guide: 0, ojt: 6, after_first_call: 7, month1_call: 30, month2_call: 61 }, teacher: TEACHERS.math[0] }] },
  { n: 9, name: "송예준", school: "가온중", grade: "중2", enrolledDaysAgo: 104, subjects: [
    { subject: "english", firstClassAfter: 1, done: { pre_call: 0, first_class_guide: 1, ojt: 7, after_first_call: 8, month1_call: 32, month3_call: 92 }, teacher: TEACHERS.english[1] }] },
];

function subjectRow(seed: StudentSeed, s: SubjectSeed, today: string): NewcomerRow {
  const enrolledOn = shiftDate(today, -seed.enrolledDaysAgo);
  const firstClassOn = s.firstClassAfter === null ? null : shiftDate(enrolledOn, s.firstClassAfter);
  const checks = Object.fromEntries(Object.entries(s.done).map(([k, d]) => [k, shiftDate(enrolledOn, d)]));
  const anchors = { enrolledOn, firstClassOn };
  return {
    studentId: uuid(seed.n), subject: s.subject, rowKey: `${uuid(seed.n)}|${s.subject ?? ""}`, hasCurrentEnrollment: s.subject !== null,
    name: seed.name, school: seed.school, grade: seed.grade, enrolledOn, firstClassOn, elapsedDays: seed.enrolledDaysAgo,
    bucket: bucketOf(enrolledOn, today), checks, progress: progressOf(anchors, checks, today),
  };
}

function report(n: number, seed: StudentSeed, today: string, patch: Partial<FollowupReport> & Pick<FollowupReport, "subject" | "stage" | "condition" | "summary" | "author_id" | "authorName">): FollowupReport {
  const created = shiftDate(today, -Math.max(0, seed.enrolledDaysAgo - (patch.stage === "d7" ? 6 : patch.stage === "d30" ? 29 : 59)));
  return { id: uuid(300 + n), student_id: uuid(seed.n), next_action: "", next_due: null, created_at: `${created}T06:00:00Z`, response: "",
    review_state: "pending", review_note: "", reviewed_by: null, reviewerName: null, reviewed_at: null,
    followup_result: "", followup_at: null, followup_by: null, followupName: null, version: 1, ...patch };
}

function reportsFor(seed: StudentSeed, today: string): FollowupReport[] {
  const m = TEACHERS.math, e = TEACHERS.english, d = (n: number) => shiftDate(today, n);
  switch (seed.n) {
    case 2: return [report(1, seed, today, { subject: "math", stage: "d7", condition: "watch", summary: "수업 참여는 적극적이나 숙제 분량을 버거워함. 어머님께 첫 주 과제량을 조정하겠다고 안내.", author_id: m[1].id, authorName: m[1].name, next_action: "과제량 조정 후 2주 차에 다시 확인", next_due: d(-2) })];
    case 3: return [report(2, seed, today, { subject: "english", stage: "d30", condition: "good", summary: "레벨에 맞게 반 배정이 잘 됨. 단어 시험 3회 연속 90점 이상.", author_id: e[1].id, authorName: e[1].name, review_state: "confirmed", review_note: "학부모 1개월 콜에서도 만족 확인", reviewed_by: MANAGERS[2].id, reviewerName: MANAGERS[2].name, reviewed_at: `${d(-3)}T05:00:00Z` })];
    case 4: return [
      report(3, seed, today, { subject: "math", stage: "d30", condition: "help", summary: "중간고사 대비 진도와 학교 진도가 어긋나 불안해함. 보충 수업 필요.", author_id: m[0].id, authorName: m[0].name, review_state: "revision", review_note: "보충 일정과 학부모 안내 여부를 함께 적어 주세요", reviewed_by: MANAGERS[0].id, reviewerName: MANAGERS[0].name, reviewed_at: `${d(-6)}T05:00:00Z`, next_action: "토요일 보충 2회 편성", next_due: d(4) }),
      report(4, seed, today, { subject: "general", stage: "d30", condition: "watch", summary: "쉬는 시간에 혼자 있는 편. 같은 학교 친구와 자리 배치 조정.", author_id: MANAGERS[0].id, authorName: MANAGERS[0].name, review_state: "confirmed", review_note: "다음 주 다시 관찰", reviewed_by: MANAGERS[1].id, reviewerName: MANAGERS[1].name, reviewed_at: `${d(-5)}T05:00:00Z` })];
    case 6: return [report(5, seed, today, { subject: "math", stage: "d30", condition: "good", summary: "연산 속도가 빨라짐. 학부모가 만족도 콜에서 형제 등록 문의.", author_id: m[1].id, authorName: m[1].name, review_state: "confirmed", review_note: "형제 상담 일정 연결 완료", reviewed_by: MANAGERS[0].id, reviewerName: MANAGERS[0].name, reviewed_at: `${d(-20)}T05:00:00Z`, next_action: "형제 상담 예약 확인", next_due: d(-18), followup_result: "상담 예약 완료(콜&상담 등록)", followup_at: `${d(-17)}T05:00:00Z`, followup_by: MANAGERS[0].id, followupName: MANAGERS[0].name })];
    case 8: return [report(6, seed, today, { subject: "math", stage: "d60", condition: "watch", summary: "모의고사 이후 의욕 저하. 목표 대학 상담 요청.", author_id: m[0].id, authorName: m[0].name, next_action: "진로 상담 일정 잡기", next_due: d(-4) })];
    case 9: return [report(7, seed, today, { subject: "english", stage: "d90", condition: "good", summary: "90일 정착 완료. 다음 학기 상위 반 이동 희망.", author_id: e[1].id, authorName: e[1].name, review_state: "confirmed", review_note: "장기 재원으로 전환", reviewed_by: MANAGERS[2].id, reviewerName: MANAGERS[2].name, reviewed_at: `${d(-8)}T05:00:00Z` })];
    default: return [];
  }
}

const MANUAL: ManagerAssignment[] = [
  { student_id: uuid(4), subject: "english", manager_id: MANAGERS[1].id, mode: "manual", version: 2 },
  { student_id: uuid(8), subject: "math", manager_id: null, mode: "manual", version: 1 },
];

export function sampleFollowupView(today: string): FollowupView {
  const students: FollowupStudent[] = SEEDS.map((seed) => {
    const subjects = seed.subjects.map((s) => subjectRow(seed, s, today));
    const first = subjects[0];
    const row: NewcomerRow = { ...first, subject: null, rowKey: first.studentId, subjects };
    const homerooms: Homeroom[] = seed.subjects.flatMap((s) => s.teacher && s.subject ? [{ ...s.teacher, subject: s.subject, upcoming: !!s.upcoming }] : []);
    const evidence: FollowupStudent["evidence"] = {};
    for (const r of subjects) for (const key of Object.keys(r.checks)) evidence[`${r.subject ?? ""}|${key}`] = {
      doneBy: MANAGERS[r.subject === "english" ? 2 : 0].id, doneByName: MANAGERS[r.subject === "english" ? 2 : 0].name,
      memo: key.endsWith("_call") ? "수행: 학부모 적응 확인 전화\n결과: 수업 만족, 과제량 적당" : null, consultationId: null };
    return { row, subjects, homerooms,
      managers: subjects.flatMap((r) => r.subject ? [resolveSubjectManager(r.subject, MANUAL.find((a) => a.student_id === r.studentId && a.subject === r.subject), DEFAULTS, MANAGERS)] : []),
      evidence, reports: reportsFor(seed, today), openPromises: seed.promises ?? 0 };
  });
  return { today, students, staff: MANAGERS, actorId: MANAGERS[0].id, canManage: true, canReport: true, error: null, checksKnown: true,
    defaults: DEFAULTS.map((d) => ({ subject: d.subject, manager: MANAGERS.find((p) => p.id === d.manager_id) ?? null })) };
}
