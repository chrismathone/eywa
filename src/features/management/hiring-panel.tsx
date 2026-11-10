"use client";
import { useState } from "react";
import { hiringScenario, type ManagementSnapshot } from "./model";
import s from "./workspace.module.css";

const number = (n: number | null, digits = 0) => n === null ? "자료 필요" : n.toLocaleString("ko-KR", { maximumFractionDigits: digits });
const won = (n: number | null) => n === null ? "자료 필요" : `${number(n)}원`;
const labels = { additionalMonthlyCost: "추가 월 인건비 총액(보험·퇴직 부담 포함)", additionalStudents: "추가 수강 예상 인원", netFee: "학생당 월 순수강료", variableCostPerStudent: "학생당 추가 변동비", targetMargin: "목표 영업이익률(%)" } as const;
type Key = keyof typeof labels;

/** 채용 시나리오 — 대사·마감이 끝난 그 달 손익에 원장이 입력한 가정을 더하는 브라우저 안 계산(저장하지 않는다 · AI에 보내지 않는다). */
export function HiringPanel({ data }: { data: ManagementSnapshot }) {
  const [values, setValues] = useState<Record<Key, string>>({ additionalMonthlyCost: "", additionalStudents: "", netFee: "", variableCostPerStudent: "", targetMargin: "" });
  const base = data.accounting;
  let result: ReturnType<typeof hiringScenario> | null = null;
  if (base?.ready && Object.values(values).every(x => x !== "")) {
    try { result = hiringScenario({ revenue: base.revenue, cost: base.cost, labor: base.labor, additionalMonthlyCost: Number(values.additionalMonthlyCost), additionalStudents: Number(values.additionalStudents), netFee: Number(values.netFee), variableCostPerStudent: Number(values.variableCostPerStudent), targetMargin: Number(values.targetMargin) }); }
    catch { /* 잘못된 가정은 계산하지 않은 채로 둔다 */ }
  }
  return <article className={s.panel}><h3>강사·알바 추가 채용 시나리오</h3><p>선택 월의 회계 손익에 가정을 더하는 계산입니다. 강의실 수용력·시간대·현금잔고·기존 인력의 업무량은 따로 확인해야 합니다.</p>
    {!base?.ready ? <p className={s.notice}>{data.reportedFinancials ? `${data.month} 보고서 기준 손익은 확인할 수 있지만 차량 원금·이자·감가상각 조정이 남아 채용 판단용 계산은 보류합니다.` : `${data.month}의 대사·마감 확인이 끝난 월별 손익이 없어 계산을 보류합니다. 연간·누적 자료를 임의로 월 환산하지 않습니다.`}</p> : null}
    <div className={s.inputs}>{(Object.keys(labels) as Key[]).map(k => <label key={k}>{labels[k]}<input type="number" min="0" step={k === "targetMargin" ? "0.1" : "1"} max={k === "targetMargin" ? "99.9" : undefined} value={values[k]} onChange={e => setValues({ ...values, [k]: e.target.value })}/></label>)}</div>
    {result ? <div className={s.bridge}><div><span>가정 적용 후 영업손익</span><strong className={result.profit < 0 ? s.warnText : undefined}>{won(result.profit)}</strong></div><div><span>가정 적용 후 이익률</span><strong>{number(result.margin, 1)}%</strong></div><div><span>추가비용 회수에 필요한 신규생</span><strong>{result.breakEvenNewStudents === null ? "가정상 달성 불가" : `${number(result.breakEvenNewStudents)}명`}</strong></div><div><span>목표 이익률에 필요한 신규생 총수</span><strong>{result.studentsForTarget === null ? "가정상 달성 불가" : `${number(result.studentsForTarget)}명`}</strong></div></div>
      : base?.ready ? <p>모든 가정을 0 이상으로 입력하면 계산합니다. 인원은 정수, 목표 이익률은 100% 미만입니다.</p> : null}
  </article>;
}
