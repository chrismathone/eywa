"use client";

import { billTotals, classesOf, CLASSES, invoice, won } from "./data";
import { FootNote, Pill, StuLink, SubjPill, useDesk } from "./bits";

/** 1F 데스크(수납·퇴원) · 앞마당(셔틀) · 도움말. */
export function BillingWin() {
  const { data, act } = useDesk();
  const b = billTotals(data.paid);
  return (
    <>
      <div className="money">
        <div><p>청구 · 12건</p><strong className="num">{won(b.t)}</strong></div>
        <div><p>수납</p><strong className="num" style={{ color: "var(--green)" }}>{won(b.p)}</strong></div>
        <div><p>미수</p><strong className="num" style={{ color: "var(--amber)" }}>{won(b.t - b.p)}</strong></div>
      </div>
      <div className="prog"><i style={{ width: `${b.rate}%` }} /></div>
      <FootNote left={`수납률 ${b.rate}%`} right="금액 기준" />
      <table className="mini-t" style={{ marginTop: 6 }}>
        <thead><tr><th>원생</th><th>청구 항목</th><th>금액</th><th /></tr></thead>
        <tbody>
          {b.unpaid.length ? b.unpaid.map((n) => (
            <tr key={n}>
              <td><StuLink n={n} /></td><td>{classesOf(n).map((k) => CLASSES[k].name).join(" · ")}</td><td className="num">{won(invoice(n))}</td>
              <td><button type="button" className="sbtn" onClick={() => act.pay(n)}>입금 확인</button></td>
            </tr>
          )) : <tr><td colSpan={4} className="muted">9월 미납이 없습니다</td></tr>}
        </tbody>
      </table>
      <FootNote left="입금을 확인하면 운영실 숫자가 같이 바뀝니다" />
    </>
  );
}

export function WdWin() {
  return (
    <>
      <table className="mini-t">
        <thead><tr><th>원생</th><th>과목</th><th>사유</th><th>퇴원일</th></tr></thead>
        <tbody>
          <tr><td><b>예시 원생 A</b> <span className="muted">예시중3</span></td><td><SubjPill s="math" /></td><td><Pill tone="p-neutral">이사</Pill></td><td className="mono">9/12</td></tr>
          <tr><td><b>예시 원생 B</b> <span className="muted">예시고1</span></td><td><SubjPill s="eng" /></td><td><Pill tone="p-neutral">시간 조정</Pill></td><td className="mono">9/05</td></tr>
        </tbody>
      </table>
      <FootNote left="과목 하나만 끝내도 기록이 남습니다" />
    </>
  );
}

export function BusWin() {
  const { data, act } = useDesk();
  const left = Object.keys(data.ride).filter((n) => !data.ride[n]).length;
  return (
    <>
      <div className="run"><span><b>등원 1호차</b> · 16:05 도착</span><Pill tone="p-green">완료 · 4명</Pill></div>
      <div className="run" style={{ marginBottom: 4 }}><span><b>하원 1호차</b> · 16:45 출발</span><Pill tone={left ? "p-amber" : "p-green"}>{left ? `${left}명 남음` : "모두 탑승"}</Pill></div>
      <div className="stop">
        <span className="tm">16:45</span>
        <div>
          <p className="nm">학원 앞 출발</p>
          {Object.keys(data.ride).map((n) => (
            <button key={n} type="button" className={`ride${data.ride[n] ? " on" : ""}`} aria-pressed={data.ride[n]} onClick={() => act.toggleRide(n)}>{n}</button>
          ))}
        </div>
      </div>
      <div className="stop"><span className="tm">16:57</span><div><p className="nm">예시아파트 정문</p><span className="muted">정하린 하차</span></div></div>
      <div className="stop" style={{ borderBottom: 0 }}><span className="tm">17:05</span><div><p className="nm">예시초 후문</p><span className="muted">노은채 하차</span></div></div>
      <FootNote left="동승 선생님이 폰으로 누릅니다" right="셔틀 기록은 출결을 바꾸지 않습니다" />
    </>
  );
}

export function HelpWin() {
  return (
    <>
      <ul className="helpl">
        <li><b>창 열기</b><span>모형의 점이나 건물 안내판을 누르면 그 방의 창이 열립니다.</span></li>
        <li><b>옮기기</b><span>제목줄을 잡고 끕니다. 왼쪽·오른쪽 끝이면 반쪽, 위쪽 끝이면 꽉 채웁니다.</span></li>
        <li><b>크기</b><span>오른쪽 아래 모서리를 끌거나, 제목줄을 두 번 눌러 최대화합니다.</span></li>
        <li><b>접기</b><span><span className="kbd">—</span> 는 아래 줄로 접고, <span className="kbd">×</span> 는 닫습니다. ‘모두 접기’로 모형 전체를 봅니다.</span></li>
        <li><b>연결</b><span>출석부 칸·수납 입금 확인·상담 카드가 원장실 운영실 숫자를 바꿉니다.</span></li>
      </ul>
      <FootNote left={<>실제 AYWA에서는 <span className="kbd">F1</span> 로 지금 화면의 도움말을 엽니다</>} />
    </>
  );
}
