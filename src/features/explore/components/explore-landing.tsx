"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { useEmbed } from "@/components/workspace/embed-context";
import { EmbedLink } from "@/components/embed-link";
import { ExploreSearch } from "./explore-search";
import { EXPLORE_KINDS, KIND_ICON, KIND_LABEL, SECTOR_DEFS, exploreHref, exploreLandingHref, type ExploreTarget } from "../model";

/** 중심이 아직 없는 첫 화면 — 검색으로 첫 중심을 놓는다(원생목록·수업목록·직원 상세의 '연결 탐색' 버튼은 바로 중심으로 연다). */
export function ExploreLanding() {
  const router = useRouter();
  const embed = useEmbed();
  const [pending, startTransition] = useTransition();
  const pick = (t: ExploreTarget) => startTransition(() => router.push(exploreHref(t, { embed })));
  return (
    <div className="space-y-4">
      <PageHeader title="연결 탐색" description="원생·수업·강사·강의실 중 하나를 가운데 놓고, 이어진 수업·출결·성적·담임·원생을 한눈에 돌아봅니다." embedLabel="원생·수업·강사·강의실을 검색해 시작하세요" />
      <div className="bg-card shadow-card mx-auto w-full max-w-2xl space-y-5 rounded-2xl p-6" aria-busy={pending || undefined}>
        <div className="space-y-1">
          <h2 className="text-foreground text-xl font-bold">무엇을 가운데 놓을까요?</h2>
          <p className="text-text-dim text-sm break-keep">이름 두 글자부터 찾습니다. 고르면 그 대상이 도넛의 중심이 되고, 주변 영역에서 다른 대상을 골라 계속 이동할 수 있어요.</p>
        </div>
        <ExploreSearch onPick={pick} size="lg" autoFocus />
        {pending ? (
          <p className="text-text-dim inline-flex items-center gap-2 text-sm" role="status">
            <Loader2 className="size-4 animate-spin" /> 불러오는 중…
          </p>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EXPLORE_KINDS.map((kind) => (
            <li key={kind} className="border-line rounded-xl border p-3">
              <p className="text-foreground inline-flex items-center gap-1.5 text-sm font-bold">
                <EyIcon name={KIND_ICON[kind]} size={16} className="text-primary" />
                {KIND_LABEL[kind]} 중심
              </p>
              <p className="text-text-dim mt-1 text-xs break-keep">{SECTOR_DEFS[kind].map((s) => s.label).join(" · ")}</p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** 열람할 수 없는 대상 — 없는 것과 권한 밖을 가르지 않되(존재 여부도 정보다), 왜 못 보는지는 말한다. */
export function ExploreNotice({ title, message }: { title: string; message: string }) {
  return (
    <div className="space-y-4">
      <PageHeader title="연결 탐색" description={title} />
      <div className="bg-card shadow-card mx-auto w-full max-w-2xl rounded-2xl p-6">
        <p className="text-foreground text-sm font-bold">{title}</p>
        <p className="text-text-dim mt-1 text-sm break-keep">{message}</p>
        <EmbedLink href={exploreLandingHref()} className="text-primary mt-4 inline-block text-sm font-bold hover:underline">
          다른 대상 검색하기 ›
        </EmbedLink>
      </div>
    </div>
  );
}
