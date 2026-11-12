"use client";

import { useMemo, type Dispatch, type SetStateAction } from "react";
import { useClassnoteStatusSync } from "./use-classnote-status-sync";
import { mergeClassnoteStatuses, pendingSendStudentIds, type ClassnoteStatusRow } from "../classnote-status";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";

/** ClassNote 기능이 꺼진 학원 — 발송 상태 감시 대상 없음(참조 고정이라 감시 훅이 매 렌더 재시작하지 않는다). */
const NO_PENDING: string[] = [];

/**
 * 발송 대기·처리 중인 학생의 ClassNote 결과를 감시해 배지에 반영 — 수정 계획 P3-O batch D, `use-report-send.ts`에서 나눔(본문 그대로).
 * 대기 학생이 없으면 조회 0회 · 다 끝나면 저절로 멈춘다. ClassNote 기능이 꺼진 학원은 감시하지 않는다.
 */
export function useReportStatusMerge({
  date,
  classnoteOn,
  reports,
  setReports,
  studentsRef,
}: {
  /** 조회 대상 날짜 원문(빈값 = 서버 오늘). */
  date: string;
  classnoteOn: boolean;
  reports: ReportsState;
  setReports: Dispatch<SetStateAction<ReportsState>>;
  studentsRef: { readonly current: OneScreenStudent[] };
}) {
  // 워커가 백그라운드로 끝낸 ClassNote 발송 결과를 배지에 반영 — 새로고침 없이 '발송 대기' → '발송 완료'.
  // ⚠️ **queueSave를 부르지 않는다**: 내 편집이 아니라 서버가 알려준 사실이라 세션을 다시 쓸 이유가 없다.
  // 병합 규칙(빈 상태 무시·화면에 없는 과목 무시)은 순수함수 mergeClassnoteStatuses 한 곳에.
  function applyClassnoteStatuses(rows: ClassnoteStatusRow[]) {
    setReports((prev) =>
      mergeClassnoteStatuses(prev, rows, (studentId, subjectKey, classId) => {
        const subjects = studentsRef.current.find((s) => s.id === studentId)?.subjects;
        if (!subjects) return undefined;
        // 반 정확매칭 우선(0134a) — 같은 과목 두 행은 과목키가 같아 폴백만으론 엉뚱한 행에 배지가 붙는다.
        if (classId) {
          const byClass = subjects.find((su) => su.classId === classId);
          if (byClass) return byClass.name;
          // 화면에 없는 반(다른 강사·다른 요일)의 보고서 → 어느 행에도 붙이지 않는다.
          return undefined;
        }
        // 반 없는 보고서(관리자 작성·구버전)는 과목으로. 같은 과목 두 행이면 **앞 행**(로스터 정렬 순).
        return subjects.find((su) => (su.subjectKey || su.subjectLabel || su.name) === subjectKey)?.name;
      }),
    );
  }
  // 대기·처리중인 학생이 있는 동안만 감시(없으면 조회 0회, 다 끝나면 저절로 멈춘다).
  const pendingSends = useMemo(() => pendingSendStudentIds(reports), [reports]);
  useClassnoteStatusSync(date, classnoteOn ? pendingSends : NO_PENDING, applyClassnoteStatuses);
}
