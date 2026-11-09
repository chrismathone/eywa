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
