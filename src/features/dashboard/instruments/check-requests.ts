/**
 * '확인할 일' 줄에서 바로 업무 요청 — 숫자에서 처리로(3.0 AX). 그 카드가 이미 받은 값으로 담당자·근거 학생을 미리 채운다.
 * 🔴 학생마다 맡을 담당자를 붙인다(원장 2026-11-02 *"담당에 담당 학생이 배정되는것처럼"*) — 그 학생 반의 지금 담임.
 * 담임은 사람 id가 있는 값에서만 고른다(이름으로 사람을 찾지 않는다 — 동명이인). 못 찾으면 담당 미정. 순수 함수(Vitest).
 */
import type { DraftStudent, WorkPrefill } from "@/features/work-requests/model";
import { missedTwice } from "./consult";
import type { DetailContext } from "./details-types";

export type RequestPrefill = WorkPrefill;

const shift = (ymd: string, days: number) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** 같은 학생·같은 담당자는 한 줄. 학생 수는 사람 단위로 센다. */
const uniq = (list: readonly DraftStudent[]) => [...new Map(list.map((s) => [`${s.id}|${s.assigneeId ?? ""}`, s])).values()];
const people = (list: readonly DraftStudent[]) => new Set(list.map((s) => s.id)).size;
const assigneesOf = (list: readonly DraftStudent[]) => [...new Set(list.flatMap((s) => (s.assigneeId ? [s.assigneeId] : [])))];

/** 그 줄로 만들 업무 요청의 초안. 요청할 근거가 없는 줄은 null. 기한은 사흘 뒤(바꿀 수 있다). */
export function requestPrefill(key: string, ctx: Pick<DetailContext, "snapshot" | "extras">): RequestPrefill | null {
  const { extras, snapshot } = ctx;
  const due = shift(snapshot.today, 3);
  if (key === "absence") {
    const lines = extras.absenceLines ?? [];
    if (!lines.length) return null;
    // 결석이 난 반마다 그 반 담임 — 두 반에서 빠진 학생은 두 담임에게 하나씩.
    const students = uniq(lines.map((l) => ({ id: l.studentId, name: l.name, assigneeId: l.teacherId })));
    return {
      title: "반복 결석 학생 확인 (14일 · 사전 통보 제외 3회 이상)", source: "check:absence", dueOn: due,
      body: `사전 통보 없이 3회 이상 결석한 학생 ${people(students)}명입니다. 맡은 학생의 결석 사유와 보강 계획을 확인해 주세요.`,
      criteria: "맡은 학생마다 결석 사유 · 보호자 연락 여부 · 보강 계획을 보고에 적는다",
      assigneeIds: assigneesOf(students), students,
    };
  }
  if (key === "homeroom") {
    const rows = (extras.consult?.homeroom?.rows ?? []).filter((r) => r.pending.some(missedTwice));
    if (!rows.length) return null;
    const students = uniq(rows.flatMap((r) => r.pending.filter(missedTwice).map((p) => ({ id: p.id, name: p.name, assigneeId: r.id }))));
    return {
      title: "지난달부터 담임 상담 없는 학생 상담", source: "check:homeroom", dueOn: due,
      body: `지난달 담임 상담이 없었고 이번 달도 아직인 학생 ${people(students)}명입니다.`,
      criteria: "맡은 학생마다 이번 달 상담을 원생상담에 기록한다",
      assigneeIds: assigneesOf(students), students,
    };
  }
  if (key === "homework") {
    const list = extras.report?.students ?? [];
    if (!list.length) return null;
    // 숙제가 나온 반의 담임 — 명단의 반 id로 맞춘다(반 이름·담임 이름으로 찾지 않는다).
    const students = uniq(list.flatMap((s): DraftStudent[] => {
      const classIds = new Set(s.classes.map((c) => c.classId));
      const teachers = [...new Set((extras.roster?.students[s.id] ?? []).filter((e) => classIds.has(e.classId)).flatMap((e) => (e.teacherId ? [e.teacherId] : [])))];
      return teachers.length ? teachers.map((t) => ({ id: s.id, name: s.name, assigneeId: t })) : [{ id: s.id, name: s.name, assigneeId: null }];
    }));
    return {
      title: "숙제 수행률 60% 미만 학생 확인 (최근 7일)", source: "check:homework", dueOn: due,
      body: `최근 7일 숙제 수행률 60% 미만 기록이 있는 학생 ${people(students)}명입니다.`,
      criteria: "맡은 학생마다 원인과 다음 수업 계획을 보고에 적는다",
      assigneeIds: assigneesOf(students), students,
    };
  }
  return null;
}
