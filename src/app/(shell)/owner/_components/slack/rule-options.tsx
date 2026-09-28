"use client";

import { ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import type { SlackRule } from "@/features/slack/rules";
import { ChipField } from "./chip-field";

/**
 * 규칙의 모양·시점·제외 — 고른 값은 **반전(학원색 채움)**으로 보인다(원장 2026-09-28 *"체크로 하니 못알아보겠음. 반전"*).
 * ⚠️ @here·@channel은 채널 사람 전원에게 알림이 울린다 — 기본은 꺼짐, 켜면 경고 문구.
 */
type Patch = (p: Partial<SlackRule>) => void;

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[5.5rem_1fr] sm:items-start">
      <span className="text-text-dim pt-1.5 text-sm font-medium">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function RuleOptions({ rule, patch, staff }: { rule: SlackRule; patch: Patch; staff: { id: string; name: string }[] }) {
  return (
    <>
      <Row label="모양">
        <ToolbarSegment label="길이">
          <ToolbarSegmentItem active={rule.template === "short"} onClick={() => patch({ template: "short" })}>짧게</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.template === "detailed"} onClick={() => patch({ template: "detailed" })}>자세히</ToolbarSegmentItem>
        </ToolbarSegment>
        <ToolbarSegment label="호출">
          <ToolbarSegmentItem active={rule.ping === "none"} onClick={() => patch({ ping: "none" })}>없음</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.ping === "here"} onClick={() => patch({ ping: "here" })}>@here</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.ping === "channel"} onClick={() => patch({ ping: "channel" })}>@channel</ToolbarSegmentItem>
        </ToolbarSegment>
        {rule.source === "notification" ? (
          <ToolbarChip active={rule.mentionRecipients} onClick={() => patch({ mentionRecipients: !rule.mentionRecipients })} title="채널 메시지에서 받는 사람을 @이름으로 불러 슬랙 알림이 울리게(슬랙 계정이 연결된 사람만)">
            받는 사람 @멘션
          </ToolbarChip>
        ) : null}
        {rule.ping !== "none" ? <span className="text-danger text-sm">채널 사람 전원에게 알림이 울립니다</span> : null}
      </Row>
      <Row label="언제">
        <ToolbarSegment>
          <ToolbarSegmentItem active={rule.timing === "immediate"} onClick={() => patch({ timing: "immediate" })}>바로</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.timing === "digest"} onClick={() => patch({ timing: "digest" })}>요약으로만</ToolbarSegmentItem>
        </ToolbarSegment>
        {rule.timing === "digest" ? (
          <label className="text-text-dim inline-flex items-center gap-1.5 text-sm">
            요약 시각
            <input
              type="time"
              value={rule.digestAt ?? ""}
              onChange={(e) => patch({ digestAt: e.target.value || null })}
              className="border-line h-(--control-h) rounded-lg border bg-transparent px-2 text-sm"
            />
            <span className="text-text-faint">비우면 기본 시각</span>
          </label>
        ) : (
          <ToolbarChip active={rule.honorDnd} onClick={() => patch({ honorDnd: !rule.honorDnd })} title="끄면 방해금지 시간에도 바로 보냅니다(긴급 알림용)">
            방해금지 지키기
          </ToolbarChip>
        )}
      </Row>
      <Row label="빼기">
        <ChipField
          items={rule.excludeActorIds.map((id) => ({ key: id, label: staff.find((s) => s.id === id)?.name ?? "직원", icon: "user" }))}
          onRemove={(id) => patch({ excludeActorIds: rule.excludeActorIds.filter((x) => x !== id) })}
          empty="모두 보냄"
          addLabel="이 사람이 한 일은 빼기"
          picker={{
            title: "이 사람이 한 일은 보내지 않기",
            description: "예: 원장 본인이 한 일은 피드에서 빼기.",
            groups: [{ id: "x", label: "직원" }],
            options: staff.map((s) => ({ key: s.id, label: s.name, group: "x" })),
            picked: rule.excludeActorIds,
            onApply: (ids) => patch({ excludeActorIds: ids }),
          }}
        />
      </Row>
    </>
  );
}
