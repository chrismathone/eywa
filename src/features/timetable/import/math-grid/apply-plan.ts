// 격자 변경(GridDelta) + 지금 DB 상태 → **무엇을 실제로 쓸 것인가**(반영 계획). 순수.
//
// 여기서 모든 변경이 둘로 갈린다: 쓸 것(만들 반·이동·추가·종료) / 쓰지 않을 것(이유와 함께).
// 🔴 쓸 수 없는 것을 조용히 버리지 않는다 — 원장 2026-10-06: *"필터링이 잘 되는가. 왜 적용 못하는지 알림이 잘 뜨는가"*.
// 미리보기와 적용이 **같은 함수**로 계획을 세우고, 적용은 해시가 미리보기와 같을 때만 쓴다(그 사이 시트·DB가 바뀌면 멈춘다).

import { normalizeClassName } from "@/features/classes/class-name";
import { enrollmentAssignBlockReason, enrollmentOnHoldForStatus } from "@/features/enrollments/eligibility";
import { formatSchoolGrade } from "@/lib/format/school-grade";
import { norm } from "../match";
import { studentNameOf } from "./grid-text";
import { DOW, newClassKey, planNewClasses } from "./plan-classes";
import type { GridApplyPlan, PlanContext, PlanTarget } from "./plan-types";
import type { DeltaClassRef, DeltaIgnored, DeltaStudent, GridDelta } from "./types";

export * from "./plan-types";

const DAY_KO = Object.fromEntries(Object.entries(DOW).map(([ko, en]) => [en, ko]));
const NOT_IN_ROSTER = "학생 명부에 없는 글자입니다 — 원생목록에 먼저 등록하거나, 명부의 이름·학교·학년대로 적어 주세요.";
const NOT_MATH_WHY =
  "수학 수업목록에 없는 반의 수강이라 건드리지 않았습니다(시트의 기록이 맞지 않습니다) — 시간표에서 시트로 다시 보낸 뒤 고쳐 주세요.";
const LINKED_WHY = "이 학생을 다른 반에 넣는 변경이 적용되지 않아, 원래 반 수강도 그대로 둡니다.";
const HOLD_WHY = "휴원(대기) 전환은 시트로 바꾸지 않습니다 — 반만 옮기고 휴원 상태는 그대로 둡니다. 학생 화면에서 바꿔 주세요.";
const HOLD_ADD_WHY = "휴원(대기) 전환은 시트로 바꾸지 않습니다 — 재원으로 추가합니다. 휴원으로 두려면 학생 화면에서 바꿔 주세요.";

