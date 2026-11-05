"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FormActionBar } from "@/components/forms/form-action-bar";
import { Button } from "@/components/ui/button";
import { useUnsavedGuard } from "@/components/workspace/use-unsaved-guard";
import { METRIC_META } from "@/features/teacher-portfolio/evaluation/catalog";
import {
  DEFAULT_EVALUATION_CONFIG, PORTFOLIO_V1_CONFIG, isManualId, manualId, type BuiltinMetricId, type EvaluationConfig, type ManualMetricSetting, type MetricSetting,
} from "@/features/teacher-portfolio/evaluation/config";
import { settingOf } from "@/features/teacher-portfolio/evaluation/preview";
import { saveEvaluationSettings } from "@/features/teacher-portfolio/server/evaluation-actions";
import { SettingsCard } from "../settings-card";
import { MetricSettingCard } from "./metric-setting-card";
import { PresetBar, type PresetOption } from "./preset-bar";
import { EvaluationStaffContext } from "./punctuality-options";
import { PreviewCard, type PreviewData } from "./preview-card";
import { WriteLockProvider } from "../write-lock-context";
import { writeLockedNote } from "@/lib/write-lock";

/** 기본 제공 구성 — 원장 구성(기본값)과 그 전 직원 포트폴리오(같은 점수). 지울 수 없다. */
const BUILTIN_PRESETS: PresetOption[] = [
  { id: "builtin:default", name: "원장 기본 구성(8개 · 100점)", config: DEFAULT_EVALUATION_CONFIG, builtin: true },
  { id: "builtin:v1", name: "옛 직원 포트폴리오 구성(8개 · 100점)", config: PORTFOLIO_V1_CONFIG, builtin: true },
];

/** 새 직접 입력 지표의 키 — 소문자·숫자 8자. 한 번 정하면 바꾸지 않는다(입력값이 이 키에 붙는다). */
function newKey(taken: ReadonlySet<string>): string {
  for (;;) {
    const key = `m${Math.random().toString(36).slice(2, 9)}`;
    if (!taken.has(key)) return key;
  }
}

/**
 * 강사평가 설정 편집기 — 원장 2026-10-13 *"'이것까지 커스터마이징 가능해?' 할 정도로"*.
 * 지표마다 켜고 끄기 · 이름 · 만점 · 차례 · 점수 규칙(비례·구간표·건당) · 자료가 없을 때, 그리고 직접 만드는 지표.
 * 저장하면 진행 중인 달만 다시 매긴다 — 마감한 달은 그때의 설정으로 굳어 있다.
 */
