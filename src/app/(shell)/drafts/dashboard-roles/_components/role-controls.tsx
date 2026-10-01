"use client";

import { Toolbar, ToolbarSegment, ToolbarSegmentItem } from "@/components/toolbar";
import {
  LAYOUT_IDS,
  ROLE_IDS,
  ROLE_LABELS,
  ROLE_RULES,
  TOGGLES,
  type LayoutId,
  type RoleId,
  type Toggles,
} from "../_lib/roles";

const LAYOUT_LABELS: Record<LayoutId, string> = { a: "A 기본", b: "B 일 중심", c: "C 압축(한 화면)" };

export function RoleControls({
  role,
  layout,
  subject,
  subjects,
  toggles,
  onRole,
  onLayout,
  onSubject,
  onToggles,
}: {
  role: RoleId;
  layout: LayoutId;
  subject: string;
  subjects: readonly { value: string; label: string }[];
  toggles: Toggles;
  onRole: (r: RoleId) => void;
  onLayout: (l: LayoutId) => void;
  onSubject: (s: string) => void;
  onToggles: (t: Toggles) => void;
}) {
  return (
    <div className="bg-card shadow-card flex flex-col gap-3 rounded-2xl px-4 py-3">
      <Toolbar>
        <ToolbarSegment label="역할">
          {ROLE_IDS.map((r) => (
            <ToolbarSegmentItem key={r} active={role === r} onClick={() => onRole(r)}>
              {ROLE_LABELS[r]}
            </ToolbarSegmentItem>
          ))}
        </ToolbarSegment>
        {role !== "owner" ? (
          <ToolbarSegment label="안">
            {LAYOUT_IDS.map((l) => (
              <ToolbarSegmentItem key={l} active={layout === l} onClick={() => onLayout(l)}>
                {LAYOUT_LABELS[l]}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
        {role === "subject" && subjects.length > 0 ? (
          <ToolbarSegment label="담당 과목" wrap>
            {subjects.map((o) => (
              <ToolbarSegmentItem key={o.value} active={subject === o.value} onClick={() => onSubject(o.value)}>
                {o.label}
              </ToolbarSegmentItem>
            ))}
          </ToolbarSegment>
        ) : null}
      </Toolbar>
      <p className="text-sm">{ROLE_RULES[role]}</p>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="micro mb-1">원장이 정할 6가지 — 켜면 허용 · 기본은 전부 가림 · 시안에선 저장 안 됨 — 실제 적용 시 학원 설정에서 켜고 끕니다</legend>
        <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2 xl:grid-cols-3">
          {TOGGLES.map((t) => {
            const mine = t.role === "all" || t.role === role || (t.role === "manager" && role === "desk");
            return (
              <label key={t.n} className={`flex cursor-pointer items-start gap-2 text-sm ${mine ? "font-semibold" : ""}`}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={toggles[t.key]}
                  onChange={(e) => onToggles({ ...toggles, [t.key]: e.target.checked })}
                />
                <span>
                  {t.n}. {t.label}
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
