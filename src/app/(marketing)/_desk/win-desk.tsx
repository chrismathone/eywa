"use client";

import { CLASSES, CONSULTS, PAST, ST_LABEL, STUDENTS, STUDENT_NOTES, classesOf, invoice, todayStatus, won } from "./data";
import { Dots, FootNote, Pill, StuLink, SubjPill, WDays, useDesk } from "./bits";

/** 1F 데스크 — 콜&상담 칸반·원생목록·원생 정보·원생상담. */
export function EnrollWin() {
  const { data, act } = useDesk();
  return (
    <>
      <div className="kan">
        {data.kanban.map((col, ci) => (
          <div key={col.k} className="kcol">
            <h4><span>{col.k}</span><span className="num">{col.c.length}</span></h4>
            {col.c.map((c, i) => (
              <button key={c.n} type="button" className="kcard" title={ci < 3 ? "눌러서 다음 단계로" : undefined} onClick={() => act.moveCard(ci, i)}>
                <b>{c.n}</b> <span className="muted">{c.g}</span><br />{c.s}{c.m ? <span className="m">{c.m}</span> : null}
              </button>
            ))}
          </div>
        ))}
      </div>
      <FootNote left="카드를 누르면 다음 단계로 옮깁니다" />
    </>
  );
}

export function StudentsWin() {
  const { data, act, openStudent } = useDesk();
  const q = data.stuQ;
  const names = Object.keys(STUDENTS).filter((n) => !q || n.includes(q) || STUDENTS[n].sg.includes(q));
  return (
    <>
      <input className="search" type="search" placeholder="이름·학교로 찾기" value={q} onChange={(e) => act.setStuQ(e.target.value.trim())} aria-label="원생 찾기" />
      <table className="mini-t">
        <thead><tr><th>이름</th><th>학교·학년</th><th>수강</th><th>상태</th></tr></thead>
        <tbody>
          {names.length ? names.map((n) => {
            const s = STUDENTS[n];
            return (
              <tr key={n} className="clk" tabIndex={0} onClick={() => openStudent(n)} onKeyDown={(e) => { if (e.key === "Enter") openStudent(n); }}>
                <td><b>{n}</b></td><td>{s.sg}</td><td>{s.subj.map((x) => <SubjPill key={x} s={x} />)}</td>
                <td><Pill tone="p-green">재원</Pill>{s.tag ? <> <Pill tone="p-purple">{s.tag}</Pill></> : null}</td>
              </tr>
            );
          }) : <tr><td colSpan={4} className="muted">찾는 원생이 없습니다</td></tr>}
        </tbody>
      </table>
      <FootNote left="줄을 누르면 원생 정보가 열립니다" />
    </>
  );
}

export function StuWin({ arg }: { arg: string | null }) {
  const { data } = useDesk();
  const n = arg ?? "";
  const s = STUDENTS[n];
  if (!s) return null;
  const ts = todayStatus(data.att, n);
  return (
    <>
      <div className="prof"><b>{n}</b><span className="muted">{s.sg}</span><Pill tone="p-green">재원</Pill>{s.tag ? <Pill tone="p-purple">{s.tag}</Pill> : null}</div>
      <div className="sec">
        <h5>수강 중인 반</h5>
        {classesOf(n).map((k) => {
          const c = CLASSES[k];
          return <div key={k} className="row" style={{ justifyContent: "space-between", padding: "3px 0" }}><span><SubjPill s={c.subj} /> <b>{c.name}</b> · {c.t}</span><WDays slots={c.slots} /></div>;
        })}
      </div>
      <div className="sec"><h5>최근 출결</h5><Dots past={PAST[n] ?? []} today={ts} /> <span className="muted" style={{ marginLeft: 6 }}>{ts !== null ? `오늘 ${ST_LABEL[ts]}` : "오늘 수업 없음"}</span></div>
      <div className="sec"><h5>9월 수납</h5>{data.paid[n] ? <Pill tone="p-green">완납</Pill> : <Pill tone="p-amber">미납</Pill>} <span className="num" style={{ marginLeft: 4 }}>{won(invoice(n))}</span></div>
      <div className="sec" style={{ marginBottom: 0 }}><h5>최근 상담</h5><span>{STUDENT_NOTES[n] ?? "최근 상담 기록 없음."}</span></div>
    </>
  );
}

export function ConsWin() {
  const { data, act } = useDesk();
  const c = CONSULTS[data.consSel];
  return (
    <>
      <table className="mini-t">
        <thead><tr><th>원생</th><th>과목·상담</th><th /><th>일자</th></tr></thead>
        <tbody>
          {CONSULTS.map((r, i) => (
            <tr key={r.n} className={`clk${i === data.consSel ? " sel" : ""}`} tabIndex={0} onClick={() => act.setConsSel(i)} onKeyDown={(e) => { if (e.key === "Enter") act.setConsSel(i); }}>
              <td><b>{r.n}</b> <span className="muted">{r.sg}</span></td><td>{r.who}</td><td><Pill tone={r.st[0]}>{r.st[1]}</Pill></td><td className="mono">{r.d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="steps" style={{ marginTop: 10 }}><Pill tone="p-green">녹음 {c.rec}</Pill><Pill tone="p-green">전사 완료</Pill><Pill tone="p-green">AI 분석</Pill><span className="muted" style={{ marginLeft: "auto" }}>{c.n} 학부모</span></div>
      <div className="sec"><h5>요약</h5><ul>{c.s.map((x) => <li key={x}>{x}</li>)}</ul></div>
      <div className="sec warn" style={{ marginBottom: 0 }}><h5>주의 신호</h5>{c.w}</div>
      <FootNote left="녹음에 있는 사실만 씁니다" right={<StuLink n={c.n} />} />
    </>
  );
}
