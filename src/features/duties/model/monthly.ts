import { ONBOARDING_ITEMS, dueDateOf, statusOf, type OnboardingItemDef } from "@/features/newcomers/onboarding-items";
import { effectiveChecks, type ChecksBySubject } from "@/features/newcomers/subject-rows";
import { lastDayOf } from "@/features/consultations/homeroom-model";
import { kstDueAt, type DutyDraft } from "./daily";

/**
 * 월간·건별 의무 생성기(순수) — 월 학부모 상담 · 신규생 정착 콜.
 *
 *   · 월 학부모 상담 = 상담 의무 쌍(담임 × 학생 × 과목 — `buildCounselDuty`, 강사평가·원생상담 통계와 **같은 판정**)마다 그 달 한 건.
 *     완료 = 그 달 **본인**(counselor_id = 담임)이 남긴 상담 1건+(가장 이른 것이 done_at). 기한 = 말일(다음 달 1일 0시).
 *   · 신규생 정착 콜 = 신규생 관리 체크리스트(`ONBOARDING_ITEMS` · 필요시 항목 제외)의 항목마다 한 건 — 학생 × 과목(옛 기록은 과목 무관).
 *     완료 = 체크(done_on). 기한을 모르면(첫 수업일 없음) · 기능 시작 전 기한이면 의무를 만들지 않는다(`statusOf` pending/waived).
 *     담당 = 그 학생·과목의 상담 의무 담임(없으면 그 학생의 아무 의무 담임 · 없으면 비움 → 원장 폴백은 사다리가).
 */
export type CounselPair = { teacherId: string; studentId: string; classId: string; subject: string };
export type CounselRecord = { studentId: string; counselorId: string | null; consultedAt: string };

export function buildCounselDuties(input: { month: string; pairs: readonly CounselPair[]; consults: readonly CounselRecord[]; inactiveTeacherIds?: ReadonlySet<string> }): DutyDraft[] {
  const { month } = input;
  const dueAt = kstDueAt(lastDayOf(month), 1, 0);
  const firstConsult = new Map<string, string>();
  for (const c of input.consults) {
    if (!c.counselorId) continue;
    const kstDate = new Date(Date.parse(c.consultedAt) + 9 * 3_600_000).toISOString().slice(0, 10);
    if (kstDate.slice(0, 7) !== month) continue;
    const key = `${c.studentId}|${c.counselorId}`;
    const prev = firstConsult.get(key);
    if (!prev || c.consultedAt < prev) firstConsult.set(key, c.consultedAt);
  }
  const out = new Map<string, DutyDraft>();
  for (const p of input.pairs) {
    const key = `${p.studentId}|${p.teacherId}:${p.subject}`;
    if (out.has(key)) continue;
    const retired = input.inactiveTeacherIds?.has(p.teacherId) === true;
    const doneAt = firstConsult.get(`${p.studentId}|${p.teacherId}`) ?? null;
    out.set(key, { kind: "counsel_monthly", period: "monthly", cycle: month, subjectKey: key, studentId: p.studentId, classId: p.classId, subject: p.subject,
      ownerId: retired ? null : p.teacherId, ownerSource: retired ? "retired" : "homeroom", dueAt,
      status: doneAt ? "done" : "open", source: doneAt ? "student_consultation" : null, doneAt });
  }
  return [...out.values()];
}

export type NewcomerStudent = { id: string; enrolledOn: string; /** 과목 → 첫 수업일(모르면 null). 과목 수강이 없으면 빈 Map. */ subjects: ReadonlyMap<string, string | null>; /** 과목 무관 첫 수업일. */ earliest: string | null };

