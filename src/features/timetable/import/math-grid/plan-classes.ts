// 격자에 새로 적힌 반 → 만들 반(DB에 넣을 모양) 또는 만들 수 없는 이유. 순수(apply-plan.ts의 앞 절반).

import { normalizeClassName, reservedClassNameReason } from "@/features/classes/class-name";
import { formatSchoolGrade } from "@/lib/format/school-grade";
import { norm } from "../match";
import { periodTimeOf, slotTimeText } from "./period-text";
import type { GridApplyPlan, PlanClass, PlanContext } from "./plan-types";
import type { GridDelta } from "./types";

export const DOW: Record<string, string> = { 월: "mon", 화: "tue", 수: "wed", 목: "thu", 금: "fri", 토: "sat", 일: "sun" };
export const newClassKey = (name: string) => `new:${norm(name)}`;

/**
 * 만들 반을 `plan.classes`에 싣고, 못 만드는 반은 이유와 함께 `plan.skipped`에 적는다.
 * 돌려주는 것 = 못 만드는 반(키 → 이유) — 그 반으로 가는 이동·추가도 함께 빠진다.
 */
export function planNewClasses(delta: GridDelta, ctx: PlanContext, plan: GridApplyPlan): Map<string, string> {
  const blocked = new Map<string, string>();
  for (const cls of delta.newClasses) {
    const name = normalizeClassName(cls.name);
    const fail = (why: string) => {
      blocked.set(newClassKey(cls.name), why);
      plan.skipped.push({ what: `새 반 "${name}"`, why });
    };
    const reserved = reservedClassNameReason(name);
    if (reserved) { fail(`${reserved}.`); continue; }
    // 반 이름 자리(칸 맨 윗줄)에 학생을 적으면 그 이름의 반이 만들어진다 — 명부의 이름·글자와 같으면 반으로 보지 않는다.
    const asStudent = norm(name);
    if (ctx.students.some((s) => norm(s.name) === asStudent || norm(`${s.name}/${formatSchoolGrade(s.school, s.grade)}`) === asStudent)) {
      fail("학생 이름이 반 이름 자리에 적혀 있습니다 — 학생은 반 이름·강의실 줄 아래에 적어 주세요.");
      continue;
    }
    if (ctx.classes.some((c) => norm(c.name) === norm(name))) {
      fail("같은 이름의 종강·폐지 반이 있습니다 — 수업목록에서 그 반의 이름을 바꾸거나 다른 이름으로 적어 주세요.");
      continue;
    }
    const teacherNames = [...new Set(cls.slots.map((s) => s.teacher.trim()))];
    if (teacherNames.length !== 1) { fail(`강사 열이 둘 이상입니다(${teacherNames.join(" · ")}) — 한 반은 한 강사 열에만 적어 주세요.`); continue; }
    const teachers = ctx.teachers.filter((t) => norm(t.name) === norm(teacherNames[0]!));
    if (teachers.length !== 1) {
      fail(teachers.length === 0 ? `"${teacherNames[0]}"은(는) 반을 맡을 수 있는 직원 명단에 없는 이름입니다.` : `"${teacherNames[0]}" 이름의 직원이 여럿이라 누구인지 정할 수 없습니다.`);
      continue;
    }
    if (ctx.weekendShifted && cls.slots.some((s) => s.weekend)) {
      fail("이 주 시간표는 앞 교시가 비어 있어 주말 칸의 시간을 확실히 읽을 수 없습니다 — 주말 반은 수업목록에서 만들어 주세요.");
      continue;
    }
    const rows = new Map<string, PlanClass["slots"][number]>();
    let timeProblem = "";
    for (const slot of cls.slots) {
      if (slot.days.length === 0) timeProblem = "요일을 읽지 못한 열에 놓여 있습니다.";
      for (const period of slot.periodIds) {
        const time = periodTimeOf(period, slot.weekend, ctx.periods);
        if (!time) { timeProblem = "학원 교시표에 없는 시간에 놓여 있습니다."; continue; }
        for (const day of slot.days) rows.set(`${day}|${time.startTime}`, { day: DOW[day]!, ...time });
      }
    }
    if (timeProblem || rows.size === 0) { fail(timeProblem || "수업 시간을 읽지 못했습니다."); continue; }

    const roomNames = [...new Set(cls.slots.map((s) => s.room.trim()).filter(Boolean))];
    const room = roomNames.length === 1 ? ctx.rooms.find((r) => !r.archived && norm(r.name) === norm(roomNames[0]!)) : undefined;
    if (roomNames.length === 0) plan.notes.push(`"${name}" — 강의실이 적혀 있지 않아 비워 둡니다.`);
    else if (roomNames.length > 1) plan.notes.push(`"${name}" — 강의실이 칸마다 다르게 적혀 있어(${roomNames.join(" · ")}) 비워 둡니다. 수업목록에서 넣어 주세요.`);
    else if (!room) plan.notes.push(`"${name}" — 강의실 "${roomNames[0]}"은(는) 등록된 강의실과 달라 비워 둡니다.`);

    plan.classes.push({
      key: newClassKey(cls.name),
      name,
      teacherId: teachers[0]!.id,
      teacherName: teachers[0]!.name,
      classroomId: room?.id ?? null,
      room: room?.name ?? "",
      slots: [...rows.values()],
      when: cls.slots.map((s) => `${s.days.join("·")} ${slotTimeText(s, ctx.periods)}`),
    });
  }
  for (const placed of delta.placedClasses) {
    plan.skipped.push({
      what: `"${placed.name}" 반`,
      why: "수업목록에 이미 있는 반이라 새로 만들지 않습니다(시트를 보낼 때는 이 주 시간표에 없던 반) — 수업 시간은 수업목록에서 확인해 주세요.",
    });
  }
  return blocked;
}
