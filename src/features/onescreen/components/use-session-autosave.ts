"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { createSessionSaveQueue, type SessionSaveQueue } from "@/features/onescreen/session-save-queue";
import { saveOnescreenSession } from "../server/actions";
import { buildSessionInput as buildSessionInputOf, type ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";
import type { SubjectReport } from "./report-card";
import type { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 원스크린 세션 자동저장(디바운스 800ms) — 수정 계획 P3-O 2/10, `onescreen-client.tsx`에서 옮김(동작 그대로).
 *
 * 화면이 넘기는 것: 지금 렌더의 학생·보고서 state와 세터, 세션 입력에 드는 화면 값(날짜·테스트 사용 여부), 문구 사전.
 * 돌려주는 것:
 *  · `studentsRef`·`reportsRef` — 타이머·비동기 콜백이 **최신** state를 읽는 ref 미러(화면 곳곳이 같이 쓴다).
 *  · `flushSavesRef` — 날짜 이동 전 대기 저장을 즉시 커밋(이동 = 클라 재마운트라 미커밋분 유실 방어).
 *  · `queueSave(id)` — 편집 뒤 그 학생 저장을 800ms 뒤로 미룬다.
 *  · `applySessionSaveResult` — 서버 응답(세션 기준 시각) 반영. 보강 등록 응답도 같은 함수로 기준을 전진시킨다.
 */
export function useSessionAutosave({
  students,
  reports,
  setStudents,
  date,
  showDailyTest,
  showCheckTest,
  t,
}: {
  students: OneScreenStudent[];
  reports: ReportsState;
  setStudents: Dispatch<SetStateAction<OneScreenStudent[]>>;
  /** 조회 대상 날짜(YYYY-MM-DD) — 빈값 = 서버 오늘. */
  date: string;
  showDailyTest: boolean;
  showCheckTest: boolean;
  t: ReturnType<typeof useSheetT>;
}) {
  // 날짜 이동 전 대기 저장 flush — 저장 로직이 아래에 정의되므로 ref로 노출(effect에서 갱신, render 중 ref 쓰기 금지 규칙).
  const flushSavesRef = useRef<() => void>(() => {});
  // 자동저장(디바운스) — 최신 state를 타이머 콜백에서 읽기 위한 ref 미러 + 학생별 타이머.
  const studentsRef = useRef(students);
  const reportsRef = useRef(reports);
  // ref 미러는 render 중이 아니라 effect에서 갱신(react-hooks/refs). 타이머는 800ms 뒤라 항상 최신 반영.
  useEffect(() => {
    studentsRef.current = students;
    reportsRef.current = reports;
  });
  // 덜 쓴 창 저장을 서버가 건너뛴 학생 — 800ms 자동저장마다 토스트가 쌓이지 않게 1회만.
  const skippedSaveToast = useRef<Set<string>>(new Set());
  /**
   * 학생별 자동저장 줄(`session-save-queue.ts`, 수정 계획 P1-O) — 한 학생에 한 요청만 나가고(응답 역전 없음),
   * 던진 실패는 다시 보내고, 다 실패하면 알린다. 예전엔 `.catch`가 없어 네트워크 오류가 조용히 사라졌다.
   * 조립·적용 함수는 렌더마다 바뀌므로(날짜·테스트 표시) 줄은 ref를 거쳐 **보낼 때의** 함수를 부른다.
   */
  const saveDepsRef = useRef<{
    build: typeof buildSessionInput;
    apply: typeof applySessionSaveResult;
    failText: string;
  } | null>(null);
  const saveQueueRef = useRef<SessionSaveQueue | null>(null);
  const getSaveQueue = () => {
    if (!saveQueueRef.current) {
      saveQueueRef.current = createSessionSaveQueue({
        send: (sid) => {
          const s = studentsRef.current.find((x) => x.id === sid);
          const deps = saveDepsRef.current;
          if (!s || !deps) return null;
          return saveOnescreenSession(deps.build(s, reportsRef.current[sid]));
        },
        apply: (sid, res) => saveDepsRef.current?.apply(sid, res),
        onGiveUp: () => toast.error(saveDepsRef.current?.failText ?? t("os.c.autosaveFail")),
      });
    }
    return saveQueueRef.current;
  };
  // 언마운트 = 대기 타이머 정리. 🔴 ref도 비운다 — StrictMode 재마운트에서 정리된 줄을 다시 쓰지 않게(다음 호출이 새로 만든다).
  useEffect(
    () => () => {
      saveQueueRef.current?.dispose();
      saveQueueRef.current = null;
    },
    [],
  );
  // 대기 중 자동저장을 즉시 커밋(날짜 이동 전 호출) — 디바운스 800ms 안에 이동하면 유실되던 편집 방어.
  useEffect(() => {
    saveDepsRef.current = { build: buildSessionInput, apply: applySessionSaveResult, failText: t("os.c.autosaveFail") };
    flushSavesRef.current = () => getSaveQueue().flush();
  });
  function applySessionSaveResult(
    studentId: string,
    res: { ok: boolean; error?: string; skipped?: boolean; updatedAt?: string },
  ) {
    if (!res.ok) {
      // 서버가 준 사유가 있으면 그대로(그 문장은 서버 축이라 한국어) — 없을 때만 화면 사전.
      toast.error(res.error ?? t("os.c.autosaveFail"));
      return;
    }
    if (res.skipped) {
      if (!skippedSaveToast.current.has(studentId)) {
        skippedSaveToast.current.add(studentId);
        toast.message(t("os.c.saveIgnored"));
      }
      return;
    }
    if (!res.updatedAt) return;
    skippedSaveToast.current.delete(studentId);
    studentsRef.current = studentsRef.current.map((s) =>
      s.id === studentId ? { ...s, sessionUpdatedAt: res.updatedAt } : s,
    );
    setStudents((prev) => prev.map((s) => (s.id === studentId ? { ...s, sessionUpdatedAt: res.updatedAt } : s)));
  }
  function buildSessionInput(s: OneScreenStudent, r: Record<string, SubjectReport> | undefined) {
    return buildSessionInputOf(s, r, { date, showDailyTest, showCheckTest });
  }
  // 학생별 디바운스 upsert — 편집 800ms 후 저장. 학생별 타이머라 학생 전환에도 유실 없음.
  function queueSave(studentId: string) {
    getSaveQueue().queue(studentId, 800);
  }
  return { studentsRef, reportsRef, flushSavesRef, queueSave, applySessionSaveResult };
}
