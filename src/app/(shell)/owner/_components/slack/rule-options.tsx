"use client";

import { ToolbarChip, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import type { SlackRule } from "@/features/slack/rules";
import { ChipField } from "./chip-field";

/**
 * 규칙의 모양·시점·제외 — 고른 값은 **반전(학원색 채움)**으로 보인다(원장 2026-09-28 *"체크로 하니 못알아보겠음. 반전"*).
 * ⚠️ 채널 알림 울림(@here·@channel)은 기본 꺼짐. 화면엔 슬랙 용어 대신 풀어 쓴 말만(원장 2026-09-28).
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

type Staff = { id: string; name: string }[];
const staffChips = (ids: string[], staff: Staff) =>
  ids.map((id) => ({ key: id, label: staff.find((s) => s.id === id)?.name ?? "직원", icon: "user" as const }));

/**
 * '누가'(0311a) — 비면 누구든 · 고르면 그 사람이 한 일만 보낸다. 발동자가 없는 것(시스템 자동 알림·PIN 화면 기록)은 빠진다.
 * '빼기'에 든 사람은 여기서 고를 수 없다(둘 다면 빼기가 이긴다 — rules.ts sanitizeRule과 같은 규칙).
 */
export function ActorRow({ rule, patch, staff }: { rule: SlackRule; patch: Patch; staff: Staff }) {
  return (
    <Row label="누가">
      <ChipField
        items={staffChips(rule.actorIds, staff)}
        onRemove={(id) => patch({ actorIds: rule.actorIds.filter((x) => x !== id) })}
        empty="누구든"
        addLabel="이 사람이 한 일만"
        picker={{
          title: "이 사람이 한 일만 보내기",
          description: "비워 두면 누가 했든 보냅니다. 시스템 자동 알림·PIN 화면 기록은 사람이 없어 빠집니다. '빼기'에 넣은 사람은 고를 수 없습니다.",
          groups: [{ id: "x", label: "직원" }],
          options: staff.map((s) => ({ key: s.id, label: s.name, group: "x", ...(rule.excludeActorIds.includes(s.id) ? { hint: "빼기에 있음" } : {}) })),
          picked: rule.actorIds,
          onApply: (ids) => patch({ actorIds: ids.filter((id) => !rule.excludeActorIds.includes(id)) }),
        }}
      />
      <span className="text-text-faint w-full text-sm">이 사람이 한 일만 보내기 · 시스템 자동 알림·PIN 화면 기록은 빠짐</span>
    </Row>
  );
}

export function RuleOptions({ rule, patch, staff }: { rule: SlackRule; patch: Patch; staff: Staff }) {
  return (
    <>
      <Row label="모양">
        <ToolbarSegment label="길이">
          <ToolbarSegmentItem active={rule.template === "short"} onClick={() => patch({ template: "short" })}>짧게</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.template === "detailed"} onClick={() => patch({ template: "detailed" })}>자세히</ToolbarSegmentItem>
        </ToolbarSegment>
        {/* 슬랙 용어(@here·@channel)는 화면에 내지 않는다 — 원장 2026-09-28 *"슬랙 초보는 몰라. 그냥 풀어쓰고"*. 보낼 땐 그대로 쓴다. */}
        <ToolbarSegment label="채널 알림 울림" title="채널 메시지를 올릴 때 사람들 슬랙에서 알림이 울리게 할지">
          <ToolbarSegmentItem active={rule.ping === "none"} onClick={() => patch({ ping: "none" })}>울리지 않음</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.ping === "here"} onClick={() => patch({ ping: "here" })}>지금 슬랙 켜 둔 사람만</ToolbarSegmentItem>
          <ToolbarSegmentItem active={rule.ping === "channel"} onClick={() => patch({ ping: "channel" })}>채널 사람 모두</ToolbarSegmentItem>
        </ToolbarSegment>
        {rule.source === "notification" ? (
          <ToolbarChip active={rule.mentionRecipients} onClick={() => patch({ mentionRecipients: !rule.mentionRecipients })} title="채널 메시지에 받는 사람 이름을 불러, 그 사람 슬랙에서 알림이 울리게(슬랙 계정이 연결된 사람만)">
            받는 사람 이름 불러서 울리기
          </ToolbarChip>
        ) : null}
        {rule.ping !== "none" ? <span className="text-danger text-sm">자주 오는 알림에 켜면 피로해집니다 — 급한 것에만</span> : null}
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
          items={staffChips(rule.excludeActorIds, staff)}
          onRemove={(id) => patch({ excludeActorIds: rule.excludeActorIds.filter((x) => x !== id) })}
          empty="모두 보냄"
          addLabel="이 사람이 한 일은 빼기"
          picker={{
            title: "이 사람이 한 일은 보내지 않기",
            description: "예: 원장 본인이 한 일은 피드에서 빼기.",
            groups: [{ id: "x", label: "직원" }],
            options: staff.map((s) => ({ key: s.id, label: s.name, group: "x", ...(rule.actorIds.includes(s.id) ? { hint: "누가에 있음" } : {}) })),
            picked: rule.excludeActorIds,
            // '누가'에 고른 사람은 빼기에 넣지 않는다 — 넣으면서 '누가'에서 내리면 목록이 비어 '누구든'으로 넓어질 수 있다.
            onApply: (ids) => patch({ excludeActorIds: ids.filter((id) => !rule.actorIds.includes(id)) }),
          }}
        />
      </Row>
    </>
  );
}
