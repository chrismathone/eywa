"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MISSING_LABEL, missingSchema, type ManualMetricSetting, type MetricSetting } from "@/features/teacher-portfolio/evaluation/config";
import { ChurnOptionsEditor } from "./churn-options";
import { ReferralOptionsEditor } from "./referral-options";
import { PunctualityOptionsEditor } from "./punctuality-options";
import { GradesOptionsEditor, SatisfactionOptionsEditor } from "./source-options";
import { NumField, ScoringEditor } from "./scoring-editor";
import { useLockedPlaceholder, useWriteLock } from "../write-lock-context";

/** 지표 한 장 — 켜기 · 이름 · 만점 · 차례 · 원래 수치 · 점수 규칙 · 자료가 없을 때. 직접 만든 지표는 단위·설명과 삭제가 더 있다. */
export function MetricSettingCard({ setting, measure, pending, unit, manual, position, onChange, onMove, onRemove }: {
  setting: MetricSetting | ManualMetricSetting;
  /** 원래 수치가 무엇인가(기본 지표) — 직접 만든 지표는 null(설명 칸으로 적는다). */
  measure: string | null;
  /** 아직 계산이 들어오지 않은 지표의 단계 — 그 전까지는 '자료가 없을 때' 규칙으로 매긴다고 알린다. */
  pending?: string;
  unit: string;
  manual: boolean;
  position: { first: boolean; last: boolean };
  onChange: (next: MetricSetting | ManualMetricSetting) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove?: () => void;
}) {
  const set = (patch: Partial<ManualMetricSetting>) => onChange({ ...setting, ...patch } as MetricSetting | ManualMetricSetting);
  const label = setting.label || "지표";
  const { locked } = useWriteLock();
  const ph = useLockedPlaceholder();
  return (
    <section data-metric-setting aria-label={label}
      className={`bg-card shadow-card space-y-4 rounded-2xl p-5 ${setting.enabled ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={setting.enabled} onChange={(e) => set({ enabled: e.target.checked })} className="size-4" />
          {setting.enabled ? "켜짐" : "꺼짐"}
        </label>
        <Input aria-label="지표 이름" value={setting.label} maxLength={30} onChange={(e) => set({ label: e.target.value })} className="w-44 font-bold" />
        <span className="flex items-center gap-1.5 text-sm">
          만점 <NumField label={`${label} 만점`} value={setting.max} onChange={(n) => set({ max: Math.max(0, n ?? 0) })} /> 점
        </span>
        {/* 읽기 권한(쓰기 잠금)이면 순서 이동·삭제를 그리지 않는다(evaluation-editor.tsx가 잠금을 세운다). */}
        {locked ? null : (
          <span className="ml-auto flex items-center gap-1">
            <Button type="button" size="sm" variant="ghost" disabled={position.first} onClick={() => onMove(-1)} aria-label={`${label} 위로`}>위로</Button>
            <Button type="button" size="sm" variant="ghost" disabled={position.last} onClick={() => onMove(1)} aria-label={`${label} 아래로`}>아래로</Button>
            {onRemove ? <Button type="button" size="sm" variant="ghost" onClick={onRemove}>지표 삭제</Button> : null}
          </span>
        )}
      </div>
      {manual ? (
        <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <label className="space-y-1 text-sm">
            <span className="block font-medium">단위</span>
            <Input value={(setting as ManualMetricSetting).unit} maxLength={10} onChange={(e) => set({ unit: e.target.value })} />
          </label>
          <label className="space-y-1 text-sm">
            <span className="block font-medium">무엇을 적나</span>
            <Input value={(setting as ManualMetricSetting).description} maxLength={200} placeholder={ph("예: 디스쿨·네이버 영수증 리뷰의 실명 칭찬 건수")}
              onChange={(e) => set({ description: e.target.value })} />
          </label>
          <p className="text-xs sm:col-span-2">원장이 달마다 강사별 숫자를 넣습니다(직원 포트폴리오 → 직접 입력 지표).</p>
        </div>
      ) : (
        <>
          <p className="text-sm"><b className="font-medium">원래 수치</b> · {measure}{unit ? ` (${unit})` : ""}</p>
          {pending ? <p className="bg-amber-soft rounded-lg px-3 py-2 text-xs">아직 자동으로 세지 않습니다({pending}에서 들어옵니다). 그 전까지는 수치가 없거나 0건으로 매겨집니다.</p> : null}
        </>
      )}
      {setting.churn ? <ChurnOptionsEditor label={label} value={setting.churn} onChange={(churn) => set({ churn })} /> : null}
      {setting.referral ? <ReferralOptionsEditor label={label} value={setting.referral} onChange={(referral) => set({ referral })} /> : null}
      {setting.grades ? <GradesOptionsEditor label={label} value={setting.grades} onChange={(grades) => set({ grades })} /> : null}
      {/* 글 칸은 칸을 떠날 때 읽는다 — 구성 불러오기처럼 밖에서 값이 바뀌면 새로 그린다(key). */}
      {setting.satisfaction ? <SatisfactionOptionsEditor key={JSON.stringify([setting.satisfaction.positive, setting.satisfaction.negative, setting.satisfaction.ignore, setting.satisfaction.hedges])}
        label={label} value={setting.satisfaction} onChange={(satisfaction) => set({ satisfaction })} /> : null}
      {setting.punctuality ? <PunctualityOptionsEditor label={label} value={setting.punctuality} onChange={(punctuality) => set({ punctuality })} /> : null}
      <ScoringEditor label={label} scoring={setting.scoring} max={setting.max} unit={unit} onChange={(scoring) => set({ scoring })} />
      <label className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">자료가 없을 때</span>
        <select value={setting.missing} onChange={(e) => set({ missing: missingSchema.parse(e.target.value) })}
          className="border-line bg-card min-h-(--control-h) rounded-lg border px-3">
          {missingSchema.options.map((m) => <option key={m} value={m}>{MISSING_LABEL[m]}</option>)}
        </select>
      </label>
    </section>
  );
}
