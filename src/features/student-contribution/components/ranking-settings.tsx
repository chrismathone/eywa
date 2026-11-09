"use client";
import { DEFAULT_RANKING_CONFIG, rankingConfig, RANKING_KEYS, RANKING_LABELS, type RankingConfig } from "../model/ranking-config";
import type { ContributionConfig } from "../model/config";
import { fieldClass } from "./presentation";
export function RankingSettings({ config, onChange }: { config: ContributionConfig; onChange: (value: RankingConfig) => void }) {
  const value = rankingConfig(config), sum = Object.values(value.weights).reduce((s,v)=>s+v,0);
  return <section className="space-y-4 rounded-xl border border-line bg-card p-5">
    <h2 className="font-bold">로열티 랭킹 · 6개 항목 / 100점</h2>
    <p className="text-xs leading-relaxed">아래 배점은 새 랭킹에 적용됩니다. 기존 누적 활동 점수 및 42개 정밀 팩터 배점과는 별도입니다. 수강·납부 가산율은 각 월의 기록에 적용합니다.</p>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{RANKING_KEYS.map(k=><label key={k} className="text-sm">{RANKING_LABELS[k]}
      <input aria-label={`랭킹 ${RANKING_LABELS[k]} 배점`} className={`${fieldClass} mt-1 w-full`} type="number" min="0" max="100" step="0.1" required value={value.weights[k]} onChange={e=>onChange({...value,weights:{...value.weights,[k]:Number(e.target.value)}})} />
    </label>)}</div>
    <p role="status" className={`text-sm font-semibold ${Math.abs(sum-100)<0.001?"text-primary":"text-destructive"}`}>합계 {sum.toFixed(1)} / 100점{Math.abs(sum-100)>=0.001?" · 합계를 100점으로 맞춰 주세요.":""}</p>
    <div className="grid gap-3 sm:grid-cols-2">{([['concurrentBonus','동시수강 가산율'],['extraSubjectBonus','추가 과목당 가산율']] as const).map(([k,label])=><label key={k} className="text-sm">{label} (%)<input aria-label={label} className={`${fieldClass} mt-1 w-full`} type="number" min="0" max="200" step="1" required value={Math.round(value[k]*100)} onChange={e=>onChange({...value,[k]:Number(e.target.value)/100})} /></label>)}</div>
    <label className="block text-sm">학교 성적 반영<select aria-label="학교 성적 반영 방식" className={`${fieldClass} mt-1 w-full`} value={value.gradeMode} onChange={e=>onChange({...value,gradeMode:e.target.value as RankingConfig['gradeMode']})}><option value="improvement">향상도 중심</option><option value="current">최근 학교 성적</option><option value="both">최근 성적 50% + 향상도 50% (기본)</option></select></label>
    <p className="text-xs">형제자매 기록은 누적 과목개월 × 현재 함께 재원하는 형제자매 수입니다. 기본 배점 40점으로 가장 큰 비중을 둡니다.</p>
    <button type="button" className="text-xs font-semibold text-primary underline" onClick={()=>onChange(DEFAULT_RANKING_CONFIG)}>랭킹 기본 배점으로 되돌리기</button>
  </section>;
}