export function EvaluationEditor({ initial, tableMissing, readOnly = false, preview, presets = [], presetsMissing = false }: {
  initial: EvaluationConfig; tableMissing: boolean; readOnly?: boolean; preview: PreviewData;
  /** 원장이 이름 붙여 저장한 구성(0360a) — 표가 없으면 빈 목록 + presetsMissing. */
  presets?: PresetOption[]; presetsMissing?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initial);
  const [config, setConfig] = useState(initial);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const { markSaved } = useUnsavedGuard({ formRef });
  // 버튼으로 바꾼 값은 입력 이벤트가 없다 — 미저장 가드가 알아채도록 대신 알린다.
  useEffect(() => { formRef.current?.dispatchEvent(new Event("input", { bubbles: true })); }, [config]);

  const update = (id: string, next: MetricSetting | ManualMetricSetting) => setConfig((c) => (isManualId(id)
    ? { ...c, manual: c.manual.map((m) => (manualId(m.key) === id ? (next as ManualMetricSetting) : m)) }
    : { ...c, metrics: { ...c.metrics, [id]: next } }));
  const move = (id: string, dir: -1 | 1) => setConfig((c) => {
    const order = [...c.order];
    const at = order.indexOf(id);
    const to = at + dir;
    if (at < 0 || to < 0 || to >= order.length) return c;
    [order[at], order[to]] = [order[to], order[at]];
    return { ...c, order };
  });
  const addManual = () => setConfig((c) => {
    const key = newKey(new Set(c.manual.map((m) => m.key)));
    const label = `직접 입력 ${c.manual.length + 1}`;
    const metric: ManualMetricSetting = { key, label, unit: "건", description: "", enabled: true, max: 10, scoring: { mode: "perUnit", points: 5, cap: true }, missing: "zero" };
    return { ...c, manual: [...c.manual, metric], order: [...c.order, manualId(key)] };
  });
  const remove = (id: string) => setConfig((c) => ({ ...c, manual: c.manual.filter((m) => manualId(m.key) !== id), order: c.order.filter((x) => x !== id) }));
  const save = () => startTransition(async () => {
    const result = await saveEvaluationSettings(config);
    if (!result.ok) { toast.error(result.error ?? "저장하지 못했습니다"); return; }
    setSaved(config);
    markSaved();
    toast.success(result.notice ?? "저장했습니다");
    router.refresh();
  });

  const on = config.order.map((id) => settingOf(config, id)).filter((s): s is MetricSetting => Boolean(s?.enabled));
  const staff = useMemo(() => preview.rows.map((r) => ({ id: r.teacherId, name: r.name })), [preview.rows]);
  const maxTotal = on.reduce((n, s) => n + s.max, 0);
  return (
    <form ref={formRef} onSubmit={(e) => { e.preventDefault(); save(); }} className="min-w-0 space-y-4">
      <input type="hidden" name="evaluation" value={JSON.stringify(config)} readOnly />
      {tableMissing ? (
        <p role="status" className="bg-amber-soft rounded-lg px-3.5 py-2.5 text-sm">강사평가 설정 표가 아직 준비되지 않았습니다. 지금은 기본 설정으로 계산하고, 저장은 준비가 끝난 뒤에 됩니다.</p>
      ) : null}
      {/* 🔴 읽기 권한(readOnly — 저장 문 evaluationWriteGate와 같은 판정, evaluation-face.tsx)이면 구성 저장·불러오기, 지표 추가·삭제·
          순서 이동, 구간·시각 추가·삭제, 하단 저장 바를 **그리지 않는다**(원장 2026-11-05). 칸은 fieldset이 잠근다. */}
      {readOnly ? <p role="status" className="bg-bg-soft rounded-lg px-3.5 py-2.5 text-sm">{writeLockedNote("class_review")}</p> : null}
      <SettingsCard title="강사평가 기준" span2 description="직원 평가 → 직원 포트폴리오의 월간 점수를 어떻게 매길지 정합니다. 지표를 켜고 끄고, 만점과 점수 규칙을 학원에 맞게 고칩니다.">
        <p className="text-sm"><b className="num">켠 지표 {on.length}개 · 만점 합계 {maxTotal}점</b></p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>만점 합계는 100점이 아니어도 됩니다. 켠 지표의 만점을 더한 값이 그 달의 만점입니다.</li>
          <li>자료가 없는 지표는 지표마다 정한 대로(기본 0점) 매깁니다.</li>
          <li>저장하면 진행 중인 달의 점수를 다시 매깁니다. 마감한 달은 그때의 설정 그대로입니다.</li>
        </ul>
      </SettingsCard>
      {readOnly ? null : (
        <PresetBar presets={[...BUILTIN_PRESETS, ...presets]} draft={config} dirty={JSON.stringify(config) !== JSON.stringify(saved)}
          readOnly={readOnly} tableMissing={presetsMissing} onLoad={setConfig} />
      )}
      <WriteLockProvider locked={readOnly} menu="class_review">
      <fieldset disabled={readOnly} className="m-0 grid min-w-0 gap-4 border-0 p-0 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <EvaluationStaffContext.Provider value={staff}>
        <div className="min-w-0 space-y-3">
          {config.order.map((id, i) => {
            const s = settingOf(config, id);
            if (!s) return null;
            const manual = isManualId(id);
            const meta = manual ? null : METRIC_META[id as BuiltinMetricId];
            return (
              <MetricSettingCard key={id} setting={s} manual={manual} measure={meta?.measure ?? null} pending={meta?.pending}
                unit={manual ? (s as ManualMetricSetting).unit : meta!.unit}
                position={{ first: i === 0, last: i === config.order.length - 1 }}
                onChange={(next) => update(id, next)} onMove={(dir) => move(id, dir)} onRemove={manual ? () => remove(id) : undefined} />
            );
          })}
          {readOnly ? null : <Button type="button" variant="outline" onClick={addManual} disabled={config.manual.length >= 20}>직접 입력 지표 추가</Button>}
        </div>
        </EvaluationStaffContext.Provider>
        <PreviewCard saved={saved} draft={config} preview={preview} />
      </fieldset>
      </WriteLockProvider>
      {readOnly ? null : (
        <FormActionBar>
          <Button type="button" variant="ghost" onClick={() => setConfig(DEFAULT_EVALUATION_CONFIG)}>기본값으로</Button>
          <Button type="button" variant="ghost" onClick={() => setConfig(saved)}>되돌리기</Button>
          <Button type="submit" disabled={pending || tableMissing} aria-busy={pending}>{pending ? "저장 중…" : "저장"}</Button>
        </FormActionBar>
      )}
    </form>
  );
}
