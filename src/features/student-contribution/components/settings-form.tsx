"use client";
import { writeLockedNote } from "@/lib/write-lock";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { METRICS, METRIC_LABELS, OPERATION_METRICS, PARTICIPATION_METRICS } from "../model/config";
import { familyRates, familyBonus } from "../model/family-loyalty";
import { RankingSettings } from "./ranking-settings";
import { scoreRaws } from "../model/calc";
import type { getContributionSettingsPreview } from "../server/queries";
import { saveContributionSettings } from "../server/actions";
import { ContributionHeader } from "./contribution-shell";
import { ScoreBreakdown } from "./score-breakdown";
import { SettingsChangeSummary } from "./settings-change-summary";
import { fieldClass, metricLabels, numberText, rateUnit } from "./presentation";

export function ContributionSettings({ data }: { data: NonNullable<Awaited<ReturnType<typeof getContributionSettingsPreview>>> }) {
  const [config, setConfig] = useState(data.config), [message, setMessage] = useState(""), [busy, start] = useTransition();
  const router = useRouter();
  const raws = data.raws;
  const activity = scoreRaws(raws, config), oldActivity = scoreRaws(raws, data.config);
  const sumFamily = (c: typeof config) => data.families.reduce((n,f)=>n+(familyBonus(f,c)??0),0);
  const preview = {...activity,total:activity.total+sumFamily(config)}, before = {...oldActivity,total:oldActivity.total+sumFamily(data.config)}, delta = preview.total - before.total;
  const family = familyRates(config);
  const changed = JSON.stringify(config) !== JSON.stringify(data.config);
  const rulesChanged = JSON.stringify(config.referrals) !== JSON.stringify(data.config.referrals) || config.attendance.allowLate !== data.config.attendance.allowLate;
  return <div className="w-full min-w-0 space-y-5 pb-6">
    <ContributionHeader title="로열티 배점 설정" description="어떤 실적에 몇 점을 더할지 정합니다. 저장하면 과거 실적 전체에도 새 배점을 적용합니다." active="settings" canConfigure />
    <form onSubmit={(e) => { e.preventDefault(); start(async () => {
      const r = await saveContributionSettings(config, data.revision); setMessage(r.error ?? r.message ?? ""); router.refresh();
    }); }} className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(22rem,1fr)]">
      <fieldset disabled={!data.gate.canWrite || !data.ready || busy} className="min-w-0 space-y-5 disabled:opacity-60">
        <RankingSettings config={config} onChange={ranking=>setConfig({...config,ranking})} />
        <section className="rounded-xl border border-amber/40 bg-amber-soft p-5 text-foreground"><h2 className="font-bold">기존 누적 활동 기록 · 가족 가점</h2>
          <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={family.enabled} onChange={e=>setConfig({...config,family:{...family,enabled:e.target.checked}})} />가족 재원 가점 반영</label>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">{([['two','2명 재원'],['three','3남매 재원'],['fourPlus','4명 이상 재원']] as const).map(([key,label])=><label key={key} className="text-sm">본인 포함 {label}<input aria-label={`${label} 가족 배점`} type="number" min="0" max="10000" step="any" required disabled={!family.enabled} value={family[key]} onChange={e=>setConfig({...config,family:{...family,[key]:Number(e.target.value)}})} className={`${fieldClass} mt-2 w-full`} /></label>)}</div>
          <p className="mt-3 text-xs">기본값 100·250·400점. 현재 함께 수강 중인 가족 수에 따라 한 번 가산합니다. 매달 중복 누적하지 않으며, 과거 활동 기록을 수정하지 않습니다. 가족 수가 많을수록 같은 점수 또는 더 높은 점수를 설정하세요.</p>
        </section>
        <div className="grid grid-cols-2 gap-5 phone:grid-cols-1">{[["운영 기여", OPERATION_METRICS], ["학습·참여", PARTICIPATION_METRICS]] .map(([title, metrics]) => <section key={title as string} className="min-w-0 overflow-hidden rounded-xl border border-line">
          <h2 className="border-b border-line bg-primary-softer px-5 py-4 font-semibold">{title as string}</h2>
          <div className="divide-y divide-line">{(metrics as typeof METRICS[number][]).map((metric) => <div key={metric} className="grid grid-cols-[minmax(0,1fr)_5rem_auto] items-center gap-3 px-5 py-4">
            <div><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-primary" disabled={metric === "parentSeminarEvents" && !data.parentEventsApproved && !config.rates[metric].enabled} checked={config.rates[metric].enabled} onChange={(e) => setConfig({ ...config, rates: { ...config.rates, [metric]: { ...config.rates[metric], enabled: e.target.checked } } })} />{metricLabels[metric]}</label><p className="ml-6 mt-1 text-xs">{metric === "parentSeminarEvents" && !data.parentEventsApproved ? "명단·반영 범위 확인 중" : rateUnit(metric)}</p></div>
            <input aria-label={`${METRIC_LABELS[metric]} 배점`} type="number" min="0" step="any" required disabled={!config.rates[metric].enabled} value={config.rates[metric].points}
              onChange={(e) => { const points = Number(e.target.value); if (Number.isFinite(points) && points >= 0) setConfig({ ...config, rates: { ...config.rates, [metric]: { ...config.rates[metric], points } } }); }} className={`${fieldClass} w-full px-2 text-right tabular-nums disabled:bg-secondary`} /><span className="text-sm">점</span>
          </div>)}</div>
        </section>)}</div>
        <section className="rounded-xl border border-line p-5"><h2 className="font-semibold">실적 인정 기준</h2><p className="mt-2 text-xs">기준을 바꾸면 다음 집계에서 과거 원본을 다시 확인합니다. 마감한 달의 차이는 이번 달 정정에 반영합니다.</p>
          <div className="mt-5 grid grid-cols-2 gap-5 phone:grid-cols-1"><label className="space-y-2 text-sm"><span className="block font-medium">같은 소개를 다시 인정하는 간격</span><span className="flex items-center gap-2"><input aria-label="소개 재인정 개월" type="number" min="1" max="120" required value={config.referrals.months} onChange={(e) => setConfig({ ...config, referrals: { ...config.referrals, months: Number(e.target.value) } })} className={`${fieldClass} w-24 text-right tabular-nums`} />개월</span></label>
            <label className="space-y-2 text-sm"><span className="block font-medium">소개 중복 판단 기준</span><select aria-label="소개 중복 판단 기준" value={config.referrals.key} onChange={(e) => setConfig({ ...config, referrals: { ...config.referrals, key: e.target.value as "studentSubject" | "student" } })} className={fieldClass}><option value="studentSubject">같은 학생 + 같은 과목</option><option value="student">같은 학생</option></select></label></div>
          <label className="mt-5 flex items-center gap-2 border-t border-line pt-4 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={config.attendance.allowLate} onChange={(e) => setConfig({ ...config, attendance: { allowLate: e.target.checked } })} />지각도 개근으로 인정</label>
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-card p-4"><SettingsChangeSummary before={data.config} after={config} delta={delta} /><p className="text-sm">{changed ? "과거 실적 전체에 새 배점을 적용합니다." : "현재 저장된 배점입니다."}</p>{data.gate.canWrite ? <div className="flex gap-2"><Button type="button" variant="outline" disabled={!changed || busy} onClick={() => { setConfig(data.config); setMessage(""); }}>변경 취소</Button><Button type="submit" disabled={busy || !changed}>{busy ? "저장 중…" : "배점 저장"}</Button></div> : null}
          <p role="status" className="w-full text-sm">{message || (!data.ready ? "로열티 저장 준비가 필요합니다." : !data.gate.canWrite ? writeLockedNote("student_contribution") : "")}</p></div>
      </fieldset>
      <aside className="min-w-0 space-y-4">
        <section className="rounded-xl border border-primary/30 bg-primary-softer p-5" aria-label="배점 미리보기"><h2 className="font-semibold">저장 전 미리보기</h2><p className="mt-1 text-xs">전체 학생 {data.studentCount}명 · 목록 필터와 무관한 누적 실적</p>
          <div className="mt-5 grid grid-cols-2 gap-3"><div><p className="text-xs">현재 배점</p><p className="mt-1 text-lg font-semibold tabular-nums">{numberText(before.total)}점</p></div><div><p className="text-xs">입력한 배점</p><p className="mt-1 text-lg font-bold text-primary tabular-nums">{numberText(preview.total)}점</p></div></div>
          <p className="mt-4 border-t border-line pt-3 text-sm">변화 <strong className="ml-2 tabular-nums">{delta > 0 ? "+" : ""}{numberText(delta)}점</strong></p>
          <p className="mt-2 text-xs">운영 {numberText(preview.operations)}점 · 학습·참여 {numberText(preview.participation)}점 · 가족 {numberText(sumFamily(config))}점</p>
          {preview.operations < preview.participation && <p className="mt-3 text-xs">학습·참여 점수가 운영 기여보다 큽니다. 의도한 비중인지 확인해 주세요.</p>}
          {rulesChanged && <p className="mt-3 text-xs font-medium">인정 기준 변경에 따른 실적 차이는 다음 집계 후 확인할 수 있습니다. 이 미리보기에는 배점 변경만 반영됩니다.</p>}
          {data.families.some(f=>f.state!=="ready") && <p className="mt-3 text-xs">가족 자료 미확인 {data.families.filter(f=>f.state!=="ready").length}명은 가족 가점 미리보기에서 제외했습니다. 이 합계는 잠정값입니다.</p>}
          {!data.historyReady && <p className="mt-3 text-xs">첫 집계 전에는 일부 실적만 반영됩니다.</p>}
        </section>
        <ScoreBreakdown raws={raws} config={config} preview />
        <p className="px-1 text-xs leading-relaxed">활동 항목은 상한 없이 누적하고 가족 가점은 현재 상태에 한 번만 적용합니다. 수업료는 원 단위 순액을 모은 뒤 10만 원당 배점을 적용합니다. 항목을 끄면 해당 실적은 보존되고 점수에서만 빠집니다.</p>
      </aside>
    </form>
  </div>;
}
