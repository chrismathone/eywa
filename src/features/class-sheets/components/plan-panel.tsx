"use client";

// 좌측 계획 패널 — 담임/부담임 × 월간/주간 목표(6영역 × [교재명, 목표 진도]) + 패널 메모.
// 시트 원본의 "담임 월간계획/주간계획·부담임 월간계획/주간계획" 4구획을 아코디언으로 이식. LWW 자동저장.
import { EyIcon } from "@/components/icons/eywa-icons";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { skillAreaColorOf } from "@/features/owner/skill-areas";
import { SUBJECT_SOFT } from "@/features/owner/subjects";
import type { SheetGoalDTO } from "../server/queries";

const inputCls =
  "border-line-strong text-foreground w-full rounded-lg border bg-transparent px-2 py-1 text-[13px] outline-none focus:border-primary";

const SECTIONS: { role: "homeroom" | "assistant"; scope: "month" | "week"; title: string }[] = [
  { role: "homeroom", scope: "month", title: "담임 월간계획" },
  { role: "homeroom", scope: "week", title: "담임 주간계획" },
  { role: "assistant", scope: "month", title: "부담임 월간계획" },
  { role: "assistant", scope: "week", title: "부담임 주간계획" },
];

export function PlanPanel({
  goals,
  skillAreas,
  canEdit,
  monthStart,
  weekMonday,
  memo,
  onGoalField,
  onMemo,
}: {
  goals: SheetGoalDTO[];
  skillAreas: SkillAreaSetting[];
  canEdit: boolean;
  monthStart: string;
  weekMonday: string;
  memo: string;
  onGoalField: (
    scope: "month" | "week",
    role: "homeroom" | "assistant",
    skillArea: string,
    field: "textbook" | "targetProgress",
    value: string,
  ) => void;
  onMemo: (body: string) => void;
}) {
  const goalOf = (scope: string, role: string, area: string) =>
    goals.find(
      (g) =>
        g.scope === scope &&
        g.role === role &&
        g.skillArea === area &&
        g.periodStart === (scope === "month" ? monthStart : weekMonday),
    );

  return (
    <aside className="bg-card shadow-card w-[300px] shrink-0 self-start overflow-y-auto rounded-2xl p-3">
      <div className="space-y-1">
        {SECTIONS.map((sec, i) => (
          <details key={`${sec.role}-${sec.scope}`} className="group" open={i === 0}>
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded px-1 py-1.5 select-none [&::-webkit-details-marker]:hidden">
              <EyIcon
                name="chevronRight"
                size={11}
                className="text-text-faint transition-transform group-open:rotate-90"
              />
              <span className="text-foreground text-[14px] font-bold">{sec.title}</span>
              <span className="text-text-dim num ml-auto text-[11px]">
                {sec.scope === "month" ? monthStart.slice(0, 7) : "이번 주"}
              </span>
            </summary>
            <div className="space-y-1.5 px-1 pt-1 pb-3">
              {/* 열 머리글 — 시트의 '교재명 / 목표 진도' 머리줄. faint 10px는 안 읽혀 dim 11px 굵게로. */}
              <div className="text-text-dim bg-bg-soft grid grid-cols-[74px_1fr_1fr] gap-1 rounded-md px-1 py-0.5 text-[11px] font-semibold">
                <span />
                <span>교재명</span>
                <span>목표 진도</span>
              </div>
              {skillAreas.map((area) => {
                const g = goalOf(sec.scope, sec.role, area.key);
                return (
                  <div key={area.key} className="grid grid-cols-[74px_1fr_1fr] items-center gap-1">
                    {/* 영역 = 고유색 알약 + 굵게(원장 지시 2026-07-31 "아 보카네! 같은 느낌").
                        색은 학원설정 단일 소스(skillAreaColorOf) — 여기서 이름별 색을 박지 말 것. */}
                    <span
                      className={`truncate rounded-full px-1.5 py-0.5 text-center text-[12px] font-bold ${
                        SUBJECT_SOFT[skillAreaColorOf(skillAreas, area.key)]
                      }`}
                      title={area.label}
                    >
                      {area.label}
                    </span>
                    <input
                      className={inputCls}
                      defaultValue={g?.textbook ?? ""}
                      readOnly={!canEdit}
                      aria-label={`${sec.title} ${area.label} 교재명`}
                      onChange={(e) => onGoalField(sec.scope, sec.role, area.key, "textbook", e.target.value)}
                    />
                    <input
                      className={inputCls}
                      defaultValue={g?.targetProgress ?? ""}
                      readOnly={!canEdit}
                      aria-label={`${sec.title} ${area.label} 목표 진도`}
                      onChange={(e) =>
                        onGoalField(sec.scope, sec.role, area.key, "targetProgress", e.target.value)
                      }
                    />
                  </div>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <div className="border-line mt-2 border-t pt-2">
        <span className="micro">메모</span>
        <textarea
          className={`${inputCls} mt-1 min-h-[64px] resize-y`}
          defaultValue={memo}
          readOnly={!canEdit}
          aria-label="주간 메모"
          onChange={(e) => onMemo(e.target.value)}
        />
      </div>
    </aside>
  );
}
