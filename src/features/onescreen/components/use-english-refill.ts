"use client";

import { useRef } from "react";
import type { OneScreenStudent } from "../types";

/**
 * 영어 '다시 채우기' 연타 막기 — 수정 계획 P3-O batch D, `use-auto-write.ts`에서 나눔(본문 그대로).
 * 받는 중인 (학생,과목)을 ref로 막고(refillBusyRef), 받는 중에 고른 **다른** 템플릿은 기억했다가(refillNextRef) 끝난 뒤
 * 한 번 더 채운다(마지막 선택이 이긴다). 본문(refillEnglishInner)은 use-english-generate.ts가 낸다.
 * ⚠️ ref 두 개는 이 훅이 들고 있다 — 부르는 훅(useAutoWrite) 안에서 예전 자리(genKey state 다음 · bulkGen state 앞)에서 부른다.
 */
export function useEnglishRefill({
  refillEnglishInner,
  latestStudent,
}: {
  refillEnglishInner: (student: OneScreenStudent, subjectName: string, templateId?: string) => Promise<void>;
  latestStudent: (student: OneScreenStudent, subjectName: string) => OneScreenStudent;
}) {
  // 다시 채우기가 인재원 자료를 기다리는 동안 또 누르면 '덮을까요?' 확인이 겹쳐 뜬다 — 진행 중인 (학생,과목)을 막는다.
  const refillBusyRef = useRef(new Set<string>());
  // 받는 중에 고른 **다른** 템플릿 — 끝난 뒤 그걸로 한 번 더 채운다(마지막 선택이 이긴다, 적대 재리뷰).
  const refillNextRef = useRef(new Map<string, string>());
  /**
   * 템플릿으로 다시 채우기 — 지금 칸 값 + 마지막 AI 인사말·코멘트로 글을 다시 만든다(AI 재호출 없음).
   * 🔴 강사가 손본 글이면 먼저 묻는다 — 말없이 덮으면 고친 문장이 사라진다.
   */
  async function refillEnglishFor(student: OneScreenStudent, subjectName: string, templateId?: string) {
    const busyKey = `${student.id}|${subjectName}`;
    if (refillBusyRef.current.has(busyKey)) {
      // 받는 중에 또 누름 — '다시 채우기' 연타는 버리고(확인 창이 겹쳐 뜬다), 다른 템플릿 고르기는 기억해 뒀다 끝난 뒤 채운다.
      if (templateId) refillNextRef.current.set(busyKey, templateId);
      return;
    }
    refillBusyRef.current.add(busyKey);
    try {
      await refillEnglishInner(student, subjectName, templateId);
    } finally {
      refillBusyRef.current.delete(busyKey);
    }
    const next = refillNextRef.current.get(busyKey);
    refillNextRef.current.delete(busyKey);
    if (next && next !== templateId) await refillEnglishFor(latestStudent(student, subjectName), subjectName, next);
  }
  return { refillEnglishFor };
}
