"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "@/components/icons/aywa-icon-compat";
import { ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import { Button } from "@/components/ui/button";
import { ACTIVITY_CATEGORIES, type ActivityOption } from "@/features/slack/activity-catalog";
import { FORWARD_EVENT_OPTIONS } from "@/features/slack/events";
import type { SlackRule } from "@/features/slack/rules";
import { deleteSlackRule, saveSlackRule, sendSlackRuleSample } from "@/features/slack/server/rule-actions";
import { ChipField } from "./chip-field";
import { MessagePreview } from "./message-preview";
import { Row, RuleOptions } from "./rule-options";
import { TargetPicker, type ChannelOption } from "./target-picker";

/** 규칙 카드 — 머리(켜기·이름·보낼 거리) · 무엇을 · 어디로 · 모양 · 언제 · 빼기 · 미리보기 · 저장/샘플/삭제. */
const NOTIF_GROUPS = [...new Set(FORWARD_EVENT_OPTIONS.map((o) => o.group))].map((g) => ({ id: g, label: g }));
const NOTIF_OPTIONS = FORWARD_EVENT_OPTIONS.map((o) => ({ key: o.type, label: o.label, group: o.group }));

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${on ? "bg-primary" : "bg-line-strong"}`}
    >
      <span className={`size-5 rounded-full bg-white shadow-sm transition-transform ${on ? "translate-x-[22px]" : "translate-x-0.5"}`} />
    </button>
  );
}

type Props = {
  initial: SlackRule;
  channels: ChannelOption[];
  staff: { id: string; name: string }[];
  activityOptions: ActivityOption[];
  onSaved: (rule: SlackRule) => void;
  onDeleted: () => void;
};

export function RuleEditor({ initial, channels, staff, activityOptions, onSaved, onDeleted }: Props) {
  const [rule, setRule] = useState(initial);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const patch = (p: Partial<SlackRule>) => setRule((r) => ({ ...r, ...p }));
  const dirty = JSON.stringify(rule) !== JSON.stringify(initial);

  const run = (fn: () => Promise<{ error?: string; message?: string; rule?: SlackRule }>, after?: (r?: SlackRule) => void) => {
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
  const save = () =>
    run(
      () => saveSlackRule(rule),
      (r) => {
        if (!r) return;
        setRule(r);
        onSaved(r);
      },
    );
  const remove = () => {
    if (!rule.id) return onDeleted();
    if (window.confirm(`'${rule.name}' 규칙을 지울까요? 대기 중인 발송도 취소됩니다.`)) run(() => deleteSlackRule(rule.id, rule.name), () => onDeleted());
  };

  const isNotif = rule.source === "notification";
  const groups = isNotif ? NOTIF_GROUPS : ACTIVITY_CATEGORIES;
  const options = isNotif ? NOTIF_OPTIONS : activityOptions.map((o) => ({ key: o.key, label: o.label, group: o.category, locked: o.grade === "forbid" }));
  const labelOf = new Map(options.map((o) => [o.key, o.label]));

  return (
    <section className={`bg-card rounded-2xl border ${rule.enabled ? "border-border" : "border-dashed border-line"}`} aria-label={`슬랙 규칙 ${rule.name}`}>
      <header className="border-line flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Switch on={rule.enabled} onChange={(v) => patch({ enabled: v })} label={`${rule.name} 켜기`} />
        <input
          value={rule.name}
          onChange={(e) => patch({ name: e.target.value })}
          aria-label="규칙 이름"
          className="text-foreground focus:border-line min-w-40 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-base font-bold outline-none"
        />
        {!rule.id ? (
          <ToolbarSegment label="보낼 거리">
            {(["activity", "notification"] as const).map((s) => (
              <ToolbarSegmentItem
                key={s}
                active={rule.source === s}
                onClick={() => patch({ source: s, typeKeys: [], mentionRecipients: false, targets: rule.targets.filter((t) => t.kind !== "recipient_dm") })}
              >
                {s === "activity" ? "활동 기록" : "알림"}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : (
          <span className="bg-bg-soft text-text-dim rounded-full px-2.5 py-0.5 text-sm">{isNotif ? "알림" : "활동 기록"}</span>
        )}
      </header>

      <div className="space-y-3 px-4 py-3">
        <Row label="무엇을">
          <ChipField
            items={rule.typeKeys.map((k) => ({ key: k, label: labelOf.get(k) ?? k }))}
            onRemove={(k) => patch({ typeKeys: rule.typeKeys.filter((x) => x !== k) })}
            empty="아직 고르지 않음"
            addLabel={isNotif ? "알림 고르기" : "활동 고르기"}
            picker={{
              title: isNotif ? "보낼 알림" : "보낼 활동 기록",
              description: isNotif
                ? "에이와 알림 벨에 뜨는 것과 같은 알림입니다."
                : "에이와에서 누가 무엇을 했는지(감사로그). 급여·이력서·근로계약·비밀번호는 보낼 수 없고, 돈 관련은 누가·무엇을만 보냅니다.",
              groups,
              options,
              picked: rule.typeKeys,
              onApply: (keys) => patch({ typeKeys: keys }),
            }}
          />
        </Row>
        <Row label="어디로">
          <TargetPicker targets={rule.targets} onChange={(t) => patch({ targets: t })} channels={channels} staff={staff} allowRecipient={isNotif} />
        </Row>
        <RuleOptions rule={rule} patch={patch} staff={staff} />
        <MessagePreview rule={rule} activityOptions={activityOptions} />
      </div>

      <footer className="border-line flex flex-wrap items-center gap-2 border-t px-4 py-3">
        {dirty ? <span className="text-amber text-sm font-medium">저장 안 된 변경</span> : null}
        {msg ? <span className="text-primary text-sm">{msg}</span> : null}
        {err ? <span className="text-danger text-sm">{err}</span> : null}
        <Button variant="ghost" className="ml-auto" onClick={remove} disabled={pending}>
          삭제
        </Button>
        <Button
          variant="outline"
          onClick={() => (dirty ? setErr("바꾼 내용을 먼저 저장해 주세요 — 샘플은 저장된 규칙으로 보냅니다") : run(() => sendSlackRuleSample(rule.id)))}
          disabled={pending || !rule.id}
          title="고른 것 앞 3개를 실제 모양 + 가상 데이터로(1:1 대상은 나에게만)"
        >
          샘플 보내기
        </Button>
        <Button onClick={save} disabled={pending || (!dirty && !!rule.id)}>
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}
          저장
        </Button>
      </footer>
    </section>
  );
}
