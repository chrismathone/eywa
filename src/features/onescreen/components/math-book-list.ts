"use client";

import { useTextbookOptions } from "@/features/textbooks/textbook-options-context";

/**
 * 수학 보고서 교재명 칸의 **교재 제안**(원장 2026-10-27 *"우리 수학에서 쓰는 교재명이 드롭다운으로 뜨면서
 * 쓰면 바로 검색되서 그거 선택"*) — 교재목록 마스터(`textbooks`, subject=math)의 이름을 `<datalist>`로 건다.
 *
 * ECS 계획 줄과 **같은 공급자**(`TextbookOptionsProvider`)를 쓴다 — 목록을 따로 만들면 교재목록을 고쳐도
 * 한쪽만 바뀐다. 고르는 건 제안일 뿐이고 칸은 **자유 입력 그대로**다(목록에 없는 프린트·학교 부교재도 적힌다).
 *
 * 🔴 **수학 행에만** 단다 — 영어 행 교재 칸에 수학 교재가 제안되면 그대로 영어 보고서에 실린다(roster ② 같은 이유).
 * 🔴 공급자 밖이면 `undefined`(속성 자체를 안 단다) — 제안만 사라지고 칸은 지금처럼 돈다.
 */
export function useMathBookListId(): string | undefined {
  return useTextbookOptions().listId ?? undefined;
}

/** 이 행이 수학 행인가 — 과목 키 미지정은 수학(진도 셀·planBulkApply와 같은 규약). */
export function isMathBookRow(subjectKey: string | null | undefined): boolean {
  return (subjectKey?.trim() || "math") === "math";
}
