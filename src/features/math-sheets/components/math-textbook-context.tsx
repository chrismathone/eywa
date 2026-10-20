"use client";

import { createContext, useContext } from "react";
import type { AssignedBook } from "@/features/textbooks/math-assignment";
import type { TextbookTableStatus } from "@/features/textbooks/types";
import type { StudentBookNow } from "@/features/textbooks/server/math-assignment-queries";
import type { BookWindow } from "@/features/textbooks/book-window";
import type { StudentBookPlans } from "@/features/textbooks/book-plans";
import type { ExamTerm } from "@/features/textbooks/exam-periods";

/** 학교별 내신기간 한 줄(school-exam-queries.ts와 같은 모양 — 서버 모듈을 클라에서 import하지 않으려고 여기 둔다). */
export type SchoolExamRow = { schoolKey: string; schoolLabel: string; schoolYear: number; term: ExamTerm; from: string; to: string };

/**
 * 수학 교재 배정 — MCS 화면 안 어디서든(학생 행·반 교재 줄·전체 목표 창) 같은 값을 읽는다.
 * 페이지가 한 번 조회해 넣고(`getMathClassTextbooks`), 저장 뒤엔 `router.refresh()`로 새 값이 내려온다.
 * 🔑 prop으로 688줄 화면을 관통시키지 않으려고 컨텍스트로 둔다.
 */
export type MathTextbookState = {
  classId: string;
  status: TextbookTableStatus;
  classBook: AssignedBook | null;
  byStudent: Record<string, AssignedBook>;
  choices: { id: string; title: string }[];
  /** 학생별 지금 교재·차수(배정 > 반 배정 > 보고서 기록 추정) — 서버가 한 번 계산해 내려준다. */
  now: Record<string, StudentBookNow>;
  /** 학생별 교재 3개월 창 — 주 교재 로드맵의 지금 창(두 권, 내신기간 제외 3개월). */
  windows: Record<string, BookWindow>;
  /** 학생별 교재 전체 목표(시리즈마다 로드맵) + 교재목록에 없는 다른 교재. */
  plans: Record<string, StudentBookPlans>;
  /** 목표 권 저장 표 상태 — `ok`가 아니면 목표 권 변경을 잠근다. */
  targetStatus: "ok" | "missing-table" | "failed";
  /** 이 반 학생 학교들의 학교별 내신기간(적어 둔 것만) — `학교별 내신기간` 창이 읽고 고친다. */
  schoolExams: { status: "ok" | "missing-table" | "failed"; rows: SchoolExamRow[] };
  /** 배정을 고칠 수 있나 — 서버 게이트(`requireMcsClassAccess(write)`)와 같은 판정값. */
  canWrite: boolean;
};

const Ctx = createContext<MathTextbookState | null>(null);

export function MathTextbookProvider({ value, children }: { value: MathTextbookState; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 공급자가 없으면 null — 배정 UI가 통째로 안 그려진다(다른 화면에서 같은 부품을 써도 안 죽는다). */
export function useMathTextbooks(): MathTextbookState | null {
  return useContext(Ctx);
}
