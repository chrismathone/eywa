/**
 * 숙제 영상 올리기 사이트(`/v`)의 고르기 단계 — **선생님 → 반 → 숙제**(원장 2026-10-22 *"선생님 선택 -> 반 선택 -> 숙제 선택"*).
 * 김채현 건: 같은 단원을 나가는 두 반(BS1D 남정화 · BS1K 허주연)의 숙제가 반 이름만으로 한 목록에 섞여 있어, 학생이 어느 선생님 숙제인지
 * 가르기 어려웠다. 서버가 준 줄(`SiteChoice`)을 묶기만 한다(순서는 서버 순서 — 안 낸 숙제가 먼저라 그 선생님이 먼저 선다).
 * 묶음 열쇠가 없는 응답(옛 서버)은 선생님 하나 · 반은 이름으로 묶는다.
 */
import type { SiteChoice } from "./site";

export type SiteClassGroup = {
  key: string;
  className: string;
  studentLabel: string;
  pastClass: boolean;
  /** 이 반의 줄 — 숙제 줄 + '숙제 없이 올리기' 줄. */
  choices: SiteChoice[];
  /** 숙제 줄 수 · 그중 아직 영상을 안 낸 수. */
  homework: number;
  unsent: number;
};
export type SiteTeacherGroup = { key: string; label: string | null; classes: SiteClassGroup[]; homework: number; unsent: number };

export function groupSiteChoices(choices: readonly SiteChoice[]): SiteTeacherGroup[] {
  const teachers = new Map<string, SiteTeacherGroup>();
  for (const c of choices) {
    const tKey = c.teacherKey ?? "";
    const teacher = teachers.get(tKey) ?? { key: tKey, label: c.teacherLabel ?? null, classes: [], homework: 0, unsent: 0 };
    teachers.set(tKey, teacher);
    const cKey = c.classKey ?? `${c.className}|${c.studentLabel}`;
    let klass = teacher.classes.find((k) => k.key === cKey);
    if (!klass) {
      klass = { key: cKey, className: c.className, studentLabel: c.studentLabel, pastClass: false, choices: [], homework: 0, unsent: 0 };
      teacher.classes.push(klass);
    }
    klass.choices.push(c);
    if (c.pastClass) klass.pastClass = true;
    if (!c.free) {
      klass.homework += 1;
      teacher.homework += 1;
      if (!c.sent) {
        klass.unsent += 1;
        teacher.unsent += 1;
      }
    }
  }
  return [...teachers.values()];
}

/**
 * 지금 서 있을 단계 — 고른 값이 없으면 하나뿐인 쪽은 저절로 고른다(선생님이 한 분이면 반 단계부터, 반도 하나면 숙제 단계).
 * 고른 열쇠가 목록에 없으면(목록이 새로 왔다) 고르지 않은 것으로 본다.
 */
export function siteStep(groups: readonly SiteTeacherGroup[], picked: { teacher?: string; klass?: string }):
  | { step: "teacher" }
  | { step: "class"; teacher: SiteTeacherGroup }
  | { step: "homework"; teacher: SiteTeacherGroup; klass: SiteClassGroup } {
  const teacher = groups.find((g) => g.key === picked.teacher) ?? (groups.length === 1 ? groups[0] : undefined);
  if (!teacher) return { step: "teacher" };
  const klass = teacher.classes.find((k) => k.key === picked.klass) ?? (teacher.classes.length === 1 ? teacher.classes[0] : undefined);
  if (!klass) return { step: "class", teacher };
  return { step: "homework", teacher, klass };
}
