"use client";

import { startTransition, useActionState, useState } from "react";
import { Panel } from "@/components/super-admin/parts";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { AI_MODEL_CHOICES, FEATURE_MODELS } from "@/lib/ai/model-pins";
import { FIXED_MODEL_FEATURES, TENANT_MODEL_FEATURES, modelChoicesFor, type TenantModelFeature } from "@/lib/ai/model-features";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { setTenantAiModel } from "@/features/super-admin/server/ai-model-actions";
import type { TenantAiModelState } from "@/features/super-admin/server/ai-model-queries";

/** 원시 id 대신 화면 이름 — 고를 수 있는 모델이면 그 이름, 아니면 공용 라벨(모르면 '기타 모델'). */
function modelName(model: string): string {
  return AI_MODEL_CHOICES.find((c) => c.model === model)?.label ?? modelDisplayLabel(model) ?? "기타 모델";
}

/** '기본값' 칸의 설명 — 코드가 기능별로 정해 둔 모델이 있으면 그 이름을 보인다. */
function defaultLabel(feature: string): string {
  const pin = FEATURE_MODELS[feature];
  return pin ? `기본값 (${modelName(pin.model)})` : "기본값";
}

/**
 * 운영 콘솔 학원 상세 'AI 모델' 탭 — 지점마다 AI 기능별 모델을 고른다(원장 2026-10-19). 고르면 바로 저장된다.
 * 고른 회사가 키·잔액으로 막히면 평소 순서(Claude → ChatGPT)대로 다음 회사로 넘어간다 — 기능이 멈추지 않는다.
 */
export function AiModelSection({ tenantId, state }: { tenantId: string; state: TenantAiModelState }) {
  const areas = [...new Set(TENANT_MODEL_FEATURES.map((f) => f.area))];
  return (
    <Panel
      title="AI 모델"
      description="이 지점의 AI 기능마다 모델을 고릅니다. 기본값은 코드에 정해 둔 모델을 따릅니다. 고른 회사가 키나 잔액 문제로 막히면 다른 회사로 넘어가 기능은 계속 돕니다."
      flush
    >
      {state.tableMissing ? (
        <p className="bg-amber-soft text-amber px-4 py-3 text-sm font-bold">
          DB에 AI 모델 표가 아직 없습니다 — 0375a를 적용하면 여기서 고를 수 있습니다. 지금은 모든 기능이 기본값으로 돕니다.
        </p>
      ) : null}
      <ul className="divide-line divide-y">
        {areas.map((area) => (
          <li key={area} className="px-4 py-3">
            <p className="text-foreground mb-1.5 text-xs font-bold">{area}</p>
            <ul className="space-y-2">
              {TENANT_MODEL_FEATURES.filter((f) => f.area === area).map((f) => (
                <AiModelRow
                  key={f.key}
                  tenantId={tenantId}
                  feature={f}
                  chosen={state.choices[f.key] ?? ""}
                  recent={state.recent[f.key] ?? null}
                  disabled={state.tableMissing}
                />
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="border-line text-foreground space-y-0.5 border-t px-4 py-3 text-xs">
        {Object.values(FIXED_MODEL_FEATURES).map((why) => (
          <p key={why}>{why}</p>
        ))}
      </div>
    </Panel>
  );
}

function AiModelRow({
  tenantId,
  feature,
  chosen,
  recent,
  disabled,
}: {
  tenantId: string;
  feature: TenantModelFeature;
  chosen: string;
  recent: { model: string; at: string } | null;
  disabled: boolean;
}) {
  const [state, dispatch, pending] = useActionState(setTenantAiModel, undefined);
  // 고른 값은 바로 화면에 — 저장이 실패하면 서버가 다시 그린 값(chosen)으로 돌아간다.
  const [value, setValue] = useState(chosen);
  const [lastChosen, setLastChosen] = useState(chosen);
  if (chosen !== lastChosen) {
    setLastChosen(chosen);
    setValue(chosen);
  }
  const options = [
    { value: "", label: defaultLabel(feature.key) },
    // 선생님이 기다리는 기능(멘트)엔 느린 모델이 빠진다 — 저장 검증과 같은 목록.
    ...modelChoicesFor(feature.key).map((c) => ({ value: c.model, label: c.label })),
  ];
  const failed = Boolean(state?.error) && state?.feature === feature.key;
  const shown = failed ? chosen : value;
  const onChange = (next: string) => {
    if (next === shown) return;
    setValue(next);
    const fd = new FormData();
    fd.set("tenantId", tenantId);
    fd.set("feature", feature.key);
    fd.set("model", next);
    startTransition(() => dispatch(fd));
  };
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <div className="min-w-0">
        <p className="text-foreground text-sm font-bold">{feature.label}</p>
        <p className="text-foreground text-xs">
          {recent ? `최근 30일: ${modelName(recent.model)}` : "최근 30일 사용 없음"}
          {pending ? " · 저장 중…" : state?.ok && state.feature === feature.key ? " · 저장됨" : ""}
        </p>
      </div>
      <div className="w-56 shrink-0">
        <SearchableSelect
          options={options}
          value={shown}
          onValueChange={onChange}
          ariaLabel={`${feature.area} ${feature.label} 모델`}
          className={disabled || pending ? "pointer-events-none opacity-60" : undefined}
          cap={10}
        />
      </div>
      {failed ? <p className="text-danger w-full text-right text-xs font-medium">{state?.error}</p> : null}
    </li>
  );
}
