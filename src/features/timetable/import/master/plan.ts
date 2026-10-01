import { parseTeacherGrid } from "../structure/parse-grid";
import {
  parseIntegratedRoster,
  classNameFromHeader,
} from "../roster/parse-roster";
import { matchRosterStudent } from "../roster/match-roster";
import { needsRosterConfirmation, rosterMatchReason } from "./roster-review";
import { computeRosterDiff } from "../roster/roster-diff";
import { matchStructure } from "../structure/match";
import { computeStructureDiff } from "../structure/diff";
import { buildClassUpdates } from "../structure/class-updates";
import {
  conflictChecklist,
  describeConflict,
  detectScheduleConflicts,
} from "../structure/conflicts";
import { roomToken } from "../../lib/room-token";
import { norm } from "../match";
import {
  canonicalSlotTeacherLabel,
  specialSlotLabel,
} from "../../lib/teacher-label";
import {
  enrollmentAssignBlockReason,
  isEnrollmentOnRosterOn,
  enrollmentPeriodsOverlap,
} from "@/features/enrollments/eligibility";
import {
  normalizeClassName,
  reservedClassNameReason,
} from "@/features/classes/class-name";
import type {
  MasterContext,
  MasterGrids,
  MasterInput,
  MasterIssue,
  MasterPlan,
} from "./types";
import type { RosterDesiredRow } from "../roster/roster-diff";
import { masterStudentConflicts } from "./student-conflicts";
import { buildClassMappings } from "./class-mappings";
import { buildTeacherMappings } from "./teacher-mappings";
const MANUAL_CLASS_FIX =
  "아래 ‘반 연결’에서 명단을 비교하고 기존 반을 직접 선택한 뒤 다시 검사하세요. 실제 신설 반이면 반 관리에서 프로그램 구분·담임을 지정해 먼저 만들어 주세요.";

