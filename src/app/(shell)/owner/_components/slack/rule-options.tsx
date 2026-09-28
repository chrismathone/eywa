"use client";

import type { SlackRule } from "@/features/slack/rules";
import { CheckDropdowns, SLACK_BTN, SLACK_BTN_ON } from "./check-dropdowns";

/**
 * 규칙의 형식·시점 줄 — 짧게/자세히 · 받는 사람 @멘션(알림) · 채널 호출(@here/@channel) · 즉시/요약만 · 방해금지 지키기 · 제외할 사람.
 * ⚠️ @here·@channel은 채널 사람 전원에게 알림이 울린다 — 기본은 꺼짐, 켜면 경고 문구.
 */
type Patch = (p: Partial<SlackRule>) => void;

function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="inline-flex items-center gap-1" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={value === v ? SLACK_BTN_ON : SLACK_BTN}>
          {value === v ? "✓ " : ""}
          {text}
        </button>
      ))}
    </span>
  );
}

function Toggle({ on, onChange, children, title }: { on: boolean; onChange: (v: boolean) => void; children: string; title?: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)} className={on ? SLACK_BTN_ON : SLACK_BTN} title={title}>
      {on ? "✓ " : ""}
      {children}
    </button>
  );
}

export function RuleOptions({ rule, patch, staff }: { rule: SlackRule; patch: Patch; staff: { id: string; name: string }[] }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-dim w-16 shrink-0 text-xs">형식</span>
        <Seg label="메시지 길이" value={rule.template} options={[["short", "짧게"], ["detailed", "자세히"]]} onChange={(v) => patch({ template: v })} />
        {rule.source === "notification" ? (
          <Toggle on={rule.mentionRecipients} onChange={(v) => patch({ mentionRecipients: v })} title="채널 메시지에서 받는 사람을 @이름으로 불러 슬랙 알림이 울리게(슬랙 계정이 연결된 사람만)">
            받는 사람 @멘션
          </Toggle>
        ) : null}
        <Seg label="채널 호출" value={rule.ping} options={[["none", "호출 없음"], ["here", "@here"], ["channel", "@channel"]]} onChange={(v) => patch({ ping: v })} />
        {rule.ping !== "none" ? <span className="text-danger text-xs">채널 사람 전원에게 알림이 울립니다</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-dim w-16 shrink-0 text-xs">언제</span>
        <Seg label="보내는 때" value={rule.timing} options={[["immediate", "바로"], ["digest", "요약으로만"]]} onChange={(v) => patch({ timing: v })} />
        {rule.timing === "digest" ? (
          <label className="text-text-dim inline-flex items-center gap-1 text-xs">
            요약 시각
            <input
              type="time"
              value={rule.digestAt ?? ""}
              onChange={(e) => patch({ digestAt: e.target.value || null })}
              className="border-line rounded-md border bg-transparent px-2 py-1 text-xs"
            />
            <span>(비우면 기본 시각)</span>
          </label>
        ) : (
          <Toggle on={rule.honorDnd} onChange={(v) => patch({ honorDnd: v })} title="끄면 방해금지 시간에도 바로 보냅니다(긴급 알림용)">
            방해금지 지키기
          </Toggle>
        )}
        <CheckDropdowns
          groups={[{ id: "x", label: "이 사람이 한 일은 빼기" }]}
          options={staff.map((s) => ({ key: s.id, label: s.name, group: "x" }))}
          picked={rule.excludeActorIds}
          onChange={(ids) => patch({ excludeActorIds: ids })}
          ariaPrefix="제외"
        />
      </div>
    </>
  );
}
