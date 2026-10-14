"use client";

import { METRIC_META } from "@/features/teacher-portfolio/evaluation/catalog";
import { MISSING_LABEL, isManualId, type BuiltinMetricId, type ManualMetricSetting } from "@/features/teacher-portfolio/evaluation/config";
import { settingOf } from "@/features/teacher-portfolio/evaluation/preview";
import { scoringTable } from "@/features/teacher-portfolio/evaluation/scoring";
import type { ItemId, StoredPeriod } from "@/features/teacher-portfolio/model/types";
import { maxLabel, ruleText } from "@/features/teacher-portfolio/view";
import { useRuleBoxPref } from "./rule-box-pref";

/**
 * 항목별 내역 **맨 위의 점수 기준** — 무엇을 재는지 · 수치마다 몇 점인지 · 자료가 없을 때(원장 2026-10-14 *"각 탭마다 세부 점수
 * 지표 알려놓을것"* · *"규칙을 최상단에 따로 테두리같은거 넣어서 깔끔하게"* · *"접고 펼치기해서 컴팩트 가능하게"* ·
 * *"쓸데없이 행 너무 많이 쓰지말고 열과 행 정리해서"*).
 * 점수표는 **가로 두 줄**(수치 / 점수) — 조건이 열이다. 접으면 머리 한 줄(규칙 한 줄 요약)만. 접힘은 계정 귀속(`rule-box-pref`).
 * 그 달을 매긴 설정 사본으로 그린다 — 지난 달은 그때 기준. 사본이 없는 옛 달(2026-10-13 전)은 무엇을 재는지만.
 */
export function ScoreRuleBox({ period, id }: { period: StoredPeriod; id: ItemId }) {
  const { collapsed, toggle } = useRuleBoxPref();
  const manual = isManualId(id);
  const setting = period.evaluation ? settingOf(period.evaluation, id) : undefined;
  const meta = manual ? undefined : METRIC_META[id as BuiltinMetricId];
  const unit = manual ? ((setting as ManualMetricSetting | undefined)?.unit ?? "") : (meta?.unit ?? "");
  const measure = manual ? ((setting as ManualMetricSetting | undefined)?.description || "원장이 달마다 넣는 값") : (meta?.measure ?? "");
  const cols = setting ? [...scoringTable(setting.scoring, setting.max, unit), { when: "자료 없음", points: MISSING_LABEL[setting.missing] }] : [];
  const summary = ruleText(period, id);
  return (
    <section aria-label="점수 기준" className="border-line mb-4 rounded-xl border px-4 py-2.5">
      <div className="flex items-baseline gap-3">
        <h4 className="shrink-0 text-sm font-bold">점수 기준</h4>
        <p className={`min-w-0 flex-1 text-xs leading-relaxed ${collapsed ? "truncate" : ""}`}>{collapsed ? (summary ?? measure) : measure}</p>
        {setting ? <span className="shrink-0 text-xs">만점 <b className="num">{maxLabel(setting.max)}</b></span> : null}
        <button type="button" onClick={toggle} aria-expanded={!collapsed} className="text-primary shrink-0 text-xs font-medium hover:underline">
          {collapsed ? "펼치기" : "접기"}
        </button>
      </div>
      {collapsed ? null : cols.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-xs [&_tr>*:not(:first-child)]:border-l [&_tr>*]:border-line-faint">
            <tbody>
              <tr>
                <th scope="row" className="w-12 py-1 pr-2 text-left font-medium">수치</th>
                {cols.map((c) => <td key={c.when} className="px-2 py-1 text-center break-keep">{c.when}</td>)}
              </tr>
              <tr className="border-line-faint border-t">
                <th scope="row" className="py-1 pr-2 text-left font-medium">점수</th>
                {cols.map((c) => <td key={c.when} className="num px-2 py-1 text-center font-bold break-keep">{c.points}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-1.5 text-xs">이 달은 2026년 10월 13일 전 기준으로 매긴 점수입니다 — 그때 기준은 ‘평가 기준’에서 볼 수 있습니다.</p>
      )}
    </section>
  );
}
