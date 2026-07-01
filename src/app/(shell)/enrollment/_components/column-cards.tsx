"use client";

import { useState } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { Pill } from "@/components/atoms/pill";
import {
  PAGER_STEP_BASE,
  PAGER_STEP_ENABLED,
  PAGER_STEP_DISABLED,
  PAGER_LABEL,
} from "@/components/pagination";
import type { ConsultationListRow } from "@/features/enrollment/server/queries";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { OUTCOME_PILL } from "./outcome-meta";

const PAGE_SIZE = 8;

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/**
 * 등록상담 칸반 컬럼 카드 목록 — 한 컬럼에 100+ 카드가 쏟아져 페이지가 끝없이 길어지는 걸 막는다.
 * 옛 "+N개 더 보기"(전체 펼침)는 200장이 통째로 펼쳐져 스크롤이 폭발했다 → **컬럼 내 페이지네이션**으로
 * 전환: 페이지당 PAGE_SIZE개만 렌더 + ◀▶로 이동 → 컬럼 높이가 항상 ≤ PAGE_SIZE장으로 고정된다.
 * (데이터는 이미 클라에 있으므로 추가 fetch 없이 슬라이스만.)
 */
export function ColumnCards({
  cards,
}: {
  cards: ConsultationListRow[];
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  // 필터로 카드 수가 줄어 현재 page가 범위를 벗어나면 마지막 페이지로 보정(렌더 중 파생값 — setState 아님).
  const safePage = Math.min(page, totalPages - 1);
  const visible = cards.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="flex flex-1 flex-col">
      {/* ⚠️ 위치 고정: 페이지가 있으면 목록 영역을 **고정 높이**로 둔다 → 페이지마다 카드 수·내용
          높이가 달라도 컬럼 높이가 변하지 않아 아래 페이저(◀ 이전/다음 ▶)가 같은 자리에 머문다
          ("페이지 이동 때마다 위치가 틀어짐" 해소). 한 페이지가 더 길면 내부 스크롤. */}
      <ul className={`space-y-2 p-3 ${totalPages > 1 ? "h-[56vh] overflow-y-auto" : ""}`}>
        {visible.map((c) => {
          const pill = OUTCOME_PILL[c.outcome] ?? OUTCOME_PILL.pending!;
          return (
            <li key={c.id}>
              <WindowLink
                href={`/enrollment/${c.id}`}
                title={c.prospectName}
                className="bg-bg-soft/60 hover:bg-bg-soft block rounded-xl p-3 transition"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0">
                      <p className="text-foreground flex items-center gap-1 text-[13px] font-bold">
                        {c.prospectName}
                        {c.fromPublicIntake ? (
                          <span className="bg-primary-soft text-primary rounded px-1 py-0.5 text-[9px] font-bold" title="학부모 QR 접수">
                            QR
                          </span>
                        ) : null}
                        {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                        <EditingBadge scope={`consultation:${c.id}`} />
                      </p>
                      <p className="text-text-dim text-[11px]">
                        {c.prospectGrade ?? "—"}
                        {c.prospectSchool ? <> · {c.prospectSchool}</> : null}
                      </p>
                    </div>
                  </div>
                  <Pill color={pill.color}>{pill.label}</Pill>
                </div>
                {c.parentRequest ? (
                  <p className="text-text-dim mt-2 line-clamp-2 text-[11px] leading-snug">
                    {c.parentRequest}
                  </p>
                ) : null}
                <div className="text-text-faint mt-2 flex items-center justify-between text-[10px]">
                  <span>{c.consultantName ?? "—"}</span>
                  <span className="num">{daysSince(c.consultedAt)}일 전</span>
                </div>
              </WindowLink>
            </li>
          );
        })}
      </ul>

      {totalPages > 1 ? (
        // 공용 페이저 스타일(`<Pagination>`과 동일 클래스 상수) — 앱 전역 페이지네이션 룩 통일.
        <nav
          className="border-line flex items-center justify-between gap-2 border-t px-3 py-2"
          aria-label="페이지 이동"
        >
          <button
            type="button"
            onClick={() => setPage(safePage - 1)}
            disabled={safePage === 0}
            className={`${PAGER_STEP_BASE} ${safePage === 0 ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED}`}
          >
            ◀ 이전
          </button>
          <span className={PAGER_LABEL}>
            {safePage + 1} / {totalPages} · {cards.length}건
          </span>
          <button
            type="button"
            onClick={() => setPage(safePage + 1)}
            disabled={safePage >= totalPages - 1}
            className={`${PAGER_STEP_BASE} ${safePage >= totalPages - 1 ? PAGER_STEP_DISABLED : PAGER_STEP_ENABLED}`}
          >
            다음 ▶
          </button>
        </nav>
      ) : null}
    </div>
  );
}
