"use client";

import { useEffect, useState } from "react";
import { CLASSES, DATES, DAYS, HOLIDAYS, PAST, PERIODS, ST_LABEL, STUDENTS, TODAY, classAtt, type Att } from "./data";
import { parseAtt } from "./rooms";
import { Dots, FootNote, Pill, StuLink, SubjPill, WDays, useDesk } from "./bits";

/** 2F 수학 교실 — 출석부·시간표·수업목록. 출석부 칸을 누르면 운영실·시간표 숫자가 같이 바뀐다. */
export function AttWin({ arg }: { arg: string | null }) {
  const { data, act } = useDesk();
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 900);
    return () => clearTimeout(t);
  }, [saved]);
  const x = parseAtt(arg), c = CLASSES[x.k], o = data.att[x.k][x.d] ?? {}, future = x.d > TODAY;
  const per = PERIODS[c.slots.find((s) => s[0] === x.d)?.[1] ?? 0];
  const key = `${x.k}@${x.d}`;
  const cnt: Record<Att, number> = { p: 0, a: 0, l: 0, "": 0 };
  for (const n of c.roster) cnt[o[n] ?? ""]++;
  const touch = () => setSaved((v) => v + 1);
  return (
    <>
      <div className="att-head">
        <SubjPill s={c.subj} /><b>{c.name}</b><span className="when">{c.t} · {c.room} · {per[0]}–{per[1]}</span>
        <span className="att-legend">
          <span className="lg"><i style={{ background: "var(--att-p)" }} />출석</span>
          <span className="lg"><i style={{ background: "var(--att-a)" }} />결석</span>
          <span className="lg"><i style={{ background: "var(--att-l)" }} />지각</span>
        </span>
      </div>
      <table className="mini-t att-t">
        <thead><tr><th>이름</th><th>학교·학년</th><th>지난 수업</th><th>{DATES[x.d]}{x.d === TODAY ? " 오늘" : ""}</th></tr></thead>
        <tbody>
          {c.roster.map((n) => {
            const s = o[n] ?? "";
            return (
              <tr key={n}>
                <td><StuLink n={n} /></td><td>{STUDENTS[n].sg}</td><td><Dots past={PAST[n] ?? []} /></td>
                <td className="cellwrap">
                  <button type="button" className={`acell ${s}`} disabled={future} aria-label={`${n} 출결: ${ST_LABEL[s]}`}
                    onClick={() => { act.cycleCell(key, n); touch(); }}>{future ? "수업 전" : ST_LABEL[s]}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="att-sum">
        <Pill tone="p-green">출석 {cnt.p}</Pill><Pill tone="p-danger">결석 {cnt.a}</Pill><Pill tone="p-amber">지각 {cnt.l}</Pill><Pill tone="p-neutral">미입력 {cnt[""]}</Pill>
        <span className="row" style={{ marginLeft: "auto" }}>
          <span className={`saved${saved ? " on" : ""}`}>입력됨</span>
          {future ? null : <button type="button" className="sbtn" onClick={() => { act.fillPresent(key); touch(); }}>남은 칸 출석</button>}
        </span>
      </div>
      <FootNote left={future ? "수업 날에 입력합니다" : "칸을 누르면 출석 → 결석 → 지각 순서로 바뀝니다"} right="예시 · 저장 안 됨" />
    </>
  );
}

export function TtWin() {
  const { data, act, openAtt, openStudent } = useDesk();
  const f = data.ttFilter;
  const grid = new Map<string, string>();
  for (const [k, c] of Object.entries(CLASSES)) for (const [d, r] of c.slots) grid.set(`${d}-${r}`, k);
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8, flexWrap: "wrap" }}>
        <span className="muted">9월 21일 – 25일</span>
        <div className="chipbar">
          {([["all", "전체"], ["math", "수학"], ["eng", "영어"]] as const).map(([v, l]) => (
            <button key={v} type="button" className={`chip${f === v ? " on" : ""}`} aria-pressed={f === v} onClick={() => act.setTtFilter(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="tt">
        <div className="h" />
        {DAYS.map((d, i) => <div key={d} className={`h${i === TODAY ? " today" : ""}${HOLIDAYS[i] ? " hol" : ""}`}>{d}<small>{DATES[i]}{HOLIDAYS[i] ? ` ${HOLIDAYS[i]}` : ""}</small></div>)}
        {PERIODS.map((p, r) => [
          <div key={`p${r}`} className="pt">{p[0]}<br /><span>~{p[1]}</span></div>,
          ...DAYS.map((d, i) => {
            const k = grid.get(`${i}-${r}`);
            let cell = null;
            if (HOLIDAYS[i]) cell = r === 0 ? <span className="holtag">휴원</span> : null;
            else if (k) {
              const c = CLASSES[k], ca = i === TODAY ? classAtt(data.att, k, i) : null;
              cell = (
                <button type="button" className={`blk s-${c.subj}${f !== "all" && c.subj !== f ? " dim" : ""}`} title={`${c.name} · ${c.room} — 출석부 열기`} onClick={() => openAtt(k, i)}>
                  <b>{c.name}</b><span>{c.t}</span>{ca ? <span className={`att${ca.f === ca.t ? " done" : ""}`}>출결 {ca.f}/{ca.t}</span> : <em>{c.roster.length}명</em>}
                </button>
              );
            } else if (i === 2 && r === 0 && f !== "eng") {
              cell = <button type="button" className="blk makeup" title="보강 예약 — 원생 정보 열기" onClick={() => openStudent("김하늘")}><b>보강 예약</b><span>중2 A반 · 김하늘</span><em>1명</em></button>;
            }
            return <div key={`${d}${r}`} className={`c${i === TODAY ? " today" : ""}${HOLIDAYS[i] ? " hol" : ""}`}>{cell}</div>;
          }),
        ])}
      </div>
      <FootNote left="반을 누르면 그 반 출석부가 열립니다" right="반 6개 · 추석 연휴 9/24–26" />
    </>
  );
}

export function ClassesWin() {
  const { openAtt } = useDesk();
  return (
    <>
      <table className="mini-t">
        <thead><tr><th>과목</th><th>반 이름</th><th>담임</th><th>요일</th><th>인원</th></tr></thead>
        <tbody>
          {Object.entries(CLASSES).map(([k, c]) => {
            const days = c.slots.map((s) => s[0]).sort();
            const d = days.includes(TODAY) ? TODAY : days[0];
            return (
              <tr key={k} className="clk" tabIndex={0} onClick={() => openAtt(k, d)} onKeyDown={(e) => { if (e.key === "Enter") openAtt(k, d); }}>
                <td><SubjPill s={c.subj} /></td><td><b>{c.name}</b></td><td>{c.t}</td><td><WDays slots={c.slots} /></td><td className="num">{c.roster.length}명</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <FootNote left="줄을 누르면 출석부가 열립니다" />
    </>
  );
}
