"use client";

import type { SlackTarget } from "@/features/slack/rules";
import { CheckDropdowns, SLACK_BTN, SLACK_BTN_ON } from "./check-dropdowns";

/**
 * 보낼 곳 — 채널(여러 개) · 받는 사람 본인 1:1(알림 규칙만) · 정해 둔 사람 1:1(여러 명).
 * 채널 목록을 못 불러왔으면 이미 저장된 채널만 보인다(이름은 저장 당시 것).
 */
export type ChannelOption = { id: string; name: string; isPrivate: boolean };

export function TargetPicker({
  targets,
  onChange,
  channels,
  staff,
  allowRecipient,
}: {
  targets: SlackTarget[];
  onChange: (next: SlackTarget[]) => void;
  channels: ChannelOption[];
  staff: { id: string; name: string }[];
  allowRecipient: boolean;
}) {
  const channelIds = targets.flatMap((t) => (t.kind === "channel" ? [t.channelId] : []));
  const userIds = targets.flatMap((t) => (t.kind === "user_dm" ? [t.userId] : []));
  const hasRecipient = targets.some((t) => t.kind === "recipient_dm");

  // 저장된 채널이 목록에 없어도(로딩 전·봇이 빠진 비공개 채널) 빈 칸이 되지 않게 옵션에 붙인다.
  const known = new Map(channels.map((c) => [c.id, c]));
  for (const t of targets) if (t.kind === "channel" && !known.has(t.channelId)) known.set(t.channelId, { id: t.channelId, name: t.channelName, isPrivate: false });
  const channelOpts = [...known.values()].map((c) => ({ key: c.id, label: `#${c.name}${c.isPrivate ? " (비공개)" : ""}`, group: "ch" }));
  const staffOpts = staff.map((s) => ({ key: s.id, label: s.name, group: "u" }));

  const rebuild = (next: { channels?: string[]; users?: string[]; recipient?: boolean }) => {
    const ch = next.channels ?? channelIds;
    const us = next.users ?? userIds;
    const rc = next.recipient ?? hasRecipient;
    onChange([
      ...ch.map((id) => ({ kind: "channel" as const, channelId: id, channelName: known.get(id)?.name ?? "" })),
      ...(rc && allowRecipient ? [{ kind: "recipient_dm" as const }] : []),
      ...us.map((id) => ({ kind: "user_dm" as const, userId: id, userName: staff.find((s) => s.id === id)?.name ?? "" })),
    ]);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-text-dim w-16 shrink-0 text-xs">보낼 곳</span>
      <CheckDropdowns
        groups={[{ id: "ch", label: "채널" }]}
        options={channelOpts}
        picked={channelIds}
        onChange={(ids) => rebuild({ channels: ids })}
        ariaPrefix="보낼"
      />
      {allowRecipient ? (
        <button
          type="button"
          aria-pressed={hasRecipient}
          onClick={() => rebuild({ recipient: !hasRecipient })}
          className={hasRecipient ? SLACK_BTN_ON : SLACK_BTN}
          title="그 알림을 aywa에서 받는 사람에게, 연결된 슬랙 계정으로 1:1"
        >
          {hasRecipient ? "✓ " : ""}받는 사람 본인(1:1)
        </button>
      ) : null}
      <CheckDropdowns
        groups={[{ id: "u", label: "정해 둔 사람(1:1)" }]}
        options={staffOpts}
        picked={userIds}
        onChange={(ids) => rebuild({ users: ids })}
        ariaPrefix="보낼"
      />
    </div>
  );
}
