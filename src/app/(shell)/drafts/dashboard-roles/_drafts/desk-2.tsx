/** 경영지원·데스크 시안 2 — 목록 중심 "수납 실무". 미납 건별(이름·항목·금액·경과일)과 안내 상태. 합계·수납률·추이 없음. */
import { Panel, ToneBadge } from "../_components/parts";
import { DESK, won } from "../_data/fake";

const TABLE =
  "w-full border-collapse text-sm [&_th]:bg-bg-soft [&_th]:px-3 [&_th]:py-2 [&_th]:font-bold [&_td]:px-3 [&_td]:py-2 [&_tbody_tr]:border-t [&_tr]:border-line [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint";

export function Desk2() {
  return (
    <Panel title="이번 달 미납" count={`${DESK.unpaid.length}건`} note="합계·수납률은 이 화면에 없다">
      <table className={TABLE}>
        <thead>
          <tr>
            <th className="text-left">원생</th>
            <th className="text-center">항목</th>
            <th className="text-right">금액</th>
            <th className="text-center">지난 날</th>
            <th className="text-center">안내</th>
          </tr>
        </thead>
        <tbody>
          {DESK.unpaid.map((u, i) => (
            <tr key={u.name}>
              <td className="font-bold">{u.name}</td>
              <td className="text-center">{u.item}</td>
              <td className="num text-right font-bold">{won(u.amount)}</td>
              <td className="num text-center">{u.days}일</td>
              <td className="text-center">
                {i % 3 === 0 ? (
                  <ToneBadge tone="positive">문자 보냄</ToneBadge>
                ) : i % 3 === 1 ? (
                  <ToneBadge tone="caution">안내 전</ToneBadge>
                ) : (
                  <ToneBadge tone="info">분납 약속</ToneBadge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
