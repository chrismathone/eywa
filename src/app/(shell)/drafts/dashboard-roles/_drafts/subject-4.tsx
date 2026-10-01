"use client";

/** 과목 관리자 시안 4 — 학생 목록 중심 "학생 알림". 사유 **분류**로 거르고, 결석 사유 원문·연락처·미납은 싣지 않는다. */
import { useState } from "react";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { Panel, Row, ToneBadge } from "../_components/parts";
import { subjectFake } from "../_data/fake";
import type { DraftProps } from "./types";

const KINDS = ["전체", "결석", "과제", "성적", "보강"] as const;
type Kind = (typeof KINDS)[number];

function kindOf(reason: string): Exclude<Kind, "전체"> {
  if (reason.includes("과제")) return "과제";
  if (reason.includes("테스트")) return "성적";
  if (reason.includes("보강")) return "보강";
  return "결석";
}

export function Subject4({ subject }: DraftProps) {
  const [kind, setKind] = useState<Kind>("전체");
  const f = subjectFake(subject);
  const rows = [
    ...f.watch.map((w) => ({ name: w.name, school: w.school, reason: w.reason, kind: kindOf(w.reason), tone: w.tone })),
    ...f.absences.map((a) => ({
      name: a.name,
      school: a.school,
      reason: `${a.className} · 결석 ${a.streak}회 · ${a.makeup}`,
      kind: "결석" as const,
      tone: a.streak >= 3 ? ("critical" as const) : ("caution" as const),
    })),
  ];
  const shown = kind === "전체" ? rows : rows.filter((r) => r.kind === kind);
  return (
    <Panel
      title="학생 알림"
      count={`${shown.length}명`}
      note={
        <ToolbarSegment>
          {KINDS.map((k) => (
            <ToolbarSegmentItem key={k} active={kind === k} onClick={() => setKind(k)}>
              {k}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
      }
    >
      {shown.map((r) => (
        <Row
          key={`${r.name}-${r.kind}-${r.reason}`}
          name={`${r.name} · ${r.school}`}
          desc={r.reason}
          right={
            <>
              <ToneBadge tone="inert">{r.kind}</ToneBadge>
              <ToneBadge tone={r.tone}>{r.tone === "critical" ? "위험" : "주의"}</ToneBadge>
            </>
          }
        />
      ))}
    </Panel>
  );
}
