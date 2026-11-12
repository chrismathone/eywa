"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import type { TemplatePrefs } from "../last-template";
import type { OneScreenStudent } from "../types";
import type { TodayClass } from "../server/roster";
import type { ReportsState } from "../session-input";
import type { SendClassAsk } from "./send-class-dialog";
import type { useSessionAutosave } from "./use-session-autosave";
import type { MakeupAttendanceDeps, MakeupI18n } from "./makeup-flow-types";
import { useMakeupAsk } from "./use-makeup-ask";
import { useMakeupApply } from "./use-makeup-apply";
import { useMakeupRow } from "./use-makeup-row";
import { useMakeupResolve } from "./use-makeup-resolve";

export type { MakeupAttendanceDeps } from "./makeup-flow-types";

/**
 * 보강 추가 흐름 — 수정 계획 P3-O 8/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 학생 고르기 → 합침/분리·수업·결석분을 묻는 확인창(`makeupAsk`) → 확인(`resolveMakeupAsk`)이 등록·합침·분리·결석 메모를 한다.
 * 보강 행의 수업 바꾸기(`pickMakeupClass`)·빼기(`removeMakeupRow`)도 여기. 저장 중(`makeupSaving`)엔 날짜 이동·다른 보강 동작을 막는다.
 * 🔴 결석·수업 후보 조회는 응답 순서 가드(`absenceSeq`·`hostSeq`)로 늦게 온 옛 응답이 새 창을 덮지 않게 한다.
 * 보강 학생 이전 진도 불러오기는 use-makeup-prev.ts.
 * batch C: 묻기 = use-makeup-ask.ts · 반영(결석분 연결·합침·분리) = use-makeup-apply.ts · 확인 = use-makeup-resolve.ts ·
 * 수업 바꾸기·빼기 = use-makeup-row.ts · 순수 판정 = makeup-ask-plan.ts로 나눴다. 화면 호출은 그대로다.
 */
export function useMakeupFlow({
  ctx,
  state: { students, setStudents, reports, setReports, studentsRef, templatePrefsRef },
  i18n,
  ui: { setSelId, setCardSubject, askSendClass },
  rows: { patch, readonlyBlocked, applySessionSaveResult },
  attendance: { setAttendanceFor, applyAttendanceLocal, withMark },
}: {
  ctx: {
    /** 조회 대상 날짜 원문(빈값 = 서버 오늘). */
    date: string;
    activeDate: string;
    classFilter: string;
    matchingClasses: TodayClass[];
    todayClasses: TodayClass[];
  };
  state: {
    students: OneScreenStudent[];
    setStudents: Dispatch<SetStateAction<OneScreenStudent[]>>;
    reports: ReportsState;
    setReports: Dispatch<SetStateAction<ReportsState>>;
    studentsRef: { readonly current: OneScreenStudent[] };
    templatePrefsRef: { readonly current: TemplatePrefs };
  };
  i18n: MakeupI18n;
  ui: {
    setSelId: Dispatch<SetStateAction<string>>;
    setCardSubject: Dispatch<SetStateAction<{ id: string; idx: number }>>;
    askSendClass: (ask: Omit<SendClassAsk, "resolve">) => Promise<string | null>;
  };
  rows: {
    patch: (id: string, fn: (s: OneScreenStudent) => OneScreenStudent) => void;
    readonlyBlocked: () => boolean;
    applySessionSaveResult: ReturnType<typeof useSessionAutosave>["applySessionSaveResult"];
  };
  attendance: MakeupAttendanceDeps;
}) {
  // 보강 저장 중 — 확인창 '확인'이 도는 동안 날짜 이동·다른 보강 동작을 막는다.
  const [makeupSaving, setMakeupSaving] = useState(false);
  const { makeupAsk, setMakeupAsk, addMakeupStudent, hostChoicesOf, loadAbsences } = useMakeupAsk({
    ctx,
    state: { students, reports },
    i18n,
    setSelId,
    readonlyBlocked,
  });
  const apply = useMakeupApply({
    activeDate: ctx.activeDate,
    state: { setReports, templatePrefsRef },
    i18n,
    ui: { setSelId, setCardSubject },
    patch,
    attendance: { setAttendanceFor, applyAttendanceLocal },
  });
  const { pickMakeupClass, removeMakeupRow } = useMakeupRow({
    activeDate: ctx.activeDate,
    todayClasses: ctx.todayClasses,
    state: { reports, setStudents },
    i18n,
    askSendClass,
    rows: { patch, readonlyBlocked },
    withMark,
  });
  const { resolveMakeupAsk } = useMakeupResolve({
    activeDate: ctx.activeDate,
    todayClasses: ctx.todayClasses,
    state: { setStudents, setReports, studentsRef, templatePrefsRef },
    i18n,
    setSelId,
    saving: { makeupSaving, setMakeupSaving },
    ask: { makeupAsk, setMakeupAsk, hostChoicesOf },
    apply,
    applySessionSaveResult,
  });
  return {
    makeupSaving,
    setMakeupSaving,
    makeupAsk,
    setMakeupAsk,
    addMakeupStudent,
    hostChoicesOf,
    pickMakeupClass,
    loadAbsences,
    removeMakeupRow,
    resolveMakeupAsk,
  };
}
