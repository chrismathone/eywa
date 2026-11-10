"use client";

import type { Dispatch, SetStateAction } from "react";
import { toast } from "sonner";
import { registerMakeupEntries } from "../server/makeup-register-actions";
import { notifyMakeupEffect } from "./makeup-effect-toast";
import type { TemplatePrefs } from "../last-template";
import type { OneScreenStudent } from "../types";
import type { TodayClass } from "../server/roster";
import type { MakeupConfirmChoice } from "@/features/attendance/components/makeup-confirm-dialog";
import { planMakeupMerge } from "../makeup-merge-plan";
import { initReports, type ReportsState } from "../session-input";
import { pendingMakeupRows, type MakeupAsk } from "../makeup-ask-plan";
import type { useSessionAutosave } from "./use-session-autosave";
import type { MakeupI18n } from "./makeup-flow-types";
import type { useMakeupAsk } from "./use-makeup-ask";
import type { useMakeupApply } from "./use-makeup-apply";

/**
 * 보강 확인창의 '확인' — 등록 → (합침 | 분리 | 추가 보강) → 결석분 연결. 수정 계획 P3-O batch C,
 * `use-makeup-flow.ts`에서 나눔(본문 그대로). 저장 중(`makeupSaving`)엔 다시 누르기·날짜 이동이 막힌다.
 */
