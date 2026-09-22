"use client";

import { MenuGlyph } from "@/components/icons/menu-glyph";
import { STUDENTS, TODO_ITEMS, absences, billTotals, invoice, todayClassCount, todayProgress, won } from "./data";
import { FootNote, Pill, StuLink, useDesk } from "./bits";

/** 3F 원장실 — 운영실(매니저 팀 보고)·직원관리·회의록. 숫자는 전부 예시 학원 데이터에서 계산. */
export function BriefWin() {
  const { data, act } = useDesk();
  const p = todayProgress(data.att), b = billTotals(data.paid);
  const pct = Math.round((p.f / p.t) * 100);
  const watch = Object.keys(STUDENTS).filter((n) => absences(data.att, n) >= 2);
  const fl = (k: "att" | "bill" | "kan") => (data.flash[k] ? " flash" : "");
  return (
    <>
      <div className="kpis">
        <div className="kpi"><p>재원생</p><strong className="num">{Object.keys(STUDENTS).length}명</strong></div>
        <div className="kpi"><p>오늘 수업</p><strong className="num">{todayClassCount(data.att)}개</strong></div>
        <div key={`a${data.flash.att}`} className={`kpi${fl("att")}`}>
          <p>출결 입력</p><strong className="num">{p.f}/{p.t}</strong>
          <div className="bar"><i className={p.f === p.t ? "done" : ""} style={{ width: `${pct}%` }} /></div>
        </div>
        <div key={`b${data.flash.bill}`} className={`kpi${fl("bill")}`}><p>9월 수납</p><strong className="num">{b.rate}%</strong></div>
      </div>
      <div className="brief-h"><MenuGlyph name="sparkle" size={18} />매니저 팀 보고<span className="bt">오늘 07:00</span></div>
      <div className="areas">
        <div key={`s${data.flash.att}`} className={`area${fl("att")}`}>
          <span className="ak">학생</span>
          <p>{watch.length ? <>최근 2주 결석 2회 이상 — {watch.map((n, i) => <span key={n}>{i ? ", " : ""}<StuLink n={n} /> {absences(data.att, n)}회</span>)}</> : "최근 2주 결석이 이어지는 학생 없음"}</p>
          <Pill tone={watch.length ? "p-danger" : "p-green"}>{watch.length ? "주의" : "양호"}</Pill>
        </div>
        <div className="area"><span className="ak">수업</span><p>어제(월) 수업보고서 미작성 1건 · 고1 수학</p><Pill tone="p-amber">확인</Pill></div>
        <div className="area"><span className="ak">상담</span><p>후속 상담 오늘 기한 1건 · <StuLink n="박서윤" /></p><Pill tone="p-blue">오늘</Pill></div>
        <div key={`m${data.flash.bill}`} className={`area${fl("bill")}`}>
          <span className="ak">수납</span>
          <p>{b.unpaid.length ? `9월 미납 ${b.unpaid.length}건 · ${won(b.unpaid.reduce((s, n) => s + invoice(n), 0))}` : "9월 미납 없음"}</p>
          <Pill tone={b.unpaid.length ? "p-amber" : "p-green"}>{b.unpaid.length ? "미납" : "완료"}</Pill>
        </div>
        <div key={`k${data.flash.kan}`} className={`area${fl("kan")}`}>
          <span className="ak">운영</span><p>상담 전 문의 {data.kanban[0].c.length}건 · 레벨테스트 17:00</p><Pill tone="p-green">예정</Pill>
        </div>
      </div>
      <div className="brief-h" style={{ marginTop: 12 }}>오늘 할 일</div>
      <ul className="todo">
        {TODO_ITEMS.map((t, i) => (
          <li key={t}><label><input type="checkbox" checked={data.todo[i]} onChange={() => act.toggleTodo(i)} /><span>{t}</span></label></li>
        ))}
      </ul>
    </>
  );
}

const STAFF: [string, string, string, string][] = [
  ["김원장", "p-navy", "원장", "—"], ["정선생", "p-blue", "관리자", "—"], ["김선생", "p-purple", "강사", "수학"],
  ["박선생", "p-purple", "강사", "수학"], ["최선생", "p-purple", "강사", "수학"], ["이선생", "p-purple", "강사", "영어"],
];
export function StaffWin() {
  return (
    <>
      <table className="mini-t">
        <thead><tr><th>이름</th><th>역할</th><th>담당 과목</th><th>상태</th></tr></thead>
        <tbody>{STAFF.map((x) => <tr key={x[0]}><td><b>{x[0]}</b></td><td><Pill tone={x[1]}>{x[2]}</Pill></td><td>{x[3]}</td><td><Pill tone="p-green">재직</Pill></td></tr>)}</tbody>
      </table>
      <FootNote left="역할마다 보이는 메뉴가 다릅니다" />
    </>
  );
}

export function MeetWin() {
  return (
    <>
      <div className="steps"><Pill tone="p-green">녹음 38분</Pill><Pill tone="p-green">전사 완료</Pill><Pill tone="p-green">AI 분석 완료</Pill><span className="mono muted" style={{ marginLeft: "auto" }}>9/21</span></div>
      <div className="sec"><h5>요약</h5>9월 넷째 주 운영 점검. 추석 연휴 결강분 보강과 신규생 첫 달 연락을 정리함.</div>
      <div className="sec"><h5>결정 사항</h5><ul><li>추석 연휴(9/24–26) 결강분은 10월 첫 주 보강</li><li>신규생 1개월 콜은 담임이 직접</li></ul></div>
      <div className="sec"><h5>할 일</h5><ul><li>보강 시간표 초안 — 김선생 · 9/23까지</li><li>9월 미납 안내 — 정선생 · 9/22</li></ul></div>
      <div className="sec warn" style={{ marginBottom: 0 }}><h5>주의 신호</h5>중2 A반 결석이 이번 달 늘고 있음</div>
    </>
  );
}
