import type { ProgressCounts } from "@/features/dashboard/overview/consultation-progress";

/**
 * 매일 기록의 운영 칸(`student_daily_stats.data.ops` · 2026-10-21부터 — 그 전 줄엔 없다). 건수만(이름 없음).
 * `consult` = 운영실 '상담 진행'(최근 30일 단계별 · 멈춘 상담 수) · `newcomers` = '신규생 단계별 관리'·'신규생 체크 진행'.
 * 부분마다 따로 비어 있을 수 있다(그날 그 계산이 실패).
 */
export type OpsDaily = {
  consult?: { from: string; counts: ProgressCounts; stalled: number };
  newcomers?: {
    total: number;
    stages: { label: string; value: number }[];
    checksAvailable: boolean;
    items: { label: string; optional: boolean; done: number; overdue: number; due: number; upcoming: number; pending: number; waived: number }[];
  };
};
