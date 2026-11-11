"use client";

import { useEffect, useState } from "react";
import { signReportAttachmentUrls } from "../server/attachment-actions";
import { classIdFor, subjectKeyFor } from "../attachment-row";
import type { ReportsState } from "../session-input";
import type { OneScreenStudent } from "../types";

/**
 * 첨부 썸네일 서명 URL — 수정 계획 P3-O batch D, `use-report-attachments.ts`에서 나눔(본문 그대로).
 * 카드(선택 학생)는 첨부 경로가 바뀔 때만 다시 서명하고(이펙트 의존·취소 플래그 그대로), 표 팝오버는 열 때만 1회 서명한다.
 * 🔴 늦게 온 옛 학생 서명은 `cancelled`로 버린다(새 학생 썸네일을 덮지 않게).
 */
export function useReportAttachmentUrls({
  selected,
  reports,
  reportsRef,
  date,
}: {
  selected: OneScreenStudent | null;
  reports: ReportsState;
  reportsRef: { readonly current: ReportsState };
  /** 조회 대상 날짜(YYYY-MM-DD) — 빈값 = 서버 오늘. */
  date: string;
}) {
  const [attUrls, setAttUrls] = useState<Record<string, string>>({}); // 첨부 path→signed 썸네일 URL(P2b)

  // 선택 학생 과목별 첨부 path 시그니처 — 경로 변경 시에만 썸네일 URL 재요청(draft 편집엔 재요청 안 함).
  const attTargets = selected
    ? selected.subjects
        .map((su) => ({
          subject: su.subjectKey || su.subjectLabel || su.name || undefined,
          // 반(0134a) — 같은 과목 두 행이면 과목만으론 어느 보고서의 첨부인지 못 가른다.
          classId: su.classId ?? null,
          paths: (reports[selected.id]?.[su.name]?.attachments ?? []).map((a) => a.path),
        }))
        .filter((t) => t.paths.length > 0)
    : [];
  const attSig = attTargets.map((t) => `${t.classId ?? t.subject ?? ""}:${t.paths.join(",")}`).join("|");
  useEffect(() => {
    // attTargets 없으면 재요청 안 함(기존 map은 path 키라 stale해도 오표시 없음 — 신규 서명 시 전체 교체).
    if (!selected || attTargets.length === 0) return;
    let cancelled = false;
    void (async () => {
      const merged: Record<string, string> = {};
      for (const t of attTargets) {
        const res = await signReportAttachmentUrls({
          studentId: selected.id,
          subject: t.subject,
          classId: t.classId,
          reportDate: date || undefined,
        });
        if (res.urls) Object.assign(merged, res.urls);
      }
      if (!cancelled) setAttUrls(merged);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- attSig가 attTargets 내용을 대표(경로 변경 시에만 재요청)
  }, [selected?.id, attSig]);

  /** 표 팝오버용 썸네일 서명 — 카드처럼 상시 서명하지 않고 **열 때만** 1회(행 수만큼 서명하면 낭비). */
  async function ensureAttachmentUrls(student: OneScreenStudent, subjectName: string) {
    const atts = reportsRef.current[student.id]?.[subjectName]?.attachments ?? [];
    if (atts.length === 0) return;
    const res = await signReportAttachmentUrls({
      studentId: student.id,
      subject: subjectKeyFor(student, subjectName),
      classId: classIdFor(student, subjectName),
      reportDate: date || undefined,
    });
    if (res.urls) setAttUrls((prev) => ({ ...prev, ...res.urls }));
  }
  return { attUrls, setAttUrls, ensureAttachmentUrls };
}
