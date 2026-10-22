"use client";

/**
 * **보강 예약** 표식 — 원스크린 왼쪽 목록 · 카드 머리 · 표 모드가 같은 부품을 쓴다(원장 2026-10-22 *"표 모드도 동일하게"*).
 * 글자 = "보강 예약 15:25~16:20"(이행되면 "보강 완료") · 색 = 출석부 '보강 예약' 칸과 같은 보라. 결석분·발송 방식(합침/분리)은
 * 툴팁 — 발송 방식은 화면에서도 보인다(합침 = 정규 줄의 '정규+보강', 분리 = 따로 선 '(보강)' 줄). 판정은 `reserved-makeup.ts`.
 */
import { useSheetTf } from "@/features/teacher-view/lang-context";
import { shortDate } from "../makeup-absence-link";
import { reservedTimeText } from "../reserved-makeup";
import type { ReservedMakeup } from "../types";

export function ReservedMakeupTag({ list, size = "sm" }: { list?: readonly ReservedMakeup[]; size?: "sm" | "md" }) {
  const tf = useSheetTf();
  if (!list?.length) return null;
  const done = list.every((r) => r.done);
  const label = tf(done ? "os.reserved.done" : "os.reserved.tag", { time: reservedTimeText(list) });
  const title = list
    .map((r) => tf(r.mode === "merge" ? "os.reserved.merge" : "os.reserved.separate", { date: shortDate(r.absenceDate) }))
    .join("\n");
  const pad = size === "md" ? "px-1.5 py-px" : "px-1 py-px";
  return (
    <span
      title={title}
      className={`num inline-flex shrink-0 items-center rounded-pill text-xs font-bold whitespace-nowrap ${pad} ${
        done ? "border-purple text-purple border" : "bg-purple-soft text-purple"
      }`}
    >
      {label}
    </span>
  );
}
