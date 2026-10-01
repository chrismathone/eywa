"use client";

/**
 * 역할별 운영실 시안 보드 — 위 줄: 조사 요약 / 역할 묶음 4개, 아래 줄: 시안 1~5 (+ 담당 과목 전환).
 *
 * 보기 상태(고른 묶음·시안·과목)는 저장하지 않는다 — 원장이 훑어보는 숨은 시안이라 계정 보기 설정이 아니다.
 * 이동은 주소가 아니라 상태로 바꾼다(창 안에서도 embed 주소 규약과 부딪히지 않게).
 * 과목 선택지는 학원설정(`useSubjectMaps().options`) — 과목 키·라벨을 코드에 적지 않는다.
 */
import { useState, type ReactNode } from "react";
import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { BUNDLES, type BundleId } from "../_data/bundles";
import { FAKE_DAY } from "../_data/fake";
import { DRAFTS } from "../_drafts";
import { DraftHead } from "./draft-head";
import { SubjectBadge } from "./parts";

type Tab = "research" | BundleId;

/**
 * `research`·`summaries`는 서버가 그려서 넘긴다 — 침산 실측(인원·직급)이 클라이언트 번들에 실리지 않게.
 */
export function RoleDraftBoard({ research, summaries }: { research: ReactNode; summaries: Record<BundleId, ReactNode> }) {
  const maps = useSubjectMaps();
  const [tab, setTab] = useState<Tab>("research");
  const [idx, setIdx] = useState(0);
  const [subject, setSubject] = useState(maps.options[0]?.value ?? "");
  const bundle = BUNDLES.find((b) => b.id === tab) ?? null;
  const Draft = bundle ? DRAFTS[bundle.id][idx] : null;
  const meta = bundle?.drafts[idx];

  return (
    <div className="flex flex-col gap-4">
      <Toolbar>
        <ToolbarSegment label="보기">
          <ToolbarSegmentItem active={tab === "research"} onClick={() => setTab("research")}>
            조사 요약
          </ToolbarSegmentItem>
          {BUNDLES.map((b) => (
            <ToolbarSegmentItem
              key={b.id}
              active={tab === b.id}
              onClick={() => {
                setTab(b.id);
                setIdx(0);
              }}
            >
              {b.label}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
        {bundle ? (
          <ToolbarSegment label="시안">
            {bundle.drafts.map((d, i) => (
              <ToolbarSegmentItem key={d.title} active={idx === i} onClick={() => setIdx(i)}>
                {i + 1} {d.title}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
        {bundle?.scoped && maps.options.length > 0 ? (
          <ToolbarSegment label="담당 과목" wrap>
            {maps.options.map((o) => (
              <ToolbarSegmentItem key={o.value} active={subject === o.value} onClick={() => setSubject(o.value)}>
                {o.label}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
      </Toolbar>

      {!bundle || !Draft || !meta ? (
        research
      ) : (
        <>
          {summaries[bundle.id]}
          <DraftHead index={idx} meta={meta} />
          <div className="border-line-strong bg-background rounded-2xl border border-dashed p-4">
            <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
              <span className="text-xs font-bold">화면 예시 · 가짜 데이터</span>
              <span className="text-base font-bold">{bundle.label} 운영실</span>
              <span className="text-sm">{FAKE_DAY}</span>
              {bundle.scoped ? (
                <span className="inline-flex items-center gap-1.5 text-sm">
                  <SubjectBadge subject={subject} /> 담당으로 본 화면
                </span>
              ) : null}
            </div>
            <Draft key={`${bundle.id}-${idx}-${subject}`} subject={subject} />
          </div>
        </>
      )}
    </div>
  );
}