export function buildGridPlan(delta: GridDelta, ctx: PlanContext, scheduleIgnored: DeltaIgnored[] = []): GridApplyPlan {
  const plan: GridApplyPlan = {
    classes: [],
    moves: [],
    adds: [],
    removes: [],
    skipped: [...delta.ignored, ...scheduleIgnored],
    notes: [...delta.notes],
    warnings: [...delta.warnings],
  };
  const skip = (what: string, why: string) => plan.skipped.push({ what, why });
  const note = (text: string) => {
    if (!plan.notes.includes(text)) plan.notes.push(text);
  };
  /** 못 만드는 새 반 → 이유(그 반으로 가는 이동·추가도 함께 빠진다). */
  const blocked = planNewClasses(delta, ctx, plan);

  const studentById = new Map(ctx.students.map((s) => [s.id, s]));
  const classById = new Map(ctx.classes.map((c) => [c.id, c]));
  // 🔴 계획에 싣는 이름(미리보기·되돌리기 기록)은 **DB의 것**이다 — 학생·반 id는 시트의 숨은 기록 탭에서 오므로, 그 탭의
  //    글자를 그대로 보여 주면 "화면에 보인 학생"과 "실제로 바뀌는 수강"이 다를 수 있다(쓰기 경로 리뷰).
  const labelOf = (id: string) => {
    const s = studentById.get(id)!;
    return `${s.name}/${formatSchoolGrade(s.school, s.grade)}`;
  };
  const classNameOf = (ref: DeltaClassRef) => (ref.classId ? classById.get(ref.classId)?.name : null) ?? ref.name;
  /** 글자 → 학생. 학교까지 적었는데 명부와 다르면 이름만으로 잇지 않는다([[#132]] 동명이인). */
  const resolve = (s: DeltaStudent): { id: string } | { why: string } => {
    if (s.studentId) return studentById.has(s.studentId) ? { id: s.studentId } : { why: NOT_IN_ROSTER };
    const exact = ctx.students.filter((x) => `${x.name}/${formatSchoolGrade(x.school, x.grade)}` === s.text);
    if (exact.length === 1) return { id: exact[0]!.id };
    if (exact.length > 1) return { why: "같은 글자의 학생이 여럿이라 누구인지 정할 수 없습니다." };
    if (s.text.includes("/")) return { why: NOT_IN_ROSTER };
    const byName = ctx.students.filter((x) => norm(x.name) === norm(studentNameOf(s.text)) && x.status !== "withdrawn");
    if (byName.length === 1) return { id: byName[0]!.id };
    return { why: byName.length > 1 ? "같은 이름의 학생이 여럿입니다 — 학교·학년까지 적어 주세요." : NOT_IN_ROSTER };
  };
  const days = (ko: string[]) => ko.map((d) => DOW[d]!).filter(Boolean);
  /** 옮겨 갈 반. `ko` = 그 반에서 학생이 적힌 요일(일부 요일만이면 등원 요일이 된다). */
  const target = (to: DeltaClassRef, ko: string[]): PlanTarget | { why: string } => {
    if (to.classId) {
      const cls = classById.get(to.classId);
      if (!cls) return { why: `"${to.name}"은(는) 수학 수업목록에 없는 반입니다.` };
      if (cls.open !== true) return { why: `"${cls.name}"은(는) 종강·폐지된 반입니다.` };
      // 기존 반의 수업 시간은 시트로 바꾸지 않는다 → 등원 요일은 **수업목록의 요일** 안에서만 정할 수 있다.
      if (cls.days?.length === 0) return { why: `"${cls.name}" 반은 수업목록에 수업 시간이 없습니다 — 수업 시간을 넣은 뒤 다시 불러와 주세요.` };
      if (cls.days && days(ko).some((d) => !cls.days!.includes(d))) {
        const real = cls.days.map((d) => DAY_KO[d] ?? d).join("·");
        return { why: `"${cls.name}" 반은 수업목록에서 ${real}요일에 수업합니다 — 시트에 적은 요일(${ko.join("·")})과 달라 등원 요일을 정할 수 없습니다.` };
      }
      if (cls.closesOn) note(`"${cls.name}" 반은 ${cls.closesOn}에 종강 예정입니다 — 그 전 날짜로만 적용할 수 있습니다.`);
      return { classId: to.classId, key: null, name: cls.name, closesOn: cls.closesOn ?? null };
    }
    if (blocked.has(newClassKey(to.name))) return { why: `새 반 "${to.name}"을(를) 만들 수 없어 함께 빠집니다.` };
    return plan.classes.some((c) => c.key === newClassKey(to.name))
      ? { classId: null, key: newClassKey(to.name), name: normalizeClassName(to.name) }
      : { why: `"${to.name}" 반을 읽지 못해 함께 빠집니다.` };
  };
  const openIn = (studentId: string, classId: string | null) =>
    ctx.enrollments.filter((e) => e.studentId === studentId && e.classId === classId);

  /** 추가가 적용되지 않은 학생 — 그 학생의 '빠짐'도 쓰지 않는다(다른 반에 못 넣었는데 원래 반만 닫히면 안 된다). */
  const addFailed = new Set<string>();
  const addTo = (student: DeltaStudent, to: DeltaClassRef, ko: string[], toHold: boolean) => {
    const who = resolve(student);
    const what = `${student.text} → "${to.name}"`;
    if ("why" in who) {
      skip(what, who.why);
      return;
    }
    const fail = (why: string) => {
      addFailed.add(who.id);
      skip(what, why);
    };
    const where = target(to, ko);
    if ("why" in where) return fail(where.why);
    const row = studentById.get(who.id)!;
    // 휴원은 거절이 아니라 승계(휴원 표식을 달고 들어간다). 그 밖의 '배정할 수 없는 상태'는 앱의 배정 게이트와 같은 이유로 막는다.
    const stateWhy = row.status === "on_hold" ? null : enrollmentAssignBlockReason(row.status);
    if (stateWhy) return fail(stateWhy);
    if (where.classId && openIn(who.id, where.classId).length > 0) return note(`${labelOf(who.id)} — 이미 "${where.name}" 수강 중이라 추가에서 뺐습니다.`);
    const onHold = enrollmentOnHoldForStatus(row.status);
    if (toHold && !onHold) skip(`${labelOf(who.id)} — "${where.name}" 대기 칸에 적힘`, HOLD_ADD_WHY);
    plan.adds.push({ studentId: who.id, label: labelOf(who.id), to: where, attendanceDays: days(ko), onHold });
  };
  /** 그 반의 열려 있는 수강 한 건 — 없거나, 이미 이동·종료가 예약됐으면 이유. */
  const sourceOf = (studentId: string, from: DeltaClassRef): { id: string } | { gone: true } | { why: string } => {
    // 🔴 출발 반은 **수학 반**이어야 한다 — 숨은 기록 탭이 망가졌거나 누가 고쳐 적으면 다른 과목 수강을 닫을 수 있다.
    if (!from.classId || !classById.has(from.classId)) return { why: NOT_MATH_WHY };
    if (!studentById.has(studentId)) return { why: NOT_IN_ROSTER };
    const rows = openIn(studentId, from.classId);
    if (rows.length === 0) return { gone: true };
    if (rows.some((e) => e.endDate)) return { why: `"${from.name}"에서 이미 반 이동이나 종료가 예약되어 있습니다.` };
    if (rows.length > 1) return { why: `"${from.name}" 수강이 둘 이상이라 시트로 바꿀 수 없습니다 — 학생 화면에서 정리해 주세요.` };
    return { id: rows[0]!.id };
  };

  for (const m of delta.moves) {
    const id = m.student.studentId!;
    const src = sourceOf(id, m.from);
    const what = `${m.student.text}: "${m.from.name}" → "${m.to.name}"`;
    if ("why" in src) { skip(what, src.why); continue; }
    if ("gone" in src) {
      note(`${m.student.text} — 이미 "${m.from.name}"에서 빠져 있어 "${m.to.name}" 추가만 봅니다.`);
      addTo(m.student, m.to, m.days, !!m.toHold);
      continue;
    }
    const where = target(m.to, m.days);
    if ("why" in where) { skip(what, where.why); continue; }
    if (where.classId && openIn(id, where.classId).length > 0) {
      note(`${labelOf(id)} — 이미 "${where.name}" 수강 중이라 "${classNameOf(m.from)}" 종료만 합니다.`);
      plan.removes.push({ enrollmentId: src.id, label: labelOf(id), className: classNameOf(m.from) });
      continue;
    }
    // 이동 RPC는 옛 수강의 휴원 표식을 그대로 물려준다 — 옮기면서 재원↔대기를 바꿔 적은 것은 반영되지 않는다고 알린다.
    if (!!m.toHold !== !!m.wasHeld) skip(`${labelOf(id)} — "${where.name}" ${m.wasHeld ? "대기 → 재원" : "재원 → 대기"}`, HOLD_WHY);
    plan.moves.push({ enrollmentId: src.id, studentId: id, label: labelOf(id), fromName: classNameOf(m.from), to: where, attendanceDays: days(m.days) });
  }
  for (const a of delta.adds) addTo(a.student, a.to, a.days, !!a.toHold);
  for (const r of delta.removes) {
    const id = r.student.studentId!;
    const what = `${r.student.text} — "${r.from.name}"에서 빠짐`;
    if (addFailed.has(id)) { skip(what, LINKED_WHY); continue; }
    const src = sourceOf(id, r.from);
    if ("why" in src) skip(what, src.why);
    else if ("gone" in src) note(`${r.student.text} — 이미 "${r.from.name}"에서 빠져 있어 그대로 둡니다.`);
    else plan.removes.push({ enrollmentId: src.id, label: labelOf(id), className: classNameOf(r.from) });
  }
  return plan;
}
