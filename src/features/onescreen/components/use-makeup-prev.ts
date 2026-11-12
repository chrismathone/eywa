"use client";

import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { loadMakeupHistory } from "../server/actions";
import type { OneScreenStudent } from "../types";
import type { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";

/**
 * 보강 학생 '이전 진도 불러오기'(한 명·일괄) — 수정 계획 P3-O 8/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 * 🔴 일괄 중복 실행은 **ref**(`makeupPrevBusyRef`)로 막는다 — 토스트의 '지금 불러오기' 버튼은 옛 렌더의 함수를 들고 있어
 *    state(`makeupPrevBusy`)로는 못 막는다. state는 표시용이다.
 */
export function useMakeupPrev({
  date,
  setStudents,
  i18n: { t, tf },
}: {
  /** 조회 대상 날짜 원문(빈값 = 서버 오늘) — 그 날짜 기준 직전 회차. */
  date: string;
  setStudents: Dispatch<SetStateAction<OneScreenStudent[]>>;
  i18n: { t: ReturnType<typeof useSheetT>; tf: ReturnType<typeof useSheetTf> };
}) {
  // 보강 학생 중 '이전 진도'를 이미 불러온 학생 id — 버튼 숨김·재요청 방지.
  const [prevLoaded, setPrevLoaded] = useState<Set<string>>(new Set());
  const [makeupPrevBusy, setMakeupPrevBusy] = useState(false); // 보강 학생 이전 진도 일괄 불러오기 중
  const makeupPrevBusyRef = useRef(false); // 토스트 버튼은 옛 렌더의 함수를 들고 있다 — 중복 실행은 ref로 막는다
  // 보강 학생 '이전 진도 불러오기' — 직전 회차를 당겨 prev/prevReport/prevScore를 채운다(세션 저장 없음).
  //   silent = 일괄 불러오기(아래)가 결과를 모아 한 번에 알린다.
  async function loadMakeupPrev(studentId: string, silent = false): Promise<"loaded" | "none" | "fail"> {
    const res = await loadMakeupHistory(studentId, date || undefined); // 조회 중인 날짜 기준 직전 회차(과거 백필 정합)
    if (!res.ok || !res.bySubject) {
      if (!silent) toast.error(res.error ?? t("os.c.prevFail"));
      return "fail";
    }
    const bySubject = res.bySubject;
    const prevScore = res.prevScore;
    setStudents((prev) =>
      prev.map((s) => {
        if (s.id !== studentId) return s;
        return {
          ...s,
          subjects: s.subjects.map((su) => {
            const h = bySubject[su.subjectKey ?? ""] ?? bySubject[su.name];
            return h ? { ...su, prev: h.prev, prevReport: h.prevReport } : su;
          }),
          tests: prevScore
            ? {
                daily: { ...s.tests.daily, prevScore: prevScore.daily },
                check: { ...s.tests.check, prevScore: prevScore.check },
              }
            : s.tests,
        };
      }),
    );
    setPrevLoaded((prev) => new Set(prev).add(studentId));
    const found = Object.keys(bySubject).length > 0;
    if (!silent) toast.success(found ? t("os.c.prevLoaded") : t("os.c.prevNone"));
    return found ? "loaded" : "none";
  }
  // 보강 학생 이전 진도 **일괄** 불러오기(원장 2026-10-27 *"보강학생이 따로 있으면 안내하고 버튼도"*) — 표의 '이전값 가져오기'는
  // 이전 회차가 있는 행만 채운다. 보강 학생은 그 회차를 따로 불러와야 해서, 안 불러온 보강 학생이 있으면 표 위에 안내 버튼이 선다.
  async function loadMakeupPrevAll(ids: string[]) {
    if (makeupPrevBusyRef.current || !ids.length) return;
    makeupPrevBusyRef.current = true;
    setMakeupPrevBusy(true);
    try {
      let loaded = 0;
      let failed = 0;
      for (const id of ids) {
        const r = await loadMakeupPrev(id, true); // 한 명씩 — 서버 액션은 어차피 줄 서서 돈다
        if (r === "loaded") loaded++;
        else if (r === "fail") failed++;
      }
      if (failed) toast.error(tf("os.c.makeupPrevAllFail", { n: failed }));
      if (failed < ids.length) toast.success(tf("os.c.makeupPrevAllDone", { n: loaded, none: ids.length - loaded - failed }));
    } finally {
      makeupPrevBusyRef.current = false;
      setMakeupPrevBusy(false);
    }
  }
  return { prevLoaded, makeupPrevBusy, loadMakeupPrev, loadMakeupPrevAll };
}