export function columnName(index: number): string {
  let n = index + 1,
    out = "";
  while (n > 0) {
    n--;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out;
}

export function clipMasterGrid(
  grid: MasterGrids["teacher"],
  maxColumn: string,
): MasterGrids["teacher"] {
  if (!maxColumn.trim()) return grid;
  if (!/^[A-Z]{1,3}$/i.test(maxColumn))
    throw new Error("마지막 열은 EU처럼 열 문자로 입력해 주세요.");
  let end = 0;
  for (const c of maxColumn.toUpperCase())
    end = end * 26 + c.charCodeAt(0) - 64;
  return {
    ...grid,
    cells: grid.cells.map((r) => r.slice(0, end)),
    fills: grid.fills?.map((r) => r.slice(0, end)),
    merges: grid.merges
      .filter((m) => m.startColumnIndex < end)
      .map((m) => ({ ...m, endColumnIndex: Math.min(m.endColumnIndex, end) })),
  };
}

/** Order level ladders by the name they vacate. Never infer identity from a level number. */
export function orderRenames<
  T extends {
    classId: string;
    prevClassName?: string | null;
    className?: string | null;
  },
>(updates: T[]): T[] | null {
  const rest = updates.filter(
    (u) => u.className && u.className !== u.prevClassName,
  );
  const ordered: T[] = [];
  while (rest.length) {
    const i = rest.findIndex(
      (u) =>
        !rest.some(
          (v) => v !== u && norm(v.prevClassName) === norm(u.className),
        ),
    );
    if (i < 0) return null;
    ordered.push(rest.splice(i, 1)[0]!);
  }
  return [
    ...ordered,
    ...updates.filter((u) => !u.className || u.className === u.prevClassName),
  ];
}

export function buildMasterPlan(
  input: MasterInput,
  grids: MasterGrids,
  ctx: MasterContext,
  source: MasterPlan["source"],
): MasterPlan {
  const issues: MasterIssue[] = [];
  const issue = (x: MasterIssue) => {
    if (!issues.some((v) => v.key === x.key)) issues.push(x);
  };
  const roster = parseIntegratedRoster(grids.roster.cells);
  const raw = parseTeacherGrid(clipMasterGrid(grids.teacher, input.maxColumn));
  const teacherMappings = buildTeacherMappings(
    raw.teachers,
    ctx.teachers,
    input.teacherBindings,
  );
  for (const t of teacherMappings)
    if (Object.hasOwn(input.teacherBindings ?? {}, t.sheetName) && !t.teacherId)
      issue({
        key: `teacher-binding:${t.sheetName}`,
        severity: "error",
        target: t.sheetName,
        reason: t.manualReason!,
        fix: "아래 ‘강사 연결’에서 활성 강사를 선택하고 다시 검사하세요.",
      });
  const teacherByLabel = new Map(teacherMappings.map((m) => [m.sheetName, m]));
  const teacherLabel = (name: string) => {
    const id = teacherByLabel.get(name)?.teacherId;
    const teacher = id ? ctx.teachers.find((t) => t.id === id) : null;
    return teacher
      ? teacher.englishName || teacher.displayName
      : (canonicalSlotTeacherLabel(name) ?? name);
  };
  const memoSlots = raw.slots.filter(
    (s) =>
      /^\d+(\.\d+)?$/.test(s.className) ||
      (/^EiE\s+/i.test(s.className) &&
        !!specialSlotLabel(s.className.replace(/^EiE\s+/i, ""))),
  );
  const sourceSlots = raw.slots.filter((s) => !memoSlots.includes(s));
  const parsed = {
    ...raw,
    slots: sourceSlots.map((s) => ({
      ...s,
      teacherName: teacherLabel(s.teacherName),
    })),
    blocks: raw.blocks.map((s) => ({
      ...s,
      teacherName: teacherLabel(s.teacherName),
    })),
  };
  for (const s of memoSlots)
    issue({
      key: `memo:${s.grid.r1}:${s.grid.c1}:${s.className}`,
      severity: "warning",
      target: s.className,
      reason: "인원 숫자 또는 자리 설명으로 읽어 반 생성에서 제외했습니다.",
      fix: "원본 칸에 실제 반 이름이 따로 적혀 있는지 확인해 주세요.",
      tab: input.teacherTab,
      cell: `${columnName(s.grid.c1)}${s.grid.r1 + 1}`,
    });
  const ref = (name: string) => {
    const s = parsed.slots.find((s) => s.className === name);
    return s
      ? {
          tab: input.teacherTab,
          cell: `${columnName(s.grid.c1)}${s.grid.r1 + 1}`,
        }
      : { tab: input.rosterTab };
  };
  if (
    !parsed.slots.length ||
    !roster.blocks.length ||
    !roster.blocks.some((b) => b.entries.length)
  )
    issue({
      key: "empty",
      severity: "error",
      target: "대상 탭",
      reason: "수업 배치 또는 학생 명단을 읽지 못했습니다.",
      fix: "같은 달의 강사별 탭과 통합 탭을 선택하고 읽을 마지막 열을 확인해 주세요.",
    });
  for (const m of roster.mismatches)
    issue({
      key: `count:${m.className}`,
      severity: "error",
      target: m.className,
      reason: `읽은 학생 ${m.parsed}명과 시트 인원 ${m.declared}명이 다릅니다.`,
      fix: "통합 탭의 학생 이름·학교 열, 인원 수식과 병합을 수정한 뒤 다시 검사해 주세요.",
      tab: input.rosterTab,
    });
  for (const w of raw.warnings)
    issue({
      key: `parse:${w}`,
      severity: "warning",
      target: "강사별 탭",
      reason: w,
      fix: "원본 수업 칸과 마지막 열을 확인해 주세요.",
      tab: input.teacherTab,
    });
  for (const p of ctx.pending)
    issue({
      key: `pending:${p.id}`,
      severity: "error",
      target: `${p.date} ${p.label}`,
      reason: "이 적용일 이후의 반영 예약이 이미 있습니다.",
      fix: "시간표에서 기존 예약을 확인·취소한 뒤 다시 검사해 주세요. 기존 예약을 덮어쓰지 않습니다.",
      href: "/timetable?subject=english",
    });
  for (const s of ctx.schedules.filter(
    (s) =>
      ctx.classes.some((c) => c.id === s.classId) &&
      s.validFrom > input.effectiveDate,
  ))
    issue({
      key: `later:${s.id}`,
      severity: "error",
      target: s.className,
      reason: `${s.validFrom}부터 시작하는 수업 배치가 이미 예약되어 있습니다.`,
      fix: "적용일 이후의 예약 배치를 반 관리에서 먼저 정리해 주세요.",
      href: `/classes/${s.classId}`,
    });
  for (const b of ctx.blocks.filter((b) => b.validFrom > input.effectiveDate))
    issue({
      key: `later-block:${b.id}`,
      severity: "error",
      target: b.teacherName,
      reason: `${b.validFrom}부터 시작하는 강사 근무 블록이 있습니다.`,
      fix: "시간표에서 기존 예약을 확인·정리한 뒤 다시 검사해 주세요.",
      href: "/timetable?subject=english",
    });

  const active = ctx.classes.filter(
    (c) => c.active && (!c.closedAt || c.closedAt >= input.effectiveDate),
  );
  const byStudent = new Map(ctx.students.map((s) => [s.studentId, s]));
  const current = ctx.enrollments.filter((e) =>
    isEnrollmentOnRosterOn(e, input.effectiveDate),
  );
  const englishCurrent = current.filter((e) =>
    active.some((c) => c.id === e.classId),
  );
  const desired: RosterDesiredRow[] = [];
  const resolvedStudents = new Map<string, string[]>();
  for (const block of roster.blocks) {
    const ids: string[] = [];
    for (const entry of block.entries) {
      const match = matchRosterStudent(
        entry.name,
        entry.school,
        entry.grade,
        ctx.students,
      );
      if (match.status !== "ok") {
        issue({
          key: `student:${block.className}:${entry.raw}`,
          severity: "error",
          target: `${block.className} · ${entry.raw}`,
          reason:
            match.status === "none"
              ? `학생을 찾지 못했습니다 (${entry.school ?? "학교 없음"} ${entry.grade ?? "학년 없음"}).`
              : `동명이인을 확정하지 못했습니다: ${match.candidates.map((c) => `${c.name} / ${c.school ?? "학교 없음"} ${c.grade ?? ""}`).join(", ")}`,
          fix: "원본 학생 이름·학교·학년을 맞추거나 에이와 학생 정보를 수정한 뒤 다시 검사해 주세요.",
          tab: input.rosterTab,
          href: "/students",
        });
        continue;
      }
      const student = byStudent.get(match.studentId)!;
      const blocked =
        student.status === "on_hold"
          ? null
          : enrollmentAssignBlockReason(student.status);
      if (blocked)
        issue({
          key: `status:${student.studentId}`,
          severity: "error",
          target: `${block.className} · ${student.name}`,
          reason: blocked,
          fix: "학생 상세에서 실제 재원 상태를 확인·수정한 뒤 다시 검사해 주세요.",
          tab: input.rosterTab,
          href: `/students/${student.studentId}`,
        });
      if (needsRosterConfirmation(entry.name, match, ctx.students))
        issue({
          key: `match:${block.className}:${student.studentId}`,
          severity: "confirm",
          target: `${block.className} · ${entry.name} → ${student.name}`,
          reason: `${match.viaSuffix ? "시트와 에이와의 이름 표기가 다릅니다." : "동일한 이름의 학생 기록이 여러 개입니다."} 연결 근거: ${rosterMatchReason(match)} (${student.school ?? "학교 없음"} ${student.grade ?? ""}).`,
          fix: "같은 학생인지 확인해 주세요. 다르면 학생 정보 또는 원본 이름을 수정해 주세요.",
          href: `/students/${student.studentId}`,
          tab: input.rosterTab,
        });
      ids.push(match.studentId);
    }
    resolvedStudents.set(block.className, ids);
  }

  const sheetNames = [
    ...new Set([
      ...parsed.slots.map((s) => s.className),
      ...roster.blocks.map((b) => b.className),
    ]),
  ].sort((a, b) => a.localeCompare(b, "ko"));
  const mappings = buildClassMappings(
    sheetNames,
    active,
    englishCurrent,
    resolvedStudents,
    new Map(roster.blocks.map((b) => [b.className, b.entries.length])),
    input.classBindings,
  );
  for (const m of mappings)
    if (m.manualReason)
      issue({
        key: `${m.suggestedId ? "identity" : "class"}:${m.sheetName}`,
        severity: "error",
        target: m.sheetName,
        reason: m.manualReason,
        fix: MANUAL_CLASS_FIX,
        href: "/classes",
        ...ref(m.sheetName),
      });
  const renamed = mappings.filter(
    (m) => m.classId && m.currentName !== m.sheetName,
  );
  for (const m of mappings.filter((m) => m.classId)) {
    const same = mappings.filter((v) => v.classId === m.classId);
    if (same.length > 1)
      issue({
        key: `mapping:${m.classId}`,
        severity: "error",
        target: same.map((v) => v.sheetName).join(" / "),
        reason: "여러 시트 반이 같은 에이와 반에 연결되었습니다.",
        fix: "반 연결을 하나씩 지정해 주세요. 합반이어도 반 기록은 각각 유지합니다.",
      });
    const error = reservedClassNameReason(m.sheetName);
    if (error || normalizeClassName(m.sheetName) !== m.sheetName)
      issue({
        key: `name:${m.sheetName}`,
        severity: "error",
        target: m.sheetName,
        reason: error ?? "에이와 반 이름 표기와 다릅니다.",
        fix: `원본 반 이름을 ‘${normalizeClassName(m.sheetName)}’ 표기로 정리해 주세요.`,
        ...ref(m.sheetName),
      });
    const held = ctx.classes.find(
      (c) => c.id !== m.classId && norm(c.className) === norm(m.sheetName),
    );
    if (held && !renamed.some((r) => r.classId === held.id))
      issue({
        key: `held:${m.sheetName}`,
        severity: "error",
        target: m.sheetName,
        reason: `${held.active ? "다른" : "보관된"} 반이 이 이름을 사용하고 있습니다.`,
        fix: "그 반의 이름을 먼저 정리하거나 반 연결을 수정해 주세요. 보관 반에도 이름 중복 규칙이 적용됩니다.",
        href: `/classes/${held.id}`,
      });
  }
  const nameById = new Map(
    mappings.filter((m) => m.classId).map((m) => [m.classId!, m.sheetName]),
  );
  const mappedClasses = active.map((c) => ({
    ...c,
    className: nameById.get(c.id) ?? c.className,
  }));
  const structureCtx = {
    classes: mappedClasses,
    teachers: ctx.teachers,
    classrooms: ctx.classrooms,
  };
  const match = matchStructure(parsed, structureCtx);
  for (const [i, s] of match.resolved.entries()) {
    const binding = teacherByLabel.get(sourceSlots[i]!.teacherName);
    if (binding && !specialSlotLabel(s.teacherName))
      s.teacherId = binding.teacherId;
  }
  for (const [i, s] of match.resolved.entries()) {
    const other = match.resolved
      .slice(0, i)
      .find(
        (v) =>
          v.classId &&
          v.classId === s.classId &&
          v.day === s.day &&
          v.startTime === s.startTime,
      );
    if (
      other &&
      (other.endTime !== s.endTime ||
        roomToken(other.room) !== roomToken(s.room))
    )
      issue({
        key: `ambiguous-slot:${s.classId}:${s.day}:${s.startTime}`,
        severity: "error",
        target: s.className,
        reason: `같은 요일·시작시각 ${s.startTime}에 종료시각이나 강의실이 다른 배치가 있습니다.`,
        fix: "원본의 중복 배치를 정리해 주세요. 한 배치만 선택해 저장할 수 없습니다.",
        tab: input.teacherTab,
        cell: `${columnName(s.grid.c1)}${s.grid.r1 + 1}`,
      });
  }
  for (const [i, s] of match.resolved.entries()) {
    const where = {
      tab: input.teacherTab,
      cell: `${columnName(s.grid.c1)}${s.grid.r1 + 1}`,
    };
    if (!s.teacherId && !specialSlotLabel(s.teacherName))
      issue({
        key: `teacher:${s.teacherName}`,
        severity: "error",
        target: `${s.className} · ${s.teacherName}`,
        reason:
          teacherByLabel.get(sourceSlots[i]!.teacherName)?.manualReason ??
          "활성 강사 계정과 연결되지 않습니다.",
        fix: "아래 ‘강사 연결’에서 담당자를 선택한 뒤 다시 검사하세요. 원본의 한글 이름과 일치하는 추천도 확인할 수 있습니다. LAB·JJ는 자리로 처리합니다.",
        ...where,
      });
    if (s.room && !s.classroomId && !specialSlotLabel(s.room))
      issue({
        key: `room:${s.room}`,
        severity: "error",
        target: `${s.className} · ${s.room}`,
        reason: "사용 가능한 강의실과 연결되지 않습니다.",
        fix: "강의실 설정에서 보관 여부·이름을 확인하거나 원본 방 번호를 수정해 주세요.",
        ...where,
      });
    if (!s.endTime || s.endTime <= s.startTime)
      issue({
        key: `time:${s.grid.r1}:${s.grid.c1}`,
        severity: "error",
        target: s.className,
        reason: `${s.startTime}~${s.endTime ?? "종료시각 없음"} 수업 시간을 확정할 수 없습니다.`,
        fix: "원본 시간 축과 병합 범위를 수정해 주세요.",
        ...where,
      });
  }
  const allLive = ctx.schedules.filter(
    (s) =>
      active.some((c) => c.id === s.classId) &&
      s.validFrom <= input.effectiveDate &&
      (!s.validTo || s.validTo >= input.effectiveDate),
  );
  const covered = new Set(
    match.resolved.map((s) => s.classId).filter((v): v is string => !!v),
  );
  const omittedClasses = active
    .filter(
      (c) => allLive.some((s) => s.classId === c.id) && !covered.has(c.id),
    )
    .map((c) => ({
      id: c.id,
      name: c.className,
      slots: allLive.filter((s) => s.classId === c.id).length,
    }));
  for (const id of input.closeClassIds ?? [])
    if (!omittedClasses.some((c) => c.id === id))
      issue({
        key: `close:${id}`,
        severity: "error",
        target: "배치 마감 선택",
        reason: "마감 대상 반이 변경되었습니다.",
        fix: "시트에 없는 반 목록을 다시 확인하고 선택을 정리해 주세요.",
      });
  const live = allLive.filter(
    (s) => covered.has(s.classId) || input.closeClassIds?.includes(s.classId),
  );
  const report = computeStructureDiff(
    match,
    live.map((s) => ({
      ...s,
      className: nameById.get(s.classId) ?? s.className,
    })),
  );
  const replaced = new Set(report.planItems.map((p) => p.scheduleId));
  // Preserve unchanged slots in the conflict check, including classes omitted from the sheet.
  report.conflicts = detectScheduleConflicts(
    [
      ...allLive
        .filter((s) => !replaced.has(s.id))
        .map((s) => ({
          classId: s.classId,
          className: nameById.get(s.classId) ?? s.className,
          day: s.day,
          startTime: s.startTime,
          endTime: s.endTime,
          room:
            s.slotRoomLabel ??
            ctx.classrooms.find((r) => r.id === s.classroomId)?.name ??
            null,
          classroomId: s.classroomId,
          teachers: [
            {
              teacherId: s.teacherId,
              name: teacherLabel(
                s.slotTeacherLabel ??
                  ctx.teachers.find((t) => t.id === s.teacherId)?.englishName ??
                  ctx.teachers.find((t) => t.id === s.teacherId)?.displayName ??
                  "",
              ),
            },
          ],
          starred: false,
        })),
      ...report.planItems
        .filter((p) => p.action === "create" || p.action === "update")
        .map((p) => ({
          classId: p.classId!,
          className: p.className,
          day: p.day,
          startTime: p.startTime,
          endTime: p.endTime,
          room: p.room,
          classroomId: p.classroomId ?? null,
          teachers: p.teacherNames.map((name) => ({
            name,
            teacherId: p.teacherId ?? null,
          })),
          starred: false,
        })),
    ],
    report.planItems,
  );
  for (const w of report.warnings.filter((w) => w.includes("첫 강사")))
    issue({
      key: `multi-teacher:${w}`,
      severity: "confirm",
      target: "복수 강사 배치",
      reason: w,
      fix: "한 교시에 저장될 담당 강사를 확인하거나 원본을 정리해 주세요.",
      tab: input.teacherTab,
    });
  for (const c of report.conflicts)
    issue({
      key: `conflict:${c.key}`,
      severity: conflictChecklist([c]).length ? "confirm" : "warning",
      target: `${c.a.className} / ${c.b.className}`,
      reason: describeConflict(c),
      fix:
        c.kind === "merged"
          ? "같은 강사·같은 방의 합반은 에이와 규칙에 따라 허용합니다."
          : "수업 시각·강사·강의실을 수정하거나, 의도한 배치인지 확인해 주세요.",
      tab: input.teacherTab,
    });
  for (const c of omittedClasses) {
    const close = input.closeClassIds?.includes(c.id);
    issue({
      key: `vanished:${c.id}`,
      severity: close ? "confirm" : "warning",
      target: c.name,
      reason: close
        ? `이 반의 기존 수업 ${c.slots}개를 적용일 전날까지 마감합니다.`
        : `시트에 없어 이 반의 기존 수업 ${c.slots}개를 유지합니다.`,
      fix: "진급이면 반 연결에서 원래 반을 선택하세요. 수업을 없앨 반은 아래 마감 대상에서 선택하고 학생 명단도 확인하세요.",
      href: `/classes/${c.id}`,
    });
  }
  for (const block of roster.blocks) {
    const classId = mappings.find(
      (m) => m.sheetName === block.className,
    )?.classId;
    if (!classId) continue;
    for (const studentId of resolvedStudents.get(block.className) ?? []) {
      const s = byStudent.get(studentId)!;
      desired.push({
        studentId,
        studentName: s.name,
        school: s.school,
        grade: s.grade,
        classId,
        className: block.className,
      });
    }
  }
  const diff = computeRosterDiff(
    desired,
    englishCurrent.map((e) => ({
      enrollmentId: e.id,
      studentId: e.studentId,
      studentName: byStudent.get(e.studentId)?.name ?? "",
      classId: e.classId,
      className: ctx.classes.find((c) => c.id === e.classId)?.className ?? "",
    })),
    new Set(desired.map((d) => d.classId)),
  );
  // Missing from a sheet is not a withdrawal. Keep these enrollments, and show them explicitly.
  for (const r of diff.removes)
    issue({
      key: `retained:${r.enrollmentId}`,
      severity: "warning",
      target: `${r.className} · ${r.studentName}`,
      reason: "시트 명단에 없지만 기존 수강을 유지합니다.",
      fix: "실제 수강 종료라면 학생 상세에서 종료일을 지정해 주세요.",
      href: `/students/${ctx.enrollments.find((e) => e.id === r.enrollmentId)?.studentId}`,
    });
  diff.removes = [];
  for (const m of diff.moves) {
    const e = ctx.enrollments.find((e) => e.id === m.enrollmentId)!;
    if (e.isTransferred || e.endDate)
      issue({
        key: `move:${e.id}`,
        severity: "error",
        target: m.studentName,
        reason: "기존 수강에 이동 또는 종료가 이미 예약되어 있습니다.",
        fix: "학생 상세에서 기존 예약을 정리한 뒤 다시 검사해 주세요.",
        href: `/students/${e.studentId}`,
      });
  }
  const gains = [
    ...diff.adds.map((a) => ({
      studentId: a.studentId,
      classId: a.classId,
      name: a.studentName,
    })),
    ...diff.moves.map((m) => ({
      studentId: ctx.enrollments.find((e) => e.id === m.enrollmentId)!
        .studentId,
      classId: m.toClassId,
      name: m.studentName,
    })),
  ];
  for (const g of gains)
    for (const e of ctx.enrollments) {
      if (
        e.studentId === g.studentId &&
        e.classId === g.classId &&
        enrollmentPeriodsOverlap(
          e.startDate,
          e.endDate,
          input.effectiveDate,
          null,
        )
      )
        issue({
          key: `period:${e.id}`,
          severity: "error",
          target: g.name,
          reason: `같은 반의 기존 수강(${e.startDate}~${e.endDate ?? "계속"})과 기간이 겹칩니다.`,
          fix: "학생 상세에서 중복·미래 수강 기간을 정리해 주세요.",
          href: `/students/${g.studentId}`,
        });
    }
  for (const p of report.planItems.filter(
    (p) => p.action === "remove" || p.action === "update",
  )) {
    const old = live.find((s) => s.id === p.scheduleId);
    if (!old) continue;
    const stuck = ctx.attendance.filter(
      (a) =>
        a.classId === old.classId &&
        a.startTime === old.startTime &&
        ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
          new Date(`${a.date}T12:00:00Z`).getUTCDay()
        ] === old.day,
    );
    if (stuck.length)
      issue({
        key: `attendance:${old.id}`,
        severity: "error",
        target: `${old.className} ${old.startTime}`,
        reason: `${stuck[0]!.date}부터 해당 교시의 출결 ${stuck.length}건이 이미 기록되어 있습니다.`,
        fix: "적용일을 기록 이후로 옮기거나 해당 출결을 확인·정리한 뒤 다시 검사해 주세요.",
        href: `/classes/${old.classId}`,
      });
  }
  for (const m of diff.moves) {
    const e = ctx.enrollments.find((e) => e.id === m.enrollmentId)!;
    const stuck = ctx.attendance.filter(
      (a) => a.classId === e.classId && a.studentId === e.studentId,
    );
    if (stuck.length)
      issue({
        key: `student-attendance:${e.id}`,
        severity: "error",
        target: m.studentName,
        reason: `적용일 이후 이전 반의 출결 ${stuck.length}건이 있습니다.`,
        fix: "적용일 또는 학생 출결을 먼저 확인해 주세요.",
        href: `/students/${e.studentId}`,
      });
  }
  const updates = buildClassUpdates(
    match,
    structureCtx,
    new Set(
      report.planItems
        .filter((p) => p.action !== "keep" && p.classId)
        .map((p) => p.classId!),
    ),
  );
  for (const m of renamed) {
    const c = active.find((c) => c.id === m.classId)!;
    const u = updates.find((u) => u.classId === m.classId);
    if (u) {
      u.className = m.sheetName;
      u.prevClassName = c.className;
    } else
      updates.push({
        classId: c.id,
        className: m.sheetName,
        prevClassName: c.className,
        teacherId: null,
        classroomId: null,
        prevTeacherId: c.teacherId,
        prevClassroomId: c.classroomId,
      });
  }
  const ordered = orderRenames(updates);
  if (!ordered)
    issue({
      key: "rename-cycle",
      severity: "error",
      target: "반 이름 변경",
      reason: "서로의 이름을 교환하는 순환 연결입니다.",
      fix: "반 연결을 확인하고 필요한 반은 반 관리에서 임시 이름으로 변경한 뒤 다시 검사해 주세요.",
    });

  const rows = new Map<number, { col: number; id: string }[]>();
  for (const mg of grids.roster.merges) {
    const text =
      grids.roster.cells[mg.startRowIndex]?.[mg.startColumnIndex] ?? "";
    const name = classNameFromHeader(text);
    const mapping = mappings.find((m) => m.sheetName === name);
    if (!mapping?.classId || !/\d\s*:\s*\d/.test(text)) continue;
    const row = rows.get(mg.startRowIndex) ?? [];
    row.push({ col: mg.startColumnIndex, id: mapping.classId });
    rows.set(mg.startRowIndex, row);
  }
  const groups = [...rows]
    .sort((a, b) => a[0] - b[0])
    .map(([row, items], i) => {
      const title =
        grids.roster.cells
          .slice(row, row + 4)
          .flatMap((r) => r.slice(0, 2))
          .find((v) => /\d{1,2}:\d{2}/.test(v))
          ?.replace(/\s+/g, " ")
          .trim() ?? `${i + 1}번째 줄`;
      return {
        id: `sheet-${i + 1}`,
        title,
        classIds: [
          ...new Set(items.sort((a, b) => a.col - b.col).map((v) => v.id)),
        ],
      };
    });
  if (!groups.length)
    issue({
      key: "groups",
      severity: "error",
      target: "통합 시간표 그룹",
      reason: "반 블록의 줄 배치를 읽지 못했습니다.",
      fix: "통합 탭의 반 머리글과 병합을 확인해 주세요.",
      tab: input.rosterTab,
    });
  const plan = {
    report,
    roster: diff,
    issues,
    mappings,
    teacherMappings,
    omittedClasses,
    classUpdates: ordered ?? updates,
    blocks: parsed.blocks,
    groups,
    source,
    effectiveDate: input.effectiveDate,
  };
  for (const conflict of masterStudentConflicts(plan, ctx)) issue(conflict);
  return plan;
}
