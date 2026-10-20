import type { RoadmapStatus } from "@/features/textbooks/book-roadmap";

/** 교재 로드맵 판정 → 배지 문구(목표 레일과 같은 너그러움 ±1차시 = 계획대로, book-roadmap.ts가 판정). */
export function roadmapStatusLabel(r: { status: RoadmapStatus; difference: number | null; examNow?: unknown }): string {
  switch (r.status) {
    case "not-started": return "시작 예정";
    case "no-data": return "진도 확인 필요";
    case "done": return "목표 도달";
    case "behind": return `${Math.abs(r.difference ?? 0)}차시 느림`;
    case "ahead": return `${r.difference}차시 빠름`;
    default: return r.examNow ? "계획대로 · 내신기간" : "계획대로";
  }
}
