"use client";

import { metricOf } from "@/features/teacher-portfolio/model/types";
import { pointsText } from "@/features/teacher-portfolio/view";
import type { EvidenceProps } from "./evidence-records";
import { StatTiles } from "./parts";

/**
 * 매출 대비 급여 내역 — 비율·급여 출처·담당 학생 수·반 수만(원장 *"금액을 포트폴리오에 그대로 노출할 필요없고 비율만"*).
 * 학생 수·반 수는 원장 1-1 *"학생수와 생산성 모두 볼것"* — 점수엔 안 섞고 옆에 둔다.
 */
export function PayRatioEvidence({ period }: Pick<EvidenceProps, "period">) {
  const m = metricOf(period, "payRatio");
  // 학생 1명이 이 선생님 반을 평균 몇 개 듣는지 — 학생 × 반 줄 ÷ 학생(보강 묶음 제외).
  const perStudent = m.students && m.enrollments ? (m.enrollments / m.students).toFixed(2) : null;
  return (
    <>
      <StatTiles items={[
        { label: "급여 비율", value: m.raw === null || m.raw === undefined ? "—" : `${m.raw.toFixed(1)}%` },
        { label: "점수", value: pointsText(m, period) },
        { label: "급여 출처", value: m.source ?? "없음" },
        { label: "담당 학생", value: m.students === undefined ? "—" : `${m.students}명` },
        { label: "담당 반", value: m.classes === undefined ? "—" : `${m.classes}개` },
      ]} />
      {m.raw === null || m.raw === undefined
        ? <p role="status" className="bg-amber-soft mt-4 rounded-lg px-3.5 py-3 text-xs leading-relaxed">{m.basis}</p> : null}
      <div className="bg-primary-softer mt-4 space-y-1.5 rounded-lg px-3.5 py-3 text-xs leading-relaxed">
        <p>급여 비율 = 그 달 급여(세전) ÷ 담당 매출. 매출은 그 선생님 출석부(강사 전체 보기) 맨 아래 합계 행의 <b>청구액</b>(할인 전 · 함께 맡은 반도 그 줄 금액 그대로)입니다.</p>
        <p>급여는 원장 직접 입력 → 계약서 월급 → 출석부 실급여(프리랜서) 순으로 처음 있는 것을 씁니다. 금액은 포트폴리오에 보이지 않습니다(직접 넣은 금액은 &lsquo;직접 입력&rsquo; 창에서만 보입니다).</p>
        <p>계약서 월급은 그 달의 가장 최근 계약 하나에서 한 달 금액(월급·기본급·급여계약금·&lsquo;○○만/월&rsquo;·연봉 ÷ 12)을 읽습니다. 그 계약에 금액이 둘 이상이거나 수당 금액·시급·업무별 단가가 적혀 있으면 읽지 않고(이전 계약으로 내려가지 않습니다), 월급과 비율이 함께 적힌 계약은 월급만 씁니다. 출석부 실급여는 프리랜서 명세서와 같은 계산이지만, 명세서에서 그 달에만 얹는 배분율 차감은 들어가지 않습니다. 다르면 직접 입력으로 바로잡아 주세요.</p>
        <p>회차 확정으로 청구액이 잡힌 줄이 80%가 안 되면 비율을 내지 않습니다(달 중간에 한 달 급여를 일부 청구액으로 나누지 않게).</p>
        {perStudent ? <p>학생 1명이 듣는 반 평균 {perStudent}개 — 학생 수가 같아도 여러 반을 듣는 학생이 많으면 매출이 높아 함께 봅니다.</p> : null}
      </div>
    </>
  );
}
