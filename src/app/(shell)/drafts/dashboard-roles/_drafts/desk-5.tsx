/** 경영지원·데스크 시안 5 — 숫자 중심 "접수 숫자". 신규문의·입테·등록·미납 4칸(건수만) + 짧은 목록. */
import { BigStat } from "@/components/atoms/big-stat";
import { EyIcon } from "@/components/icons/aywa-icons";
import { Panel, Row, ToneBadge } from "../_components/parts";
import { ACADEMY, DESK, STUDENTS } from "../_data/fake";

export function Desk5() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat label="신규문의" value={ACADEMY.kpi[2].value} unit="건" tone="blue" icon={<EyIcon name="messagePlus" size={16} />} sub="이번 달 · 오늘 2건" />
        <BigStat label="금일입테" value={ACADEMY.kpi[3].value} unit="명" tone="primary" icon={<EyIcon name="exam" size={16} />} sub="첫 15:30" />
        <BigStat label="금일 등록" value={ACADEMY.kpi[4].value} unit="명" tone="green" icon={<EyIcon name="userCheck" size={16} />} sub="반 배정 1 · 배정 전 1" />
        <BigStat label="미납" value={DESK.unpaid.length} unit="건" tone="amber" icon={<EyIcon name="receipt" size={16} />} sub="건수만 — 금액은 원장" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="오늘 들어온 문의" count="2건">
          <Row name={`09:40 · ${STUDENTS[0]} 학부모`} desc="중2 · 전화 · 상담 예약 요청" right={<ToneBadge tone="info">접수</ToneBadge>} />
          <Row name={`11:15 · ${STUDENTS[1]} 학부모`} desc="고1 · 방문 · 입테 희망" right={<ToneBadge tone="info">접수</ToneBadge>} />
        </Panel>
        <Panel title="콜백 대기" count="1건">
          <Row name={`${STUDENTS[8]} 학부모`} desc="어제 18:20 부재중 · 다시 전화" right={<ToneBadge tone="caution">콜백</ToneBadge>} />
        </Panel>
      </div>
    </div>
  );
}
