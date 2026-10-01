/** 경영지원·데스크 시안 4 — 처리 목록 중심 "원생 변동 처리". 신규·반 이동·휴원·퇴원 예약. 퇴원 사유·추이·금액 없음. */
import { Panel, Row, ToneBadge } from "../_components/parts";
import { DESK } from "../_data/fake";

const TODO = ["반 배정·출석부 확인", "교재 신청", "보호자 안내 문자"];

export function Desk4() {
  return (
    <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
      <Panel title="처리할 변동" count={`${DESK.changes.length}건`}>
        {DESK.changes.map((c, i) => (
          <Row
            key={c.name}
            name={`${c.name} · ${c.kind}`}
            desc={`${c.when} · ${i === 2 ? "사유는 원장·과목 관리자만" : TODO[i % TODO.length]}`}
            right={<ToneBadge tone={c.tone}>{c.kind}</ToneBadge>}
          />
        ))}
      </Panel>
      <Panel title="이번 주 처리한 것" count="5건">
        <ul className="flex flex-col gap-2 text-sm">
          <li className="flex items-center justify-between">
            <span>신규 등록</span>
            <span className="num font-bold">2건</span>
          </li>
          <li className="flex items-center justify-between">
            <span>반 이동</span>
            <span className="num font-bold">1건</span>
          </li>
          <li className="flex items-center justify-between">
            <span>휴원 · 복귀</span>
            <span className="num font-bold">1건</span>
          </li>
          <li className="flex items-center justify-between">
            <span>퇴원 처리</span>
            <span className="num font-bold">1건</span>
          </li>
        </ul>
      </Panel>
    </div>
  );
}
