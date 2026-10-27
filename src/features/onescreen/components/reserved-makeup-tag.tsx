"use client";

/**
 * **보강 예약** 표식 — 원스크린 왼쪽 목록 · 카드 머리 · 표 모드가 같은 부품을 쓴다(원장 2026-10-22 *"표 모드도 동일하게"*).
 * 글자 = "보강 예약 15:25~16:20"(이행되고 **끝 시각이 지나면** "보강 완료" — `reservedShownDone`) · 색 = 출석부 '보강 예약' 칸과 같은 보라. 결석분·발송 방식(합침/분리)은
 * 툴팁 — 발송 방식은 화면에서도 보인다(합침 = 정규 줄의 '정규+보강', 분리 = 따로 선 '(보강)' 줄). 판정은 `reserved-makeup.ts`.
 */
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { shortDate } from "../makeup-absence-link";
import { reservedShownDone, reservedTimeText } from "../reserved-makeup";
import type { ReservedMakeup } from "../types";
import { useLessonClock } from "./use-lesson-clock";

type TagProps = { list?: readonly ReservedMakeup[]; size?: "sm" | "md" };

export function ReservedMakeupTag({ list, size = "sm" }: TagProps) {
  // 시계는 표식이 있는 줄에서만 돈다(표 모드는 줄마다 이 부품을 그린다 — 빈 줄마다 타이머를 세우지 않게).
  if (!list?.length) return null;
  return <ReservedMakeupTagInner list={list} size={size} />;
}

function ReservedMakeupTagInner({ list, size }: { list: readonly ReservedMakeup[]; size: "sm" | "md" }) {
  const t = useSheetT();
  const tf = useSheetTf();
  const now = useLessonClock();
  const done = reservedShownDone(list, now);
  // 이행됐지만 아직 끝 시각 전 = 정규 출석으로 시수가 미리 반영됐다 — 못 하면 고칠 곳을 알린다.
  const preApplied = !done && list.every((r) => r.done);
  const label = tf(done ? "os.reserved.done" : "os.reserved.tag", { time: reservedTimeText(list) });
  const title = [
    ...list.map((r) => tf(r.mode === "merge" ? "os.reserved.merge" : "os.reserved.separate", { date: shortDate(r.absenceDate) })),
    ...(preApplied ? [t("os.reserved.preApplied")] : []),
  ].join("\n");
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
