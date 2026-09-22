"use client";

import { useEffect, useState } from "react";
import { Check } from "@/components/icons/aywa-icon-compat";
import {
  CHANGE_OPTIONS,
  ENGLISH_STATE_OPTIONS,
  GOAL_OPTIONS,
  HABIT_ITEMS,
  HABIT_SCALE_MAX,
  LEVEL_BASIS_OPTIONS,
  MATH_STATE_OPTIONS,
  MAX_CHANGES,
  MAX_GOALS,
  MAX_SUBJECT_STATES,
  MAX_WANTS,
  MAX_WORRIES,
  ADVANCED_REASON_OPTIONS,
  PRIOR_REASON_OPTIONS,
  PRIOR_STATUS_OPTIONS,
  WANT_OPTIONS,
  WORRY_OPTIONS,
  wantsSubject,
  type ChoiceOption,
} from "@/features/enrollment/intake-checklist";
import { AutoTextarea, Field, QuestionSection, inputCls } from "./intake-ui";

/**
 * 사전 체크리스트(2단계) — 문항 카탈로그는 features/enrollment/intake-checklist.ts 단일 소스.
 * 선택값은 state로 들고 hidden input으로 제출(서버가 parseIntakeChecklist로 재검증 — 여기 가드는 편의일 뿐).
 * 5(수학)·6(영어)번은 1단계에서 고른 과목에 해당할 때만 노출(관계없는 과목 문항 강요 금지).
 */