export function buildNewcomerDuties(input: {
  today: string; students: readonly NewcomerStudent[]; checks: ChecksBySubject;
  ownerOf: (studentId: string, subject: string | null) => string | null;
  items?: readonly OnboardingItemDef[];
}): DutyDraft[] {
  const items = (input.items ?? ONBOARDING_ITEMS).filter((i) => !i.optional);
  const out: DutyDraft[] = [];
  for (const s of input.students) {
    const subjects: (string | null)[] = s.subjects.size ? [...s.subjects.keys()].sort() : [null];
    for (const subject of subjects) {
      const anchors = { enrolledOn: s.enrolledOn, firstClassOn: subject ? (s.subjects.get(subject) ?? null) : s.earliest };
      const checks = effectiveChecks(input.checks, s.id, subject);
      const ownerId = input.ownerOf(s.id, subject);
      for (const item of items) {
        const doneOn = checks[item.key] ?? null;
        const st = statusOf(item, anchors, doneOn, input.today);
        if (st === "pending" || st === "waived") continue;
        const due = dueDateOf(item, anchors)!;
        out.push({ kind: "newcomer_call", period: "case", cycle: item.key, subjectKey: `${s.id}|${subject ?? ""}`, studentId: s.id, classId: null, subject,
          ownerId, ownerSource: ownerId ? "homeroom" : "none", dueAt: kstDueAt(due, 1, 0),
          status: st === "done" ? "done" : "open", source: st === "done" ? "onboarding_check" : null, doneAt: doneOn ? kstDueAt(doneOn, 0, 9) : null });
      }
    }
  }
  return out;
}

export type ExamRecord = { studentId: string; subject: string; takenOn: string; createdAt: string | null };
/**
 * 월말평가 응시 의무 — 담임 × 학생 × 과목(담임 반 명단 · `pairs`는 반 담임 기준). 완료 = 그 달 그 과목 월말평가 기록(가장 이른 입력 시각이 done_at).
 * 학원이 **그 달이나 지난달에** 월말평가를 친 과목만 의무를 만든다(포트폴리오 '그 달 기록 있는 과목만'을 달 초에도 보이게 한 달 넓힘).
 */
export function buildExamDuties(input: { month: string; pairs: readonly CounselPair[]; records: readonly ExamRecord[]; inactiveTeacherIds?: ReadonlySet<string> }): DutyDraft[] {
  const { month } = input;
  const prev = `${month.slice(0, 4)}-${String(Number(month.slice(5, 7)) - 1).padStart(2, "0")}`;
  const prevMonth = Number(month.slice(5, 7)) === 1 ? `${Number(month.slice(0, 4)) - 1}-12` : prev;
  const subjects = new Set(input.records.filter((r) => r.takenOn.slice(0, 7) === month || r.takenOn.slice(0, 7) === prevMonth).map((r) => r.subject));
  const first = new Map<string, string | null>();
  for (const r of input.records) {
    if (r.takenOn.slice(0, 7) !== month) continue;
    const key = `${r.studentId}|${r.subject}`;
    const prevAt = first.get(key);
    if (prevAt === undefined || (r.createdAt && (!prevAt || r.createdAt < prevAt))) first.set(key, r.createdAt);
  }
  const dueAt = kstDueAt(lastDayOf(month), 1, 0);
  const out = new Map<string, DutyDraft>();
  for (const p of input.pairs) {
    if (!subjects.has(p.subject)) continue;
    const key = `${p.studentId}|${p.teacherId}:${p.subject}`;
    if (out.has(key)) continue;
    const retired = input.inactiveTeacherIds?.has(p.teacherId) === true;
    const done = first.has(`${p.studentId}|${p.subject}`);
    out.set(key, { kind: "exam_monthly", period: "monthly", cycle: month, subjectKey: key, studentId: p.studentId, classId: p.classId, subject: p.subject,
      ownerId: retired ? null : p.teacherId, ownerSource: retired ? "retired" : "homeroom", dueAt,
      status: done ? "done" : "open", source: done ? "student_grade" : null, doneAt: done ? first.get(`${p.studentId}|${p.subject}`) ?? null : null });
  }
  return [...out.values()];
}
