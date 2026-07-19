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
import { relativeTimeKo } from "@/lib/relative-time";
import { OUTCOME_PILL } from "./outcome-meta";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSubjectMaps } from "@/features/owner/operations-context";

const PAGE_SIZE = 8;

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
  const subjectMaps = useSubjectMaps(); // 팝오버 상담 행의 과목 라벨(클라 단일소스)
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
          // 수업이 1개 이상 배정된 카드는 outcome 라벨("등록") 대신 진짜 완료 배지 "배정 완료".
          const assigned = c.assignedClassCount >= 1;
          const pill = assigned
            ? { label: "배정 완료", color: "primary" as const }
            : (OUTCOME_PILL[c.outcome] ?? OUTCOME_PILL.pending!);
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
                      <p className="text-foreground flex items-center gap-1.5 text-[13.5px] font-bold">
                        {c.prospectName}
                        {c.fromPublicIntake ? (
                          <span className="bg-primary-soft text-primary rounded-full px-2 py-0.5 text-[11px] leading-none font-bold" title="학부모 QR 접수">
                            QR
                          </span>
                        ) : null}
                        {c.personConsultCount > 1 ? (
                          // 배지 클릭 = 그 학생의 등록상담 전건 팝오버(나머지 상담 열람). base-ui Menu는 body로
                          // portal되어 스크롤 컬럼에 안 잘리고, 트리거의 preventDefault/stopPropagation로 카드 창-내비를 막는다.
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <span
                                  role="button"
                                  tabIndex={0}
                                  title={`이 학생의 등록상담 ${c.personConsultCount}건 — 눌러서 나머지 상담 보기`}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                  }}
                                  className="bg-amber-soft text-amber cursor-pointer rounded-full px-2 py-0.5 text-[11px] leading-none font-bold hover:brightness-95"
                                />
                              }
                            >
                              상담 {c.personConsultCount}건
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-60 p-1.5">
                              <p className="text-text-faint px-1 pb-1 text-[11px] font-medium">
                                이 학생의 등록상담 {c.personConsultCount}건
                              </p>
                              {c.personConsults.map((s) => {
                                const op = OUTCOME_PILL[s.outcome] ?? OUTCOME_PILL.pending!;
                                const sl = s.subject ? subjectMaps.labelOf(s.subject) : null;
                                return (
                                  <WindowLink
                                    key={s.id}
                                    href={`/enrollment/${s.id}`}
                                    title={s.prospectName}
                                    className={`hover:bg-bg-soft flex items-center justify-between gap-2 rounded-md px-2 py-1.5 ${
                                      s.id === c.id ? "bg-bg-soft/60" : ""
                                    }`}
                                  >
                                    <span className="num text-text-dim text-[11px]">
                                      {new Date(s.consultedAt).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" })}
                                    </span>
                                    <span className="flex items-center gap-1.5">
                                      {sl ? <span className="text-foreground text-[11px]">{sl}</span> : null}
                                      <Pill color={op.color}>{op.label}</Pill>
                                    </span>
                                  </WindowLink>
                                );
                              })}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                        {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                        <EditingBadge scope={`consultation:${c.id}`} />
                      </p>
                      <p className="text-text-dim mt-0.5 text-[12px]">
                        {c.prospectGrade ?? "—"}
                        {c.prospectSchool ? <> · {c.prospectSchool}</> : null}
                        {assigned ? <span className="text-primary"> · 수업 {c.assignedClassCount}개</span> : null}
                      </p>
                    </div>
                  </div>
                  <Pill color={pill.color}>{pill.label}</Pill>
                </div>
                {c.parentRequest ? (
                  <p className="text-text-dim mt-2 line-clamp-2 text-[12px] leading-snug">
                    {c.parentRequest}
                  </p>
                ) : null}
                <div className="text-text-faint mt-2 flex items-center justify-between text-[11.5px]">
                  <span>{c.consultantName ?? "—"}</span>
                  <span className="num">{relativeTimeKo(c.consultedAt)}</span>
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
            <EyIcon name="chevronLeft" size={12} />
            이전
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
            다음
            <EyIcon name="chevronRight" size={12} />
          </button>
        </nav>
      ) : null}
    </div>
  );
}