export function ChecklistStep({
  selectedSubjects,
  onGoalsCountChange,
  textDefaults,
}: {
  selectedSubjects: { key: string; label: string }[];
  onGoalsCountChange: (n: number) => void;
  /** 로컬 초안 복구 시 자유입력 텍스트 초기값(name → 값) — 이 스텝은 늦게 마운트라 defaultValue로 주입. */
  textDefaults?: Record<string, string>;
}) {
  const dv = (name: string) => textDefaults?.[name];
  const [goals, setGoals] = useState<string[]>([]);
  const [worries, setWorries] = useState<string[]>([]);
  const [levelBasis, setLevelBasis] = useState<string[]>([]);
  const [mathStates, setMathStates] = useState<string[]>([]);
  const [englishStates, setEnglishStates] = useState<string[]>([]);
  const [habits, setHabits] = useState<Record<string, number>>({});
  const [priorStatus, setPriorStatus] = useState("");
  const [priorReason, setPriorReason] = useState("");
  const [advancedStatus, setAdvancedStatus] = useState("");
  const [advancedReason, setAdvancedReason] = useState("");
  const [changes, setChanges] = useState<string[]>([]);
  const [wants, setWants] = useState<string[]>([]);

  // 부모(제출 버튼 게이트)에 goals 개수만 알린다. 렌더 중이 아니라 커밋 후 동기화 = 같은 값이면 부모가 bail-out.
  useEffect(() => {
    onGoalsCountChange(goals.length);
  }, [goals, onGoalsCountChange]);

  const showMath = wantsSubject(selectedSubjects, "math");
  const showEnglish = wantsSubject(selectedSubjects, "english");
  // 과목 판정이 둘 다 실패(예: 예체능만 선택)하면 어느 쪽도 강요하지 않되 문항 자체는 볼 수 있게 둘 다 노출.
  const showBoth = !showMath && !showEnglish;

  // 문항 번호 — **보이는 문항 기준 순차**. 과목 문항(수학·영어)이 선택 과목에 따라 숨으므로 고정 번호를 쓰면
  // "2·3·4·6·7"처럼 빠진 번호가 생겨 학부모가 "5번은 어디 갔지?" 한다. JSX가 소스 순서로 평가되는 걸 이용해
  // 렌더된 섹션만 카운트(렌더마다 0에서 다시 시작 = 결정적).
  let seq = 0;
  const no = () => `${++seq}. `;

  return (
    <>
      <input type="hidden" name="checklistFilled" value="1" />
      {hidden("goals", goals)}
      {hidden("worries", worries)}
      {hidden("levelBasis", levelBasis)}
      {hidden("mathStates", mathStates)}
      {hidden("englishStates", englishStates)}
      {hidden("changes", changes)}
      {hidden("wants", wants)}
      {Object.entries(habits).map(([k, v]) => (
        <input key={k} type="hidden" name={`habit_${k}`} value={v} />
      ))}
      <input type="hidden" name="priorStatus" value={priorStatus} />
      {/* '하지 않음'으로 바꾸면 앞서 고른 이유는 제출하지 않는다(화면에서 사라진 답이 저장되면 유령 데이터). */}
      {priorStatus !== "none" ? <input type="hidden" name="priorReason" value={priorReason} /> : null}
      <input type="hidden" name="advancedStatus" value={advancedStatus} />
      {advancedStatus !== "none" ? (
        <input type="hidden" name="advancedReason" value={advancedReason} />
      ) : null}

      <QuestionSection title={`${no()}학습 상담을 통해 가장 알고 싶은 문제`} tone="primary" hint={`최대 ${MAX_GOALS}개 · 필수`}>
        <Chips options={GOAL_OPTIONS} value={goals} max={MAX_GOALS} onToggle={toggler(setGoals, MAX_GOALS)} />
        <EtcInput name="goalsEtc" defaultValue={dv("goalsEtc")} />
      </QuestionSection>

      <QuestionSection title={`${no()}현재 가장 걱정되는 것`} tone="amber" hint={`최대 ${MAX_WORRIES}개`}>
        <Chips options={WORRY_OPTIONS} value={worries} max={MAX_WORRIES} onToggle={toggler(setWorries, MAX_WORRIES)} />
        <EtcInput name="worriesEtc" defaultValue={dv("worriesEtc")} />
        <Field label="지금 계획을 그대로 유지하면 가장 걱정되는 결과">
          <AutoTextarea name="worryOutcome" minRows={3} placeholder="자유롭게 적어주세요 (선택)" defaultValue={dv("worryOutcome")} />
        </Field>
      </QuestionSection>

      <QuestionSection title={`${no()}현재 학생의 학업 수준을 무엇으로 판단하시나요`} tone="gold" hint="복수 선택">
        <Chips options={LEVEL_BASIS_OPTIONS} value={levelBasis} max={LEVEL_BASIS_OPTIONS.length} onToggle={toggler(setLevelBasis, LEVEL_BASIS_OPTIONS.length)} />
        <EtcInput name="levelBasisEtc" defaultValue={dv("levelBasisEtc")} />
      </QuestionSection>

      {showMath || showBoth ? (
        <QuestionSection title={`${no()}수학 현재 상태`} tone="primary" hint={`최대 ${MAX_SUBJECT_STATES}개`}>
          <Chips options={MATH_STATE_OPTIONS} value={mathStates} max={MAX_SUBJECT_STATES} onToggle={toggler(setMathStates, MAX_SUBJECT_STATES)} />
          <Field label="현재 수학 학습 과정 또는 교재">
            <input name="mathCourse" placeholder="예: 쎈 중2-1, 개념원리" defaultValue={dv("mathCourse")} className={inputCls} />
          </Field>
        </QuestionSection>
      ) : null}

      {showEnglish || showBoth ? (
        <QuestionSection title={`${no()}영어 현재 상태`} tone="primary" hint={`최대 ${MAX_SUBJECT_STATES}개`}>
          <Chips options={ENGLISH_STATE_OPTIONS} value={englishStates} max={MAX_SUBJECT_STATES} onToggle={toggler(setEnglishStates, MAX_SUBJECT_STATES)} />
          <Field label="현재 영어 학습 과정 또는 교재">
            <input name="englishCourse" placeholder="예: 리딩튜터, 그래머인유즈" defaultValue={dv("englishCourse")} className={inputCls} />
          </Field>
        </QuestionSection>
      ) : null}

      <QuestionSection title={`${no()}평소 학습 행동`} tone="gold" hint="1 도움 필요 ~ 5 스스로">
        <div className="space-y-3">
          {HABIT_ITEMS.map((item) => (
            <Scale
              key={item.value}
              label={item.label}
              value={habits[item.value] ?? 0}
              onChange={(n) => setHabits((p) => ({ ...p, [item.value]: n }))}
            />
          ))}
        </div>
      </QuestionSection>

      {/* 선행·심화 — 같은 구조(여부 → 이유). '하지 않음'이면 이유 선택지("왜 하는지")는 의미가 없어
          숨기고, 대신 "왜 안 하는지" 자유입력을 띄운다(원장 지시 2026-07-15). */}
      <QuestionSection title={`${no()}선행학습`} tone="amber">
        <Field label="현재 선행학습 여부">
          <Radio options={PRIOR_STATUS_OPTIONS} value={priorStatus} onChange={setPriorStatus} />
        </Field>
        {priorStatus === "none" ? (
          <Field label="선행학습을 하지 않는 이유">
            <AutoTextarea name="priorNoneReason" minRows={2} placeholder="예: 현재 과정을 다지는 게 먼저라고 생각해서 (선택)" defaultValue={dv("priorNoneReason")} />
          </Field>
        ) : (
          <Field label="선행학습을 고려하거나 진행하는 가장 큰 이유">
            <Radio options={PRIOR_REASON_OPTIONS} value={priorReason} onChange={setPriorReason} />
          </Field>
        )}
      </QuestionSection>

      <QuestionSection title={`${no()}심화학습`} tone="amber">
        <Field label="현재 심화학습 여부">
          <Radio options={PRIOR_STATUS_OPTIONS} value={advancedStatus} onChange={setAdvancedStatus} />
        </Field>
        {advancedStatus === "none" ? (
          <Field label="심화학습을 하지 않는 이유">
            <AutoTextarea name="advancedNoneReason" minRows={2} placeholder="예: 아직 기본 개념부터 잡는 중이라 (선택)" defaultValue={dv("advancedNoneReason")} />
          </Field>
        ) : (
          <Field label="심화학습을 고려하거나 진행하는 가장 큰 이유">
            <Radio options={ADVANCED_REASON_OPTIONS} value={advancedReason} onChange={setAdvancedReason} />
          </Field>
        )}
      </QuestionSection>

      <QuestionSection title={`${no()}앞으로 6개월, 가장 원하는 변화`} tone="primary" hint={`최대 ${MAX_CHANGES}개`}>
        <Chips options={CHANGE_OPTIONS} value={changes} max={MAX_CHANGES} onToggle={toggler(setChanges, MAX_CHANGES)} />
        <EtcInput name="changesEtc" defaultValue={dv("changesEtc")} />
      </QuestionSection>

      <QuestionSection title={`${no()}학원에서 확인·제공받고 싶은 것`} tone="ink" hint={`최대 ${MAX_WANTS}개`}>
        <Chips options={WANT_OPTIONS} value={wants} max={MAX_WANTS} onToggle={toggler(setWants, MAX_WANTS)} />
        <EtcInput name="wantsEtc" defaultValue={dv("wantsEtc")} />
        <Field label="상담자가 꼭 알아야 할 자녀의 강점이나 최근의 성공 경험">
          <AutoTextarea name="strengths" minRows={3} placeholder="자유롭게 적어주세요 (선택)" defaultValue={dv("strengths")} />
        </Field>
        <Field label="추가로 전달하고 싶은 내용">
          <AutoTextarea name="extra" minRows={3} placeholder="자유롭게 적어주세요 (선택)" defaultValue={dv("extra")} />
        </Field>
      </QuestionSection>
    </>
  );
}

