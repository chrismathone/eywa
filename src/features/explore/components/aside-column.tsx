"use client";

import { Suspense, use, useRef, useState } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ChevronRight, ExternalLink } from "@/components/icons/aywa-icon-compat";
import { WindowLink } from "@/components/workspace/window-link";
import { numberText } from "@/features/student-contribution/components/presentation";
import { COVERAGE_LABEL, KIND_ICON, type ExploreAside, type ExploreCenter, type ExploreContribution } from "../model";
import styles from "./layout.module.css";

type Props = {
  center: ExploreCenter;
  aside: ExploreAside | undefined;
  /** 기여도 점수(무거운 조회) — page가 기다리지 않고 넘긴 약속. 기여도가 꺼졌으면 null. */
  contribution: Promise<ExploreContribution> | null;
};

const CARD = `bg-card shadow-card rounded-2xl px-4 py-3.5 ${styles.card}`;
const H2 = "text-foreground mb-2 flex items-center gap-2 text-sm font-extrabold whitespace-nowrap";

/**
 * 왼쪽 열(원장 2026-11-05 시안 :3978) — 머리 '원생 정보' · 기본 정보(기준일 · 학교·학년 · 등록일 · 학부모 · 보호자2 · 원생번호 · 원생 상세 열기) ·
 * 기여도·기록(분석 월 · 월 합계 + 운영 기여 · 학습 참여 · 수업보고서 · 상담 · 특이사항 메모 · 기여도 화면 열기) · 자료 연결 상태.
 * 수업·강사 중심은 '수업 정보' · '강사 정보' 기본 정보 한 장(+ 영역 중심이면 '지금 보는 것').
 */
export function AsideColumn({ center, aside, contribution }: Props) {
  if (!aside) return null;
  const b = aside.basics;
  const groupLabel = center.group ? center.name.split(" · ").slice(1).join(" · ") : null;
  return (
    <>
      <div className={`text-foreground text-xs ${styles.colHead}`}>
        <EyIcon name={KIND_ICON[center.kind]} size={15} />
        {aside.heading}
      </div>
      <section className={CARD} aria-label={b.title}>
        <h2 className={H2}>
          {b.title}
          {b.spacer ? <span className="text-text-dim num ml-auto text-xs font-medium">{b.spacer}</span> : null}
        </h2>
        <dl className="flex flex-col gap-1.5">
          {b.facts.map((f) => (
            <div key={f.label} className="flex items-start justify-between gap-3 text-sm">
              <dt className="text-text-dim shrink-0 text-xs">{f.label}</dt>
              <dd className="text-foreground num min-w-0 text-right break-keep">{f.value}</dd>
            </div>
          ))}
        </dl>
        {b.link ? (
          <WindowLink href={b.link.href} title={b.link.label} frameTarget="window" className="text-primary mt-2 inline-flex items-center gap-1 self-start text-xs font-bold hover:underline">
            <ExternalLink className="size-3.5" />
            {b.link.label}
            <ChevronRight className="size-3.5" />
          </WindowLink>
        ) : null}
      </section>
      {center.kind === "student" && !center.group && (aside.records?.length || aside.contribution) ? (
        <RecordsCard studentId={center.id} aside={aside} contribution={contribution} />
      ) : null}
      {aside.coverage && aside.coverage.length > 0 && !center.group ? <CoverageCard items={aside.coverage} /> : null}
      {center.group ? (
        <section className={CARD} aria-label="지금 보는 것">
          <h2 className={H2}>지금 보는 것</h2>
          <dl className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-text-dim text-xs">영역</dt>
              <dd className="text-foreground text-right">{groupLabel}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-text-dim text-xs">뿌리</dt>
              <dd className="text-foreground text-right">{center.name.split(" · ")[0]}</dd>
            </div>
          </dl>
          <p className="text-text-dim mt-2 text-xs">경로의 앞 항목 · 우클릭 = 되돌아가기</p>
        </section>
      ) : null}
    </>
  );
}

