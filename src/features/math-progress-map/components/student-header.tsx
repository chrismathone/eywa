"use client";

import { Pill } from "@/components/atoms/pill";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { toneColor } from "@/lib/design/semantic-color";
import { nextChapterAfter } from "../focus";
import { PACE_META, paceLabel } from "../pace";
import { useProgressMap } from "./map-state";

/**
 * 학생 한 줄 — 이름·학년 · 지금 교재/단원/쪽 · **다음 단원** · 계획 대비. 지도 위에서 3초 답의 글자판
 * (지시 18의 다섯 질문 중 "지금 어디"·"다음이 무엇"·"빠른가 느린가"가 이 줄에 다 있다 — 아래 카드로 내려가기 전에).
 */
export function StudentHeader() {
  const { sourceProgress: progress, pace } = useProgressMap();
  // 과목 이름은 학원설정이 단일 소스(운영 enum 하드코딩 금지) — 이 화면은 수학 전용이라 키만 고정.
  const subjectLabel = useSubjectMaps().labelOf("math");
  const c = progress.curriculum;
  const next = nextChapterAfter(progress);
  return (
    <section className="bg-card shadow-card flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl px-4 py-3">
      <div className="min-w-0">
        <p className="text-foreground text-xl leading-tight font-bold">{progress.studentName}</p>
        <p className="text-text-dim text-xs font-medium">
          {progress.grade} · {subjectLabel} · {c.semester}
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <Pill color="primary" size="md">
          {c.bookName}
        </Pill>
        <span className="text-foreground text-sm font-bold break-keep">{c.chapter}</span>
        {c.subChapter ? <span className="text-text-dim text-sm break-keep">› {c.subChapter}</span> : null}
        <span className="text-foreground num text-sm font-medium">
          p.{c.currentPage} / {c.totalPages}
        </span>
        {next ? (
          <span className="text-text-dim text-xs font-medium break-keep">
            다음 단원 <span className="text-foreground font-bold">{next.chapter}</span> <span className="num">({next.month}월)</span>
          </span>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className="text-text-dim text-xs font-medium">계획 대비</span>
        <Pill color={toneColor(PACE_META[pace.status].tone)} size="md">
          {paceLabel(pace)}
        </Pill>
      </div>
    </section>
  );
}