/** 선택값 → 같은 name의 hidden 다중 제출(서버는 getAll로 받음). */
function hidden(name: string, values: string[]) {
  return values.map((v) => <input key={v} type="hidden" name={name} value={v} />);
}

/**
 * 토글 핸들러 — **반드시 함수형 업데이트**(prev 기반). 클로저에 잡힌 배열로 계산하면 같은 프레임에 두 번
 * 눌렸을 때(빠른 연타·합성 이벤트) 뒤 클릭이 앞 선택을 덮어써 조용히 유실된다(2026-07-15 실측으로 발견).
 * max 초과는 여기서도 무시 — 버튼 disabled는 시각 안내일 뿐 상태의 진실은 이 함수다.
 */
function toggler(set: (fn: (prev: string[]) => string[]) => void, max: number) {
  return (v: string) =>
    set((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : prev.length >= max ? prev : [...prev, v],
    );
}

/** 다중 선택 칩 — max 도달 시 미선택 항목을 비활성(초과 선택 자체를 막아 "왜 안 눌리지" 대신 안내를 준다). */
function Chips({
  options,
  value,
  max,
  onToggle,
}: {
  options: ChoiceOption[];
  value: string[];
  max: number;
  onToggle: (v: string) => void;
}) {
  const full = value.length >= max;
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const on = value.includes(o.value);
        const disabled = !on && full;
        return (
          <button
            key={o.value}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(o.value)}
            className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              on
                ? "border-primary bg-primary-soft text-foreground font-bold"
                : disabled
                  ? "border-border bg-bg-soft text-text-faint"
                  : "border-border bg-card text-foreground"
            }`}
          >
            <span
              className={`flex size-4 shrink-0 items-center justify-center rounded-[3px] border ${
                on ? "border-primary bg-primary text-white" : "border-border"
              }`}
            >
              {on ? <Check className="size-3" /> : null}
            </span>
            <span className="break-keep">{o.label}</span>
          </button>
        );
      })}
      {full ? <p className="text-text-faint text-xs">최대 {max}개까지 선택할 수 있어요. 바꾸려면 하나를 해제하세요.</p> : null}
    </div>
  );
}

/** 단일 선택 */
function Radio({
  options,
  value,
  onChange,
}: {
  options: ChoiceOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  // 다중선택 칩과 같은 1행 목록 배열(훑기 쉬움) — 단, 표시는 **동그라미**로 "하나만 고른다"를 알린다.
  // (가로 wrap 칩은 항목 길이에 따라 줄이 들쭉날쭉해 읽기 어려웠음 — 원장 지적 2026-07-15.)
  return (
    <div className="flex flex-col gap-2">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? "" : o.value)}
            className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              on
                ? "border-amber bg-amber-soft text-foreground font-bold"
                : "border-border bg-card text-foreground"
            }`}
          >
            <span
              className={`flex size-4 shrink-0 items-center justify-center rounded-full border ${
                on ? "border-amber" : "border-border"
              }`}
            >
              {on ? <span className="bg-amber size-2 rounded-full" /> : null}
            </span>
            <span className="break-keep">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** 1~5 점수 — 모바일 탭 타깃 확보(원형 44px 미만 금지). */
function Scale({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <p className="text-foreground mb-1.5 text-sm break-keep">{label}</p>
      <div className="flex gap-1.5">
        {Array.from({ length: HABIT_SCALE_MAX }, (_, i) => i + 1).map((n) => {
          const on = value === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => onChange(n)}
              aria-label={`${label} ${n}점`}
              className={`num h-11 flex-1 rounded-md border text-sm font-bold transition-colors ${
                on ? "border-gold bg-gold text-foreground" : "border-border bg-card text-text-dim"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EtcInput({ name, defaultValue }: { name: string; defaultValue?: string }) {
  return <input name={name} defaultValue={defaultValue} placeholder="기타 (직접 입력)" className={inputCls} />;
}
