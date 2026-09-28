"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { ACTIVITY_CATEGORIES, type ActivityOption } from "@/features/slack/activity-catalog";
import { FORWARD_EVENT_OPTIONS } from "@/features/slack/events";
import type { SlackRule } from "@/features/slack/rules";
import { deleteSlackRule, saveSlackRule, sendSlackRuleSample } from "@/features/slack/server/rule-actions";
import { CheckDropdowns, SLACK_BTN, SLACK_BTN_ON } from "./check-dropdowns";
import { RuleOptions } from "./rule-options";
import { TargetPicker, type ChannelOption } from "./target-picker";

/** 규칙 카드 하나 — 무엇을(알림/활동 종류) · 어디로 · 형식 · 언제. 저장·샘플·삭제는 규칙 단위. */
const NOTIF_GROUPS = [...new Set(FORWARD_EVENT_OPTIONS.map((o) => o.group))].map((g) => ({ id: g, label: g }));
const NOTIF_OPTIONS = FORWARD_EVENT_OPTIONS.map((o) => ({ key: o.type, label: o.label, group: o.group }));

export function RuleEditor({
  initial,
  channels,
  staff,
  activityOptions,
  onSaved,
  onDeleted,
}: {
  initial: SlackRule;
  channels: ChannelOption[];
  staff: { id: string; name: string }[];
  activityOptions: ActivityOption[];
  onSaved: (rule: SlackRule) => void;
  onDeleted: () => void;
}) {
  const [rule, setRule] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const patch = (p: Partial<SlackRule>) => setRule((r) => ({ ...r, ...p }));
  const dirty = JSON.stringify(rule) !== JSON.stringify(initial);

  const run = (fn: () => Promise<{ error?: string; message?: string; rule?: SlackRule }>, after?: (r: SlackRule | undefined) => void) => {
    if (pending) return;
    setErr(null);
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.message) setMsg(res.message);
      if (res.error) setErr(res.error);
      else after?.(res.rule);
    });
  };

  const typeGroups = rule.source === "notification" ? NOTIF_GROUPS : ACTIVITY_CATEGORIES;
  const typeOptions =
    rule.source === "notification"
      ? NOTIF_OPTIONS
      : activityOptions.map((o) => ({ key: o.key, label: o.label, group: o.category, locked: o.grade === "forbid" }));

  return (
    <section className="border-border bg-card space-y-2 rounded-xl border p-4" aria-label={`슬랙 규칙 ${rule.name}`}>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={rule.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="규칙 이름"
          className="border-line text-foreground min-w-40 flex-1 rounded-md border bg-transparent px-2.5 py-1.5 text-sm font-bold outline-none"
        />
        <button type="button" aria-pressed={rule.enabled} onClick={() => patch({ enabled: !rule.enabled })} className={rule.enabled ? SLACK_BTN_ON : SLACK_BTN}>
          {rule.enabled ? "켜짐" : "꺼짐"}
        </button>
        {!rule.id ? (
          <span className="inline-flex gap-1" role="group" aria-label="보낼 거리">
            {(["activity", "notification"] as const).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={rule.source === s}
                onClick={() => patch({ source: s, typeKeys: [], mentionRecipients: false, targets: rule.targets.filter((t) => t.kind !== "recipient_dm") })}
                className={rule.source === s ? SLACK_BTN_ON : SLACK_BTN}
              >
                {s === "activity" ? "활동 기록" : "알림"}
              </button>
            ))}
          </span>
        ) : (
          <span className="text-text-dim text-xs">{rule.source === "activity" ? "활동 기록" : "알림"}</span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-dim w-16 shrink-0 text-xs">무엇을</span>
        <CheckDropdowns groups={typeGroups} options={typeOptions} picked={rule.typeKeys} onChange={(k) => patch({ typeKeys: k })} ariaPrefix={rule.name} />
      </div>
      <TargetPicker targets={rule.targets} onChange={(t) => patch({ targets: t })} channels={channels} staff={staff} allowRecipient={rule.source === "notification"} />
      <RuleOptions rule={rule} patch={patch} staff={staff} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button type="button" onClick={() => run(() => saveSlackRule(rule), (r) => r && (setRule(r), onSaved(r)))} disabled={pending || (!dirty && !!rule.id)} className={SLACK_BTN_ON}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          저장
        </button>
        <button
          type="button"
          onClick={() => (dirty ? setErr("바꾼 내용을 먼저 저장해 주세요 — 샘플은 저장된 규칙으로 보냅니다") : run(() => sendSlackRuleSample(rule.id)))}
          disabled={pending || !rule.id}
          className={SLACK_BTN}
          title="고른 종류 앞 3개를 실제 모양 + 가상 데이터로(1:1 대상은 나에게만)"
        >
          샘플 보내기
        </button>
        <button
          type="button"
          onClick={() => {
            if (!rule.id) return onDeleted();
            if (window.confirm(`'${rule.name}' 규칙을 지울까요? 대기 중인 발송도 취소됩니다.`)) run(() => deleteSlackRule(rule.id, rule.name), () => onDeleted());
          }}
          disabled={pending}
          className={SLACK_BTN}
        >
          삭제
        </button>
        {dirty && rule.id ? <span className="text-text-dim text-xs">저장 안 된 변경</span> : null}
        {msg ? <span className="text-primary text-xs">{msg}</span> : null}
        {err ? <span className="text-danger text-xs">{err}</span> : null}
      </div>
    </section>
  );
}
