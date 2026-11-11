"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import type { TemplatePrefs } from "../last-template";
import { makeupRowName } from "../makeup-label";
import type { OneScreenStudent } from "../types";
import { linkMakeupToAbsence } from "@/features/attendance/server/actions";
import type { MakeupConfirmChoice } from "@/features/attendance/components/makeup-confirm-dialog";
import { noteMakeupAgainstAbsence } from "@/features/attendance/server/makeup-note-action";
import { mergeStatusOf, type MergeCandidate } from "../makeup-merge-plan";
import { initReports, type ReportsState } from "../session-input";
import { shortDate } from "../makeup-absence-link";
import { pendingMakeupRows } from "../makeup-ask-plan";
import type { MakeupAttendanceDeps, MakeupI18n, PatchStudent } from "./makeup-flow-types";

/**
 * 보강 확인 뒤 화면에 반영하는 일 — 결석분 연결(메모·시수)·추가 보강 시수·정규 행에 합침·따로 "(보강)" 행 만들기.
 * 수정 계획 P3-O batch C, `use-makeup-flow.ts`에서 나눔(본문 그대로). 순서·토스트는 확인 흐름(use-makeup-resolve.ts)이 정한다.
 */
export function useMakeupApply({
  activeDate,
  state: { setReports, templatePrefsRef },
  i18n: { t, tf },
  ui: { setSelId, setCardSubject },
  patch,
  attendance: { setAttendanceFor, applyAttendanceLocal },
}: {
  activeDate: string;
  state: { setReports: Dispatch<SetStateAction<ReportsState>>; templatePrefsRef: { readonly current: TemplatePrefs } };
  i18n: MakeupI18n;
  ui: {
    setSelId: Dispatch<SetStateAction<string>>;
    setCardSubject: Dispatch<SetStateAction<{ id: string; idx: number }>>;
  };
  patch: PatchStudent;
  attendance: Pick<MakeupAttendanceDeps, "setAttendanceFor" | "applyAttendanceLocal">;
}) {
  /**
   * 정규 행이 없는 보강의 결석분 연결 — 시수는 **오늘 보강한 반**(앵커)에, 메모는 **결석이 난 반**에.
   * 🔴 이월 보강(반 이동)은 두 반이 다르다 — 하나로 묶으면 옛 반에 시수가 붙어 급여 귀속이 틀린다.
   */
  async function linkMakeupToAbsenceCell(
    studentId: string,
    makeupClassId: string,
    choice: MakeupConfirmChoice,
    name: string,
    /** 성공 안내 끝에 붙일 한 줄(새로고침 뒤 옮겨 가는 반) — 실패하면 안 붙는다. */
    note?: string,
  ) {
    // 🔴 시수는 등록 문(`registerMakeupEntries` — 못 세웠으면 보고서 저장 훅)이 그 반 칸을 세울 때 적었다 — 여기선 **메모만**(합산 액션을 쓰면 두 번 더해진다).
    const res = await noteMakeupAgainstAbsence({
      studentId,
      makeupClassId,
      makeupDate: activeDate,
      absentClassId: choice.absentClassId ?? makeupClassId,
      absentDate: choice.absentDate!,
    });
    if ("error" in res) {
      toast.error(tf("os.c.absenceLinkFail", { error: res.error }));
      return;
    }
    const msg = res.absenceNoted
      ? tf("os.c.makeupNoted", {
          name,
          date: shortDate(choice.absentDate!),
          units: choice.addUnits,
        })
      : tf("os.c.makeupNoRecord", {
          name,
          units: choice.addUnits,
          date: shortDate(choice.absentDate!),
        });
    toast.success(note ? `${msg} ${note}` : msg);
  }
  /**
   * 분리 보강을 **결석분에 연결** — 결석한 날 칸엔 메모만("N/N 보강 예정", 결석 0은 그대로),
   * 보강한 날(=보고 있는 날짜) 칸엔 시수 +addUnits + 메모("N/N 결석분 보강"). 원장 2026-08-06 사양이자
   * 현재 구글시트 출석부 운영과 같은 모양. 낙관 표시는 보강한 날 행에만 반영한다.
   */
  async function linkMakeupAbsence(
    existing: OneScreenStudent,
    target: MergeCandidate,
    absentDate: string,
    addUnits: number,
    absentClassId?: string,
    /** 성공 안내 끝에 붙일 한 줄(새로고침 뒤 카드가 옮겨 가는 반 등) — 실패하면 안 붙는다. */
    note?: string,
  ) {
    const withNote = (msg: string) => (note ? `${msg} ${note}` : msg);
    const res = await linkMakeupToAbsence({
      studentId: existing.id,
      classId: target.classId,
      absentDate,
      // 이월 보강 — 결석이 난 반이 다르면 메모는 그 반 칸에 붙는다(시수는 target 반).
      absentClassId,
      makeupDate: activeDate,
      addUnits,
    });
    if ("error" in res) {
      toast.error(tf("os.c.makeupUnitsFail", { error: res.error }));
      return;
    }
    // 화면의 그 행 시수도 서버 결과로 맞춘다(1이면 서버가 null로 접으므로 같은 규칙으로).
    // ⚠️ 기록이 없던 날엔 서버가 '출석'으로 열었다 — 화면 raw도 같이 present로 맞춰야 표시가 안 갈린다.
    // 조퇴 칸이면 raw는 조퇴 그대로 — 배지는 행에서 다시 계산한다(`studentMarkFromRows`, 조퇴는 '조퇴').
    const linkedRaw = target.attendanceRaw ?? "present";
    applyAttendanceLocal(existing.id, target.classId, linkedRaw, { units: res.units === 1 ? null : res.units });
    if (res.alreadyLinked) {
      toast.message(withNote(tf("os.c.makeupAlreadyLinked", { date: shortDate(absentDate) })));
      return;
    }
    // ⚠️ 결석 기록이 없던 날이면 메모를 안 남긴다 — 조용히 넘기지 말고 그 사실을 밝힌다.
    toast.success(withNote(
      res.absenceNoted
        ? tf("os.c.makeupNoted2", {
            name: existing.name,
            date: shortDate(absentDate),
            target: target.name,
            units: res.units,
          })
        : // 선보강(아직 안 지난 날)이면 "기록이 없다"가 아니라 **아직 오지 않았다**가 사실이다 —
          //    같은 문장으로 뭉뚱그리면 강사가 "왜 기록이 없지?" 하고 출석부를 뒤진다.
          absentDate > activeDate
          ? tf("os.c.makeupFuture", {
              name: existing.name,
              target: target.name,
              units: res.units,
              date: shortDate(absentDate),
            })
          : tf("os.c.makeupNoRecord2", {
              name: existing.name,
              target: target.name,
              units: res.units,
              date: shortDate(absentDate),
            })),
      { duration: 8000 },
    );
  }
  /**
   * 추가 보강(결석분 연결 없음) — 보강 행은 이미 따로 만들었고, 여기서는 **그 날 칸의 시수만** 올린다.
   * ⚠️ 정규 행에 `makeup: true`를 켜지 않는다 — 그건 '합침'(제목 "(정규+보강)", 보고서 1건)의 표시다.
   *    분리는 보고서가 2건이므로 정규 행은 정규 그대로 둔다.
   */
  function addMakeupUnitsOnly(existing: OneScreenStudent, target: MergeCandidate, addUnits: number, note?: string) {
    const units = (target.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      target.classId,
      mergeStatusOf(target.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 보강 시수 합산은 성공 안내를 이미 띄웠다 — conflict no-op이면 안내가 거짓이 된다
    );
    setSelId(existing.id);
    const msg = tf("os.c.makeupExtra", { name: existing.name, target: target.name, units });
    toast.success(note ? `${msg} ${note}` : msg, { duration: 8000 });
  }
  /** 합침 — 정규 행에 보강 표시를 켜고(제목 "(정규+보강)", makeup-label.ts) 출석부 수업타임을 얹는다. */
  function mergeMakeupIntoRegular(
    existing: OneScreenStudent,
    merge: MergeCandidate,
    addUnits: number,
    sent: boolean,
  ) {
    patch(existing.id, (s) => ({
      ...s,
      subjects: s.subjects.map((x) => (x.name === merge.name ? { ...x, makeup: true } : x)),
    }));
    // 수업타임 = 지금 값(미입력=1) + 강사가 고른 보강 시수. 출결이 비어 있으면 '출석'으로 함께 찍힌다.
    // 🔴 조퇴 칸은 **조퇴 그대로**(`mergeStatusOf`) — 메모(조퇴 사유)는 안 보내므로 서버가 그대로 둔다(원장 2026-09-30).
    // 🔴 보강 시수를 1로 박지 않는다 — 수학은 0.5당 1시간이라 3시간 반의 1회는 1.5다(원장 2026-08-06).
    const units = (merge.attendanceUnits ?? 1) + addUnits;
    void setAttendanceFor(
      existing.id,
      merge.classId,
      mergeStatusOf(merge.attendanceRaw),
      { units: String(units) },
      { overwrite: true }, // 합침 시수 합산도 위와 동일 — 비파괴 보호는 알약 첫 체크 전용
    );
    setSelId(existing.id);
    if (sent) {
      // 발송본 잠금이라 보강 내용은 못 싣는다 — 다이얼로그에서 이미 알렸지만 결과도 그대로 밝힌다.
      toast.warning(
        // ⚠️ 숫자 뒤 조사 금지(받침이 값마다 다르다 — 2=이/3=삼) → 수치는 괄호로 뗀다.
        tf("os.c.mergeSent", { name: existing.name, target: merge.name, units }),
        { duration: 10000 },
      );
    } else {
      toast.success(tf("os.c.merged", { name: existing.name, target: merge.name, units }));
    }
  }
  /**
   * 분리 — 종전(2026-08-05 이전)대로 별도 "(보강)" 행. 정규와 별개 보고서라 발송도 따로 나간다.
   * @returns 행이 실제로 늘었는가 — 호출부가 이 값으로 결석분 연결(시수 +1)을 걸지 판단한다.
   */
  function addSeparateMakeupRows(
    existing: OneScreenStudent,
    mk: OneScreenStudent,
    silent = false,
    /** 지정하면 **그 과목 행만** 만든다(다이얼로그에서 강사가 고른 수업). 미지정=종전대로 전 과목 후보. */
    onlySubjectKey?: string,
  ): boolean {
    const studentId = existing.id;
    // 이름 유일화(reports 키 충돌 방지)로 초안 덮어쓰기 차단.
    const used = new Set(existing.subjects.map((su) => su.name));
    const makeupRows = pendingMakeupRows(existing, mk, onlySubjectKey)
      .map((su) => {
        let name = makeupRowName(su.name);
        let n = 2;
        while (used.has(name)) name = makeupRowName(su.name, n++);
        used.add(name);
        // ⚠️ classId=null·makeup=true 유지(반 무관 보강). subjectLabel은 깨끗한 라벨 — 진도 접두에 "(보강)" 누출 방지.
        // 반 필터 앵커(makeupClassId/Name)는 `mk`에 이미 실려 있다 — **'추가'를 누른 시점**의 반 필터라,
        // 다이얼로그를 띄워 두는 동안 강사가 필터를 바꿔도 보강이 엉뚱한 수업에 붙지 않는다.
        return { ...su, name, classId: null, makeup: true, subjectLabel: su.subjectLabel ?? su.name };
      });
    if (makeupRows.length === 0) {
      setSelId(existing.id);
      toast.message(t("os.c.makeupRowExists"));
      return false;
    }
    patch(studentId, (s) => ({ ...s, subjects: [...s.subjects, ...makeupRows] }));
    const slots = initReports([{ ...existing, subjects: makeupRows }], templatePrefsRef.current)[existing.id] ?? {};
    setReports((prev) => ({ ...prev, [studentId]: { ...(prev[studentId] ?? {}), ...slots } }));
    setSelId(studentId);
    // 결석분 연결이 뒤따르는 경로(다이얼로그 '분리')는 그쪽 토스트가 시수까지 밝히므로 여기선 조용히(silent).
    setCardSubject({ id: studentId, idx: existing.subjects.length });
    if (!silent) toast.success(tf("os.c.makeupAdded", { name: existing.name }));
    return true;
  }
  return { linkMakeupToAbsenceCell, linkMakeupAbsence, addMakeupUnitsOnly, mergeMakeupIntoRegular, addSeparateMakeupRows };
}
