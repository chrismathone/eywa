"use client";

import { ToolbarChip } from "@/components/toolbar";
import type { SlackTarget } from "@/features/slack/rules";
import { ChipField } from "./chip-field";

/**
 * 보낼 곳 — 채널(여러 개) · 받는 사람 본인 1:1(알림 규칙만) · 정해 둔 사람 1:1(여러 명)을 한 칸에 칩으로.
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

  const known = new Map(channels.map((c) => [c.id, c]));
  for (const t of targets) if (t.kind === "channel" && !known.has(t.channelId)) known.set(t.channelId, { id: t.channelId, name: t.channelName, isPrivate: false });
  const nameOfUser = (id: string) => staff.find((s) => s.id === id)?.name ?? "직원";

  const rebuild = (next: { channels?: string[]; users?: string[]; recipient?: boolean }) => {
    const ch = next.channels ?? channelIds;
    const us = next.users ?? userIds;
    const rc = next.recipient ?? hasRecipient;
    onChange([
      ...ch.map((id) => ({ kind: "channel" as const, channelId: id, channelName: known.get(id)?.name ?? "" })),
      ...(rc && allowRecipient ? [{ kind: "recipient_dm" as const }] : []),
      ...us.map((id) => ({ kind: "user_dm" as const, userId: id, userName: nameOfUser(id) })),
    ]);
  };

  return (
    <div className="flex flex-col gap-2">
      <ChipField
        items={channelIds.map((id) => ({ key: id, label: known.get(id)?.name || "채널", icon: "hash" }))}
        onRemove={(id) => rebuild({ channels: channelIds.filter((x) => x !== id) })}
        empty="채널 없음"
        addLabel="채널"
        picker={{
          title: "보낼 채널",
          description: "공개 채널은 바로 보낼 수 있고, 비공개 채널은 그 채널에서 /invite @aywa 로 앱을 먼저 초대해야 합니다.",
          groups: [{ id: "ch", label: "채널" }],
          options: [...known.values()].map((c) => ({ key: c.id, label: `#${c.name}`, group: "ch", hint: c.isPrivate ? "비공개" : undefined })),
          picked: channelIds,
          onApply: (ids) => rebuild({ channels: ids }),
        }}
      />
      <ChipField
        items={userIds.map((id) => ({ key: id, label: nameOfUser(id), icon: "user" }))}
        onRemove={(id) => rebuild({ users: userIds.filter((x) => x !== id) })}
        empty={allowRecipient ? "정해 둔 사람 없음" : "1:1 없음"}
        addLabel="사람(1:1)"
        picker={{
          title: "항상 1:1로 받을 사람",
          description: "누구의 일이든 여기 고른 사람에게 1:1로 보냅니다. 슬랙 계정이 연결된 사람에게만 갑니다.",
          groups: [{ id: "u", label: "직원" }],
          options: staff.map((s) => ({ key: s.id, label: s.name, group: "u" })),
          picked: userIds,
          onApply: (ids) => rebuild({ users: ids }),
        }}
        extra={
          allowRecipient ? (
            <ToolbarChip active={hasRecipient} onClick={() => rebuild({ recipient: !hasRecipient })} title="그 알림을 aywa에서 받는 사람 본인에게 1:1">
              받는 사람 본인에게도
            </ToolbarChip>
          ) : null
        }
      />
    </div>
  );
}
