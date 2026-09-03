"use client";

import { useMemo, useState } from "react";
import {
  PAGER_LABEL,
  PAGER_STEP_BASE,
  PAGER_STEP_DISABLED,
  PAGER_STEP_ENABLED,
} from "@/components/pagination";
import { EyIcon } from "@/components/icons/eywa-icons";
import type { ClassHistoryEntry, ClassHistorySource } from "@/features/classes/history";

/**
 * 반 상세 '이력' — 배치 구간·감사로그·임시 위임·보고서 작성 기록을 한 줄기로(원장 2026-08-04).
 *
 * ⚠️ 출처를 **알약으로 밝힌다** — 같은 목록에 섞여 있어도 무엇이 사실이고 무엇이 정황인지 보여야 한다.
 *    특히 '보고서'는 **작성자**이지 담임이 아니다([[#93]]) — 담당 변경으로 읽히면 거짓이 된다.
 * ⚠️ 목록이 길어지므로 **기간 검색 + 페이지네이션**(원장 지시 2026-08-04). 창(최근 2개월)으로 좁힌 건
 *    보고서 근거뿐이고 배치·로그는 전 기간이 남아 있어 실제로 길어진다.
 * ⚠️ 페이저는 앱 표준 클래스(`PAGER_STEP_*`)를 복제한다 — 여긴 href가 아니라 클라 state라 컴포넌트
 *    직접 재사용이 안 된다(pagination.tsx 주석에 명시된 패턴).
 * ⚠️ 목록 영역은 **고정 높이** — 마지막 페이지가 짧아 목록이 줄면 페이저가 커서 밑에서 튄다(같은 주석).
 */
const SOURCE_LABEL: Record<ClassHistorySource, string> = {
  schedule: "배치",
  audit: "기록",
  delegation: "위임",
  enrollment: "학생",
  report: "보고서",
};

const SOURCE_TONE: Record<ClassHistorySource, string> = {
  schedule: "border-line-strong text-text-dim",
  audit: "border-primary/40 text-primary bg-primary/5",
  delegation: "border-amber/50 text-amber bg-amber-soft",
  enrollment: "border-blue/40 text-blue bg-blue/5",
  report: "border-line-strong text-text-faint",
};

const PAGE_SIZE = 10;

export function ClassHistorySection({ entries }: { entries: ClassHistoryEntry[] }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        // 구간 항목은 **겹치면** 통과 — 시작일만 보면 "3월부터 지금까지"인 배치가 7월 검색에서 사라진다.
        // 시점 사건(감사·배정·보고서)은 endDate가 없다고 열린 구간이 아니다 — 그 날 하루다.
        // (안 가르면 3월의 학생 배정이 8월 검색에 계속 새어든다. '~현재' 의미는 배치·위임만.)
        const openEnded = e.source === "schedule" || e.source === "delegation";
        const end = e.endDate ?? (openEnded ? "9999-12-31" : e.date);
        if (from && end < from) return false;
        if (to && e.date > to) return false;
        return true;
      }),
    [entries, from, to],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const shown = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const withReset = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <section className="bg-card shadow-card rounded-2xl px-4 py-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-foreground text-sm font-bold">이력</h2>
        <p className="text-text-dim min-w-0 flex-1 text-xs break-keep">
          수업 배치·담당·강의실·학생 배정이 바뀐 기록입니다. 시간표에서 그 주를 열면 당시 배치가 그대로
          보입니다.
        </p>
        <span className="flex shrink-0 items-center gap-1">
          <input
            type="date"
            value={from}
            onChange={(e) => withReset(() => setFrom(e.target.value))}
            aria-label="이력 시작일"
            className="border-line-strong text-foreground rounded-lg border bg-transparent px-2 py-1 text-xs"
          />
          <span className="text-text-faint text-xs">~</span>
          <input
            type="date"
            value={to}
            onChange={(e) => withReset(() => setTo(e.target.value))}
            aria-label="이력 종료일"
            className="border-line-strong text-foreground rounded-lg border bg-transparent px-2 py-1 text-xs"
          />
          {from || to ? (
            <button
              type="button"
              onClick={() =>
                withReset(() => {
                  setFrom("");
                  setTo("");
                })
              }
              className="text-text-dim hover:text-foreground hover:bg-bg-soft cursor-pointer rounded-lg px-2 py-1 text-xs"
            >
              전체
            </button>
          ) : null}
        </span>
      </header>

      {entries.length === 0 ? (
        // 원인을 정확히 — "기록이 없다"와 "이 반은 안 바뀌었다"는 다르다.
        <p className="text-text-dim mt-3 text-sm break-keep">
          남아 있는 변경 기록이 없습니다. 2026-08-04 이전의 담당·강의실 변경은 기록 자체가 남지 않아
          되살릴 수 없고, 이후의 변경부터 이 자리에 쌓입니다.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-text-dim mt-3 text-sm break-keep">
          그 기간에는 기록이 없습니다. 위 날짜를 지우면 전체가 보입니다.
        </p>
      ) : (
        <>
          {/* 고정 높이 — 마지막 페이지가 짧아도 페이저가 위로 튀지 않게(표준 주석의 함정). */}
          <ol className="mt-3 h-[320px] space-y-2 overflow-y-auto pr-1">
            {shown.map((e, i) => (
              <li
                key={`${e.date}-${e.source}-${i}`}
                className="border-line flex gap-3 border-t pt-2 first:border-t-0 first:pt-0"
              >
                <span className="num text-text-dim w-[92px] shrink-0 text-xs whitespace-nowrap">
                  {e.date}
                  {e.endDate ? (
                    <span className="text-text-faint block text-xs">~{e.endDate}</span>
                  ) : e.source === "schedule" ? (
                    <span className="text-text-faint block text-xs">~ 현재</span>
                  ) : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-pill border px-1.5 py-px text-xs font-bold ${SOURCE_TONE[e.source]}`}
                    >
                      {SOURCE_LABEL[e.source]}
                    </span>
                    <span className="text-foreground text-sm font-semibold break-keep">{e.title}</span>
                    {e.actor ? <span className="text-text-faint text-xs">· {e.actor}</span> : null}
                  </span>
                  {e.detail ? (
                    <span className="text-text-dim mt-0.5 block text-xs break-keep">{e.detail}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>

          {totalPages > 1 ? (
            <nav
              className="mx-auto flex max-w-xs items-center justify-between gap-2 pt-2"
              aria-label="이력 페이지 이동"
            >
              <button
                type="button"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className={`${PAGER_STEP_BASE} ${
                  safePage <= 1 ? PAGER_STEP_DISABLED : `${PAGER_STEP_ENABLED} cursor-pointer`
                }`}
              >
                <EyIcon name="chevronLeft" size={12} />
                이전
              </button>
              <span className={PAGER_LABEL}>
                {safePage} / {totalPages} · {filtered.length}건
              </span>
              <button
                type="button"
                disabled={safePage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className={`${PAGER_STEP_BASE} ${
                  safePage >= totalPages ? PAGER_STEP_DISABLED : `${PAGER_STEP_ENABLED} cursor-pointer`
                }`}
              >
                다음
                <EyIcon name="chevronRight" size={12} />
              </button>
            </nav>
          ) : null}
        </>
      )}
    </section>
  );
}