export function useMakeupResolve({
  activeDate,
  todayClasses,
  state: { setStudents, setReports, studentsRef, templatePrefsRef },
  i18n: { t, tf },
  setSelId,
  saving: { makeupSaving, setMakeupSaving },
  ask: { makeupAsk, setMakeupAsk, hostChoicesOf },
  apply: { linkMakeupToAbsenceCell, linkMakeupAbsence, addMakeupUnitsOnly, mergeMakeupIntoRegular, addSeparateMakeupRows },
  applySessionSaveResult,
}: {
  activeDate: string;
  todayClasses: TodayClass[];
  state: {
    setStudents: Dispatch<SetStateAction<OneScreenStudent[]>>;
    setReports: Dispatch<SetStateAction<ReportsState>>;
    studentsRef: { readonly current: OneScreenStudent[] };
    templatePrefsRef: { readonly current: TemplatePrefs };
  };
  i18n: MakeupI18n;
  setSelId: Dispatch<SetStateAction<string>>;
  saving: { makeupSaving: boolean; setMakeupSaving: Dispatch<SetStateAction<boolean>> };
  ask: {
    makeupAsk: MakeupAsk | null;
    setMakeupAsk: Dispatch<SetStateAction<MakeupAsk | null>>;
    hostChoicesOf: ReturnType<typeof useMakeupAsk>["hostChoicesOf"];
  };
  apply: ReturnType<typeof useMakeupApply>;
  applySessionSaveResult: ReturnType<typeof useSessionAutosave>["applySessionSaveResult"];
}) {
  /**
   * 다이얼로그 응답 처리 — 고른 대로만 한다. 취소는 아무것도 하지 않는다(보강 행도 안 생긴다).
   * ⚠️ 학생은 **id로 다시 찾는다** — 다이얼로그가 열려 있는 동안 실시간 갱신이 카드를 바꿨을 수 있다.
   */
  async function resolveMakeupAsk(picked: MakeupConfirmChoice) {
    const asked = makeupAsk;
    if (!asked || makeupSaving) return;
    // 🔴 합칠 후보는 **창을 연 순간의 스냅샷**이다 — 그 사이 이 화면이 알게 된 변화(같은 문서 방송·자기 응답의 conflict 되돌리기)로
    //    그 칸이 결석 등이 됐는데 옛 상태로 되쓰면 결석이 출석으로 뒤집히고 옛 시수에 더해진다(적대 리뷰 2026-09-21).
    //    확인하는 순간의 카드로 같은 판정(`planMakeupMerge`)을 다시 돌려, 더는 합칠 수 없으면 멈추고 지금 값으로 이어 간다.
    //    ⚠️ **다른 기기의 변화는 못 본다**(카드는 실시간 구독이 없다) — 그 방어는 서버가 쓰기 때 상태를 다시 보는 것이다(미착수).
    let choice = picked;
    if (picked.candidate) {
      const was = picked.candidate;
      const card = studentsRef.current.find((s) => s.id === asked.studentId);
      const plan = card ? planMakeupMerge(card.subjects, new Set([was.subjectKey])) : null;
      const fresh = plan?.kind === "ask" ? plan.candidates.find((c) => c.name === was.name && c.classId === was.classId) : undefined;
      if (!fresh) {
        setMakeupAsk(null);
        toast.error(tf("os.c.makeupCandidateChanged", { target: was.name }));
        return;
      }
      choice = { ...picked, candidate: fresh };
    }
    // 창에서 **수업을 골랐으면** 그 반이 앵커다(원장 2026-09-21) — 보고서의 `makeup_class_id`와 출결 칸이 모두 그 반을 본다.
    // `null` = '반 없이'(보이지 않는 보강 반 — 종전 동작). 묻지 않았으면(`undefined`) 반 필터 앵커 그대로.
    // 🔴 고른 반과 **과목이 같은 행만** 남긴다 — 다른 과목 행까지 그 반에 묶으면 등록 문이 통째로 거절한다(적대 리뷰 2026-09-21).
    // ⚠️ 카드 표시 이름(`makeupClassName`)은 보고 있던 반 필터가 있으면 그대로(바꾸면 추가한 카드가 그 자리에서 사라진다),
    //    '전체'였으면 고른 반 이름(새로고침 뒤 그 반 칩 아래로 옮겨 가 보이는 것과 같게).
    // 🔴 고른 반은 **지금 창에 보이는 후보**에서 찾는다 — 창이 열린 사이 그 반에 정규 행이 생기면 후보에서 빠지는데,
    //    거르기 전 목록에서 찾으면 요약 문장('보강 반에 기록')과 다른 반으로 나간다(적대 리뷰 2026-09-21).
    const host = choice.hostClassId === undefined || choice.hostClassId === null
      ? null
      : hostChoicesOf(asked)?.options.find((o) => o.classId === choice.hostClassId) ?? null;
    if (typeof choice.hostClassId === "string" && !host) {
      toast.error(t("os.c.makeupHostGone"));
      return;
    }
    // 반 필터가 '전체'였나 — 그때만 카드 이름을 고른 반으로 바꾼다(서버가 tag를 늘 "보강"으로 채워 tag로는 가를 수 없다).
    const filterAll = !asked.mk.subjects.some((su) => su.makeupClassName);
    const hosted = choice.hostClassId === undefined
      ? asked
      : {
          ...asked,
          mk: {
            ...asked.mk,
            ...(host && filterAll ? { tag: host.className, className: host.className } : {}),
            subjects: asked.mk.subjects
              .filter((su) => !host || !su.subjectKey || su.subjectKey === host.subject)
              .map((su) => ({ ...su, makeupClassId: choice.hostClassId ?? null, makeupClassName: su.makeupClassName ?? host?.className ?? null })),
          },
        };
    // 🔴 합칠 후보가 있는 보강을 **분리**하면 보강 줄의 앵커도 고른 정규 수업(후보) 반이다 — 시수가 그 반 칸에 얹히므로(아래),
    //    보고서 저장 훅이 그 반 칸을 보고 보강 반을 또 만들지 않는다(위임 반이면 담임 판정이 못 잡는다). 표시 이름은 그대로 둔다
    //    (바꾸면 추가한 카드가 보던 반 필터에서 그 자리에서 사라진다 — 새로고침 뒤엔 후보 반 칩 아래에 선다).
    const target = choice.candidate && choice.mode === "separate" ? choice.candidate : null;
    // 보던 반 필터가 후보 반과 다르면 새로고침 뒤 카드가 후보 반 칩 아래로 옮겨 간다 — 조용히 옮기지 않고 알린다.
    // ⚠️ 판정은 **이름**으로 — 반 필터가 이름 축이라(grid.ts) 동명 반 필터(앵커 id 없음)에선 옮겨 가지 않는다.
    const targetClassName = target ? todayClasses.find((c) => c.id === target.classId)?.name ?? null : null;
    const movedTo = target && targetClassName && hosted.mk.subjects.some((su) => su.subjectKey === target.subjectKey && !!su.makeupClassName && su.makeupClassName !== targetClassName)
      ? targetClassName
      : null;
    const ask = target
      ? { ...hosted, mk: { ...hosted.mk, subjects: hosted.mk.subjects.map((su) => (su.subjectKey === target.subjectKey ? { ...su, makeupClassId: target.classId } : su)) } }
      : hosted;
    // 창에서 **다른 반**을 골랐는데 보던 반 필터와 이름이 다르면 새로고침 뒤 그 보강은 고른 반 이름 아래로 옮겨 간다 — 그 반이 오늘 칩에
    // 없으면 '전체'에서만 보인다. 조용히 옮기지 않고 알린다(정규 수업이 있는 학생이 다른 반을 고르는 것이 이 경로의 흔한 경우다).
    const hostMoved = host && ask.mk.subjects.some((su) => !!su.makeupClassName && su.makeupClassName !== host.className) ? host.className : null;
    const hostNote = hostMoved
      ? todayClasses.some((c) => c.name === hostMoved)
        ? tf("os.c.makeupShownUnder", { target: hostMoved })
        : tf("os.c.makeupShownUnderAll", { target: hostMoved })
      : undefined;
    const withHostNote = (msg: string) => (hostNote ? `${msg} ${hostNote}` : msg);
    // 🔴 더할 보강 행이 없으면 **등록하기 전에** 멈춘다 — 등록이 먼저 돌면 고른 수업·시수가 세션에 적히는데 카드 행은
    //    옛 앵커 그대로라, 새로고침 뒤 카드가 칸 없는 반을 가리키고 보고서 저장 때 보강 반 칸이 하나 더 선다(적대 리뷰 2026-09-21).
    //    목록에 없던 학생(isNew)이라도 창이 열린 사이 카드가 들어왔을 수 있어 id로 다시 찾는다.
    const cardNow = studentsRef.current.find((s) => s.id === ask.studentId);
    // 🔴 **합침도** 같은 과목 보강 행이 이미 있으면 멈춘다 — 다른 반을 골라 만든 보강 행(`planMakeupMerge`의 `already`는 반에 합친 행만 본다)이
    //    있는 학생을 다시 추가해 합치면 정규 칸에 보강이 한 번 더 얹혀 두 번 잡힌다(재리뷰 2026-09-21).
    const stopSubject = choice.candidate ? choice.candidate.subjectKey : undefined;
    if (cardNow && (!choice.candidate || stopSubject) && pendingMakeupRows(cardNow, ask.mk, stopSubject).length === 0) {
      setMakeupAsk(null);
      setSelId(cardNow.id);
      toast.message(t("os.c.makeupRowExistsNoChange"));
      return;
    }
    if (choice.mode === "separate") {
      const existing = studentsRef.current.find(s => s.id === ask.studentId);
      const attended = new Set(existing?.subjects.filter(su => !su.makeup).map(su => su.subjectKey));
      const attendedRows = ask.mk.subjects.filter(su => attended.has(su.subjectKey));
      const rows = choice.candidate
        ? ask.mk.subjects.filter(su => su.subjectKey === choice.candidate!.subjectKey)
        : attendedRows.length ? attendedRows : ask.mk.subjects;
      setMakeupSaving(true);
      try {
        const result = await registerMakeupEntries({
          studentId: ask.studentId, date: activeDate,
          entries: rows.map(su => ({
            subject: su.subjectKey || su.name, makeupClassId: su.makeupClassId,
            absentDate: choice.absentDate, absentClassId: choice.absentClassId, units: choice.addUnits,
            // 🔴 정규 수업에 기록하지 않는 보강이면 **지금** 앵커 반에 칸을 세운다(서버가 저장 훅과 같은 함수로) — 보고서를 안 쓰거나
            //    저장이 실패해도 시수가 남게(적대 리뷰 2026-09-30). 후보 반에 얹는 분리 보강·그 반에 오늘 정규 줄이 있는 학생은 끈다
            //    (그 칸은 화면이 직접 얹는다 — 옛 `persistAnchorMakeup`과 같은 조건).
            recordCell: !choice.candidate && !!su.makeupClassId && !existing?.subjects.some((x) => x.classId === su.makeupClassId && !x.makeup),
          })),
        });
        if (!result.ok) { toast.error(result.error); return; }
        if (result.cellError) toast.error(tf("os.c.anchorFail", { error: result.cellError }));
        notifyMakeupEffect(result.makeupEffect);
        // 내 리비전에 명단만 더한 경우에만 자동저장 기준도 전진시킨다. 다른 창의 내용에는 소유권을 얻지 않는다.
        if (existing && (existing.sessionUpdatedAt ?? null) === result.previousUpdatedAt) {
          applySessionSaveResult(existing.id, result);
        }
      } catch {
        toast.error(t("os.c.makeupSaveFail"));
        return;
      } finally { setMakeupSaving(false); }
    }
    setMakeupAsk(null);
    const anchorIdNew = ask.mk.subjects.find((su) => su.makeupClassId)?.makeupClassId ?? null;
    // '반 없이'를 골랐는가 — 앵커가 없는 이유가 반 필터가 아니라 강사의 선택이라 문구가 다르다.
    const noAnchorToast = choice.hostClassId === null ? "os.c.makeupAddedNoHost" : "os.c.makeupAddedNoAnchor";
    // 목록에 없던 학생이라도 창이 열린 사이 카드가 실시간으로 들어왔으면 **기존 카드 경로**로 보낸다 — 새 카드 경로로 가면
    // 그 카드의 앵커 칸과 고른 반 칸이 둘 다 선다(적대 리뷰 2026-09-21).
    if (ask.isNew && !studentsRef.current.some((s) => s.id === ask.studentId)) {
      // 목록에 없던 학생 — 확인을 받았으니 이제 카드를 만든다(취소했으면 여기 안 온다).
      const mk = ask.mk;
      setStudents((prev) => (prev.some((s) => s.id === mk.id) ? prev : [...prev, mk]));
      setReports((prev) => ({ ...prev, [mk.id]: initReports([mk], templatePrefsRef.current)[mk.id] ?? {} }));
      setSelId(mk.id);
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(mk.id, anchorIdNew, choice, mk.name, hostNote);
      } else {
        // ⚠️ 앵커(보고 있는 반)가 없으면 출결에 남길 칸이 없다 — 시수를 약속하지 않는다(지킬 수 없다).
        toast.success(
          anchorIdNew
            ? withHostNote(tf("os.c.makeupAddedUnits", { name: mk.name, units: choice.addUnits }))
            : tf(noAnchorToast, { name: mk.name }),
        );
      }
      return;
    }
    const existing = studentsRef.current.find((s) => s.id === ask.studentId);
    if (!existing) {
      toast.error(t("os.c.cardNotFound"));
      return;
    }
    if (!choice.candidate) {
      // 정규 수업에 기록하지 않는 보강(정규 행이 없음 — 그날 결석·다른 강사 과목 — 또는 창에서 다른 반을 고름) — 보강 행만 만들고
      // 시수·결석분은 앵커 반(고른 반 · 보던 반 필터)에 적는다.
      // 🔴 이미 보강 행이 있으면(같은 학생을 다시 추가) **여기서 멈춘다** — 계속 가면 고른 반에 칸이 하나 더 서서 시수가 두 번 잡히고,
      //    카드 행의 앵커는 옛 값이라 보강 빼기가 그 칸을 못 지운다(적대 리뷰 2026-09-21). 반을 바꾸려면 보강 빼기 → 다시 추가.
      if (!addSeparateMakeupRows(existing, ask.mk)) return;
      if (choice.absentDate && anchorIdNew) {
        void linkMakeupToAbsenceCell(existing.id, anchorIdNew, choice, existing.name, hostNote);
      } else {
        toast.success(
          anchorIdNew
            ? withHostNote(tf("os.c.makeupAddedUnits", { name: existing.name, units: choice.addUnits }))
            : tf(noAnchorToast, { name: existing.name }),
        );
      }
      return;
    }
    // 🔴 합칠 후보가 있는 보강은 **보던 반 필터에 보강 칸을 따로 적지 않는다** — 시수는 고른 정규 수업 칸에만 얹힌다(합침·분리 둘 다).
    //    예전엔 여기서 `persistAnchorMakeup`을 불러, 보던 반(X)이 후보 반(Y)과 다르면 **한 번의 보강이 두 반에** 잡혔다
    //    (X 보강 1 + Y +시수 — 실측 2026-08-29 정민성 · 2026-09-17 안서준, 원장 *"출석부에 행만 자꾸 생기네"*).
    if (choice.mode === "separate") {
      // 🔴 **고른 과목의 보강 행만** 만든다. 안 좁히면 그 강사가 가르치는 학생의 다른 과목까지 "(보강)" 행이
      //    딸려 붙어(예: 영어가 오늘 결석이라 후보엔 없어도 행은 생겼다) 보고서가 2건이 아니라 3건 나간다 —
      //    다이얼로그가 "모두 2건" 이라고 약속한 것과 어긋난다. 강사가 어느 수업인지 이미 골랐으니 추측할 게 없다.
      if (addSeparateMakeupRows(existing, ask.mk, true, choice.candidate!.subjectKey)) {
        // 🔴 결석일은 **선택**이다(원장 2026-08-07 *"오늘 날짜에 추가 보강할 수도 있잖아"*). 없으면
        //    결석분 연결 없이 시수만 얹는다. 예전엔 이 분기가 없어 날짜가 비면 **조용히 '합침'으로**
        //    떨어졌다 — 강사는 '분리'를 골랐는데 보고서가 1건만 나가는, 화면과 다른 결과였다.
        const note = movedTo ? tf("os.c.makeupShownUnder", { target: movedTo }) : undefined;
        if (choice.absentDate)
          void linkMakeupAbsence(existing, choice.candidate!, choice.absentDate, choice.addUnits, choice.absentClassId, note);
        else void addMakeupUnitsOnly(existing, choice.candidate!, choice.addUnits, note);
      }
      return;
    }
    mergeMakeupIntoRegular(
      existing,
      choice.candidate,
      choice.addUnits,
      ask.sentSubjects.includes(choice.candidate.name),
    );
  }
  return { resolveMakeupAsk };
}
