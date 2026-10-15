"use client";

import { dataMonthOf } from "@/features/teacher-portfolio/model/dates";
import { metricOf } from "@/features/teacher-portfolio/model/types";
import { pointsText } from "@/features/teacher-portfolio/view";
import type { EvidenceProps } from "./evidence-records";
import { DataTable, SectionTitle, StatTiles } from "./parts";

/**
 * 매출 대비 급여 내역 — 비율·급여 출처·담당 학생 수·반 수만(원장 *"금액을 포트폴리오에 그대로 노출할 필요없고 비율만"*).
 * 학생 수·반 수는 원장 1-1 *"학생수와 생산성 모두 볼것"* — 점수엔 안 섞고 옆에 둔다.
 * 반별 표(원장 2026-10-15 *"급여 탭에서 상세 반별 매출 이런거 보면 좋겠는데"* → 비중만) = 반마다 학생 수 · 매출 비중(%) — 금액은 없다.
 */
export function PayRatioEvidence({ period }: Pick<EvidenceProps, "period">) {
  const m = metricOf(period, "payRatio");
  // 학생 1명이 이 선생님 반을 평균 몇 개 듣는지 — 학생 × 반 줄 ÷ 학생(보강 묶음 제외).
  const perStudent = m.students && m.enrollments ? (m.enrollments / m.students).toFixed(2) : null;
  // 이 달 점수는 지난달 재료(원장 2026-10-15) — 담당 학생·반도 그 달 값이라 달을 붙인다. 저장된 줄의 재료 달로 읽는다(옛 줄은 그 달 그대로).
  const data = dataMonthOf(period);
  const prev = data === period.month ? null : `${Number(data.slice(5, 7))}월`;
  // 반별 비중 — 이 칸이 생기기 전에 저장(마감)된 달은 빈 목록이다.
  const byClass = Array.isArray(m.detail) ? m.detail : [];
  return (
    <>
      <StatTiles items={[
        { label: "급여 비율", value: m.raw === null || m.raw === undefined ? "—" : `${m.raw.toFixed(1)}%` },
        { label: "점수", value: pointsText(m, period) },
        { label: "급여 출처", value: m.source ?? "없음" },
        { label: prev ? `담당 학생(${prev})` : "담당 학생", value: m.students === undefined ? "—" : `${m.students}명` },
        { label: prev ? `담당 반(${prev})` : "담당 반", value: m.classes === undefined ? "—" : `${m.classes}개` },
      ]} />
      {m.raw === null || m.raw === undefined
        ? <p role="status" className="bg-amber-soft mt-4 rounded-lg px-3.5 py-3 text-xs leading-relaxed">{m.basis}</p> : null}
      <SectionTitle sub={`${prev ? `${prev} · ` : ""}금액 없이 비중만 — 매출 비중 = 금액을 찾은 매출 중 그 반 몫`}>반별</SectionTitle>
      <DataTable headers={["반", "학생", "금액 찾은 학생", "매출 비중"]} kinds={["text", "num", "num", "num"]}
        empty="반별 내역이 없습니다(그 달 담당 반이 없거나, 반별 내역을 싣기 전에 저장된 달입니다)."
        rows={byClass.map((r, i) => ({
          key: `${r.className}|${i}`,
          cells: [r.className, `${r.students}명`, `${r.billed}/${r.rows}명`, r.share === null ? "—" : `${r.share.toFixed(1)}%`],
        }))} />
      <div className="bg-primary-softer mt-4 space-y-1.5 rounded-lg px-3.5 py-3 text-xs leading-relaxed">
        {prev ? <p><b>지난달({prev}) 값으로 매깁니다</b> — 이번 달 급여는 월말이 돼야 확정되므로, 이 달 점수는 {prev} 급여 ÷ {prev} 매출입니다(계약서 월급·출석부 실급여·청구서 모두 {prev} 것).</p> : null}
        <p>급여 비율 = 그 달 급여(세전) ÷ 담당 매출. 매출은 그 선생님 출석부(강사 전체 보기)의 학생·반마다 그 달 <b>청구서의 그 반 금액</b>(할인 전)을 더한 값입니다 — 함께 맡은 반도 그 줄 금액 그대로입니다. 영어처럼 청구서 항목 이름이 반 이름과 다르면, 그 학생의 못 맞춘 반과 남은 수강료 항목이 하나씩일 때 그 둘을 짝지어 잡습니다(반을 옮긴 달처럼 짝이 여럿이면 이름만으로는 어느 반 금액인지 몰라, 출석부 청구액에 그 반 금액이 따로 잡혀 있지 않으면 못 찾은 줄로 셉니다).</p>
        <p>급여는 원장 직접 입력 → 계약서 월급 → 출석부 실급여(프리랜서) 순으로 처음 있는 것을 씁니다. 금액은 포트폴리오에 보이지 않습니다(직접 넣은 금액은 &lsquo;직접 입력&rsquo; 창에서만 보입니다).</p>
        <p>계약서 월급은 그 달의 가장 최근 계약 하나에서 한 달 금액(월급·기본급·급여계약금·&lsquo;○○만/월&rsquo;·연봉 ÷ 12)을 읽습니다. 그 계약에 금액이 둘 이상이거나 수당 금액·시급·업무별 단가가 적혀 있으면 읽지 않고(이전 계약으로 내려가지 않습니다), 월급과 비율이 함께 적힌 계약은 월급만 씁니다. 출석부 실급여는 프리랜서 명세서와 같은 계산이지만, 명세서에서 그 달에만 얹는 배분율 차감은 들어가지 않습니다. 다르면 직접 입력으로 바로잡아 주세요.</p>
        <p>청구서에서 담당 반 금액을 찾은 줄이 80%가 안 되면 비율을 내지 않습니다(매출이 덜 잡힌 채 나누지 않게). 프리랜서 실급여는 급여명세서 수업료와 같은 계산이라, 그 값이 선 줄이 80%가 안 되면 급여를 모르는 것으로 둡니다. 그 까닭이 아직 단가가 정해지지 않은 줄이면(또는 자료를 잠깐 못 읽었으면) 그 달을 다음 달 말까지 마감하지 않고 다시 세며, 그 사이 급여를 직접 입력할 수도 있습니다. 그 밖의 경우(매출을 찾은 줄이 모자란 달 포함)는 기다리지 않고 다음 달 1일에 그대로 마감합니다.</p>
        {perStudent ? <p>학생 1명이 듣는 반 평균 {perStudent}개 — 학생 수가 같아도 여러 반을 듣는 학생이 많으면 매출이 높아 함께 봅니다.</p> : null}
      </div>
    </>
  );
}
