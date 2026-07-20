/**
 * 사전 체크리스트 표시(등록상담 상세) — 학부모가 QR 접수 2단계에서 답한 내용을 상담사가 읽는 화면.
 * 저장은 slug라 **반드시 카탈로그 라벨로 변환**해 보여준다(화면에 raw 키 노출 금지 규칙).
 * 응답이 없는 문항은 줄 자체를 그리지 않는다 — 빈 라벨만 늘어놓으면 읽을 게 뭔지 안 보인다.
 */
import {
  ADVANCED_REASON_OPTIONS,
  CHANGE_OPTIONS,
  ENGLISH_STATE_OPTIONS,
  GOAL_OPTIONS,
  HABIT_ITEMS,
  HABIT_SCALE_MAX,
  LEVEL_BASIS_OPTIONS,
  MATH_STATE_OPTIONS,
  PRIOR_REASON_OPTIONS,
  PRIOR_STATUS_OPTIONS,
  WANT_OPTIONS,
  WORRY_OPTIONS,
  labelOf,
  type ChoiceOption,
  type IntakeChecklist,
} from "@/features/enrollment/intake-checklist";

/** 선택 목록 + 기타 자유입력을 한 줄로. 둘 다 비면 null(줄 생략). */
function joinLabels(options: ChoiceOption[], values: string[], etc: string | null): string | null {
  const parts = values.map((v) => labelOf(options, v));
  if (etc) parts.push(etc);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function ChecklistView({ checklist }: { checklist: IntakeChecklist }) {
  const c = checklist;
  const rows: [string, string | null][] = [
    ["가장 알고 싶은 문제", joinLabels(GOAL_OPTIONS, c.goals, c.goalsEtc)],
    ["가장 걱정되는 것", joinLabels(WORRY_OPTIONS, c.worries, c.worriesEtc)],
    ["유지 시 걱정되는 결과", c.worryOutcome],
    ["수준 판단 근거", joinLabels(LEVEL_BASIS_OPTIONS, c.levelBasis, c.levelBasisEtc)],
    ["수학 현재 상태", c.math ? joinLabels(MATH_STATE_OPTIONS, c.math.states, null) : null],
    ["수학 교재·과정", c.math?.course ?? null],
    ["영어 현재 상태", c.english ? joinLabels(ENGLISH_STATE_OPTIONS, c.english.states, null) : null],
    ["영어 교재·과정", c.english?.course ?? null],
    ["선행학습 여부", c.priorStatus ? labelOf(PRIOR_STATUS_OPTIONS, c.priorStatus) : null],
    ["선행 이유", c.priorReason ? labelOf(PRIOR_REASON_OPTIONS, c.priorReason) : null],
    ["선행 안 하는 이유", c.priorNoneReason],
    ["심화학습 여부", c.advancedStatus ? labelOf(PRIOR_STATUS_OPTIONS, c.advancedStatus) : null],
    ["심화 이유", c.advancedReason ? labelOf(ADVANCED_REASON_OPTIONS, c.advancedReason) : null],
    ["심화 안 하는 이유", c.advancedNoneReason],
    ["6개월 내 원하는 변화", joinLabels(CHANGE_OPTIONS, c.changes, c.changesEtc)],
    ["학원에 바라는 것", joinLabels(WANT_OPTIONS, c.wants, c.wantsEtc)],
    ["학생의 강점·성공 경험", c.strengths],
    ["추가 전달 사항", c.extra],
  ];
  const visible = rows.filter(([, v]) => !!v);
  const habitItems = HABIT_ITEMS.filter((h) => c.habits[h.value] !== undefined);

  return (
    <div className="space-y-3">
      <dl className="divide-border divide-y">
        {visible.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2">
            <dt className="text-text-dim text-xs">{k}</dt>
            <dd className="text-foreground text-[13px] leading-relaxed break-keep">{v}</dd>
          </div>
        ))}
      </dl>

      {/* 학습 행동 5점 — 숫자만 나열하면 의미를 잃어 막대로. 낮을수록 도움 필요. */}
      {habitItems.length > 0 ? (
        <div className="border-border border-t pt-3">
          <p className="text-text-dim mb-2 text-xs">
            학습 행동 <span className="text-text-faint">(1 도움 필요 ~ {HABIT_SCALE_MAX} 스스로)</span>
          </p>
          <div className="space-y-1.5">
            {habitItems.map((h) => {
              const score = c.habits[h.value]!;
              return (
                <div key={h.value} className="flex items-center gap-2">
                  <span className="text-foreground w-40 shrink-0 text-xs break-keep">{h.label}</span>
                  <div className="flex gap-0.5" aria-label={`${score}점`}>
                    {Array.from({ length: HABIT_SCALE_MAX }, (_, i) => (
                      <span
                        key={i}
                        className={`h-2 w-4 rounded-xs ${i < score ? "bg-primary" : "bg-bg-soft"}`}
                      />
                    ))}
                  </div>
                  <span className="num text-text-dim text-xs">{score}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {visible.length === 0 && habitItems.length === 0 ? (
        <p className="text-text-faint text-sm">작성된 사전 체크리스트 내용이 없습니다.</p>
      ) : null}
    </div>
  );
}