/** 기여도·기록 — 기여도가 꺼진 지점·권한이면 카드 이름 '기록'에 건수만(있었는지조차 모르게). */
function RecordsCard({ studentId, aside, contribution }: { studentId: string; aside: ExploreAside; contribution: Promise<ExploreContribution> | null }) {
  const on = !!aside.contribution && contribution !== null;
  const [picked, setPicked] = useState<{ month: string; data: ExploreContribution | null } | null>(null);
  const [pending, setPending] = useState(false);
  // 달을 빨리 바꾸면 늦게 온 옛 응답이 새 선택을 덮는다 — 마지막 요청만 받는다.
  const seq = useRef(0);
  const pick = async (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const my = ++seq.current;
    const failed: ExploreContribution = { state: "error", month, months: [], href: `/students/${studentId}?tab=contribution` };
    setPicked({ month, data: null });
    setPending(true);
    let data: ExploreContribution = failed;
    try {
      const res = await fetch(`/api/explore/contribution?student=${encodeURIComponent(studentId)}&month=${month}`, { cache: "no-store" });
      if (res.ok) data = (await res.json()) as ExploreContribution;
    } catch {
      data = failed;
    }
    if (my !== seq.current) return;
    // 서버가 고른 달(목록 밖이면 가까운 달)을 입력칸에도 그대로 — 칸과 숫자가 다른 달을 말하지 않게.
    setPicked({ month: data.state === "ready" ? data.month : month, data });
    setPending(false);
  };
  return (
    <section className={CARD} aria-label={on ? "기여도·기록" : "기록"}>
      <h2 className={H2}>
        {on ? "기여도·기록" : "기록"}
        {on ? (
          <Suspense fallback={null}>
            <MonthInput promise={contribution!} value={picked?.month ?? null} onPick={pick} />
          </Suspense>
        ) : null}
      </h2>
      {on ? (
        <>
          <p className="text-foreground mb-1 text-xs font-extrabold opacity-85">기여도</p>
          {picked?.data ? (
            <ContributionLines data={picked.data} />
          ) : pending ? (
            <ContributionSkeleton />
          ) : (
            <Suspense fallback={<ContributionSkeleton />}>
              <ContributionFromPromise promise={contribution!} />
            </Suspense>
          )}
        </>
      ) : null}
      {aside.records && aside.records.length > 0 ? (
        <>
          {on ? <p className="text-foreground mt-2.5 mb-1 text-xs font-extrabold opacity-85">기록</p> : null}
          <ul className="flex flex-col">
            {aside.records.map((r, i) => (
              <li key={r.label} className={`flex items-baseline justify-between gap-2.5 py-1.5 ${i > 0 ? "border-line-faint border-t" : "pt-0.5"}`}>
                <span className="text-foreground text-xs font-bold">{r.label}</span>
                <span className="num text-foreground text-lg leading-tight font-extrabold">
                  {r.value.toLocaleString("ko-KR")}
                  <small className="ml-0.5 text-xs font-medium">{r.unit}</small>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {on ? (
        <Suspense fallback={null}>
          <ContributionLink promise={contribution!} picked={picked?.data ?? null} />
        </Suspense>
      ) : null}
    </section>
  );
}

function MonthInput({ promise, value, onPick }: { promise: Promise<ExploreContribution>; value: string | null; onPick: (m: string) => void }) {
  const first = use(promise);
  const months = first.months;
  const current = value ?? first.month;
  if (!current) return null;
  return (
    <label className="border-line ml-auto inline-flex h-[26px] items-center rounded-lg border pr-1.5 pl-2" title="분석 월">
      <input
        type="month"
        aria-label="분석 월"
        value={current}
        min={months[0]}
        max={months[months.length - 1]}
        onChange={(e) => onPick(e.target.value)}
        className="num w-[7.5rem] border-0 bg-transparent text-xs outline-none"
      />
    </label>
  );
}

function ContributionFromPromise({ promise }: { promise: Promise<ExploreContribution> }) {
  return <ContributionLines data={use(promise)} />;
}

function ContributionLines({ data }: { data: ExploreContribution }) {
  if (data.state !== "ready") {
    return <p className="text-text-dim py-1 text-xs break-keep">{data.state === "empty" ? "아직 집계된 기여도가 없습니다" : "기여도를 불러오지 못했습니다"}</p>;
  }
  const month = Number(data.month.slice(5, 7));
  return (
    <ul className="flex flex-col">
      <li className="flex items-baseline justify-between gap-2.5 pt-0.5 pb-1.5">
        <span className="text-foreground text-xs font-bold">{month}월 합계</span>
        <span className="num text-foreground text-lg leading-tight font-extrabold">
          {numberText(data.total)}
          <small className="ml-0.5 text-xs font-medium">점</small>
        </span>
      </li>
      {[
        ["운영 기여", data.operations],
        ["학습 참여", data.participation],
      ].map(([k, v]) => (
        <li key={k} className="flex items-baseline justify-between gap-2.5 py-px pl-2.5">
          <span className="text-foreground text-xs opacity-90">{k}</span>
          <span className="num text-foreground text-sm font-bold">
            {numberText(v as number)}
            <small className="ml-0.5 text-xs font-medium">점</small>
          </span>
        </li>
      ))}
    </ul>
  );
}

function ContributionLink({ promise, picked }: { promise: Promise<ExploreContribution>; picked: ExploreContribution | null }) {
  const data = picked ?? use(promise);
  return (
    <WindowLink href={data.href} title="기여도 화면 열기" frameTarget="window" className="text-primary mt-2 inline-flex items-center gap-1 self-start text-xs font-bold hover:underline">
      기여도 화면 열기
      <ChevronRight className="size-3.5" />
    </WindowLink>
  );
}

function ContributionSkeleton() {
  return (
    <div className="space-y-1.5 py-1" aria-busy="true">
      <div className="bg-bg-soft h-5 w-full animate-pulse rounded" />
      <div className="bg-bg-soft ml-2.5 h-4 w-[90%] animate-pulse rounded" />
      <div className="bg-bg-soft ml-2.5 h-4 w-[90%] animate-pulse rounded" />
    </div>
  );
}

/** 자료 연결 상태 — 머리 'N개 중 M 연결됨' + 연결되지 않은 것만 줄로(시안 · 칩 없음). */
function CoverageCard({ items }: { items: NonNullable<ExploreAside["coverage"]> }) {
  const connected = items.filter((i) => i.state === "connected").length;
  const rest = items.filter((i) => i.state !== "connected");
  return (
    <section className={CARD} aria-label="자료 연결 상태">
      <h2 className={H2}>
        자료 연결 상태
        <span className="text-text-dim num ml-auto text-xs font-medium">
          {items.length}개 중 {connected} 연결됨
        </span>
      </h2>
      {rest.length > 0 ? (
        <ul className="flex flex-col gap-1 text-xs">
          {rest.map((i) => (
            <li key={i.key} className="flex justify-between gap-2">
              <span className="text-foreground">{i.label}</span>
              <span className={`whitespace-nowrap ${i.state === "failed" ? "text-danger" : "text-text-dim"}`}>{COVERAGE_LABEL[i.state]}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="text-text-dim mt-2 text-xs">연결 전·열람 제한 = 기록 없음 아님</p>
    </section>
  );
}
