/**
 * 업무 비서가 미리 써 두는 업무 요청 — 겹친 학생은 신호가 난 반의 담임마다, 사람 묶음은 그 사람에게 그 사람 몫의 학생만.
 * 확인할 일 줄의 요청(`requestPrefill`)과 같은 규칙이다(학생마다 맡을 담당자 · 사람 id로만 · 기한은 바꿀 수 있다). 순수 함수(Vitest).
 * 내용은 담당자별로 정리한 서식 글이다(`request-body` — 원장 2026-11-02 *"담임에게 전달할 내용이 너무 두서없이 나열"*).
 */
import type { DraftStudent } from "@/features/work-requests/model";
import { esc, para } from "@/features/work-requests/rich-body";
import { requestPrefill, type RequestPrefill } from "./check-requests";
import type { DetailContext } from "./details-types";
import { num } from "./labels";
import { ALL_KINDS, assigneeSections, personSections, type SignalKind } from "./request-body";
import { isOverlap, studentsOf, teacherIdsOf, type PersonLoad, type StudentSignal } from "./secretary-facts";
import { personText } from "./secretary-plan";

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const OVERLAP_INTRO = para(esc("결석 · 숙제 · 상담 가운데 두 가지 이상이 겹친 학생입니다. 맡은 학생마다 사유를 확인하고 다음 계획을 보고해 주세요."));

export function overlapPrefill(signals: readonly StudentSignal[], today: string): RequestPrefill | null {
  const list = signals.filter(isOverlap);
  if (!list.length) return null;
  // 신호가 난 반의 담임마다 — 결석은 수학 반, 숙제는 영어 반이면 두 담임에게 하나씩.
  const students = list.flatMap((s): DraftStudent[] => {
    const ids = teacherIdsOf(s);
    return ids.length ? ids.map((t) => ({ id: s.id, name: s.name, assigneeId: t })) : [{ id: s.id, name: s.name, assigneeId: null }];
  });
  // 첫 문장은 모두가 받는다 — 전체 인원 수는 적지 않는다(선생님마다 자기 몫만 받고, 수는 자기 이름 제목에 있다).
  const rebody = (next: readonly DraftStudent[], nameOf?: (id: string) => string | undefined) => OVERLAP_INTRO + assigneeSections(next, list, { kinds: ALL_KINDS, context: true, nameOf });
  return {
    title: "결석·숙제·상담이 겹친 학생 확인", source: "secretary:overlap", dueOn: shift(today, 2),
    body: rebody(students), rebody,
    criteria: "맡은 학생마다 결석 · 숙제 사유, 보호자 연락 여부, 다음 계획(상담 · 보강)을 보고에 적는다",
    assigneeIds: [...new Set(students.flatMap((s) => (s.assigneeId ? [s.assigneeId] : [])))], students,
  };
}

/** 한 사람에게 그 사람 몫의 학생만 — 결석(그 반) · 숙제(그 반) · 상담(그 담임 줄)을 한 요청으로. 학생이 없으면 null(할 일 창으로). */
export function personPrefill(person: PersonLoad, signals: readonly StudentSignal[], today: string): RequestPrefill | null {
  const ids = new Set(studentsOf(person));
  const mine = signals.filter((s) => ids.has(s.id));
  if (!mine.length) return null;
  const of = (list: readonly string[]) => mine.filter((s) => list.includes(s.id));
  return {
    title: `${person.name} 선생님 — 확인할 학생 ${num(mine.length)}명`, source: "secretary:person", dueOn: shift(today, 3),
    body: para(esc(`${personText(person)}입니다.`)) + personSections(person.id, [
      { title: "반복 결석", note: "최근 14일 · 사전 통보 없는 결석 3회 이상", kind: "absence", list: of(person.absence) },
      { title: "숙제 60% 미만", note: "최근 7일 숙제 기록", kind: "homework", list: of(person.homework) },
      { title: "지난달부터 담임 상담 없음", note: "지난달 담임 상담이 없었고 이번 달도 아직", kind: "consult", list: of(person.consult) },
    ]),
    criteria: "결석 · 숙제 학생은 사유와 다음 계획을, 상담이 빠진 학생은 이번 달 원생상담 기록을 남긴다",
    assigneeIds: [person.id], students: mine.map((s) => ({ id: s.id, name: s.name, assigneeId: person.id })),
  };
}

/** 확인할 일 줄 → 그 줄의 신호(내용을 담당자별로 정리할 때 쓴다). */
const KIND_OF_ROW: Record<string, SignalKind> = { absence: "absence", homework: "homework", homeroom: "consult" };

/**
 * 후보(ref) · 확인할 일 줄로 만들 업무 요청 — 겹친 학생 · 사람 · 확인할 일 줄. 줄 요청은 담당자 · 근거 학생을 `requestPrefill`이 정하고,
 * 내용만 같은 묶음으로 정리한다(근거 학생과 같은 담당자 아래 그 담당자 몫의 날짜 · 반).
 */
export function requestFor(ref: string, ctx: Pick<DetailContext, "snapshot" | "extras">, signals: readonly StudentSignal[], people: readonly PersonLoad[]): RequestPrefill | null {
  const today = ctx.snapshot.today;
  if (ref === "overlap") return overlapPrefill(signals, today);
  if (ref.startsWith("person:")) {
    const person = people.find((p) => `person:${p.id}` === ref);
    return person ? personPrefill(person, signals, today) : null;
  }
  const base = requestPrefill(ref, ctx);
  const kind = KIND_OF_ROW[ref];
  if (!base || !kind || !base.students?.length) return base;
  // 첫 문장은 모두가 받는다 — 전체 인원 수('학생 12명입니다')는 빼고, 수는 선생님마다 자기 이름 제목에.
  const intro = para(esc((base.body ?? "").replace(/\s*\d[\d,]*명(?=입니다)/, "")));
  const rebody = (next: readonly DraftStudent[], nameOf?: (id: string) => string | undefined) => intro + assigneeSections(next, signals, { kinds: [kind], context: false, nameOf });
  return { ...base, body: rebody(base.students), rebody };
}
