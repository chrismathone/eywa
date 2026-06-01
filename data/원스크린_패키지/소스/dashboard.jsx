// dashboard.jsx — 학생 로그인 후 누적 현황
const { useState: useStateDB } = React;

function pctOf(sc) { return Math.round((sc / 20) * 100); }

function LineChart({ series }) {
  const W = 600, H = 190, padL = 6, padR = 6, padT = 14, padB = 6;
  const n = series[0].vals.length;
  const x = (i) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / 100) * (H - padT - padB);
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img">
        {[0, 50, 100].map((g) => (
          <line key={g} x1={padL} x2={W - padR} y1={y(g)} y2={y(g)}
            stroke="var(--line)" strokeWidth="1" strokeDasharray={g === 0 ? "0" : "4 5"} />
        ))}
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth={s.primary ? 3 : 2.2}
              strokeLinejoin="round" strokeLinecap="round"
              strokeDasharray={s.primary ? "0" : "1 6"}
              points={s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
            {s.vals.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={i === n - 1 ? 4.5 : 2.6}
                fill={i === n - 1 ? s.color : "var(--surface)"} stroke={s.color} strokeWidth="2" />
            ))}
            {s.primary && (
              <text x={x(n - 1)} y={y(s.vals[n - 1]) - 11} textAnchor="end"
                fontSize="13.5" fontWeight="800" fill={s.color}>{s.vals[n - 1]}%</text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

const ATT_CLS = { "지각": "late", "결석": "absent" };

function Calendar({ history }) {
  const DOW = ["일", "월", "화", "수", "목", "금", "토"];
  const byMonth = {};
  history.forEach((h) => {
    const [m, d] = h.date.split("/").map(Number);
    (byMonth[m] = byMonth[m] || {})[d] = h.attendance;
  });
  const months = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
  return (
    <div className="cal-wrap">
      {months.map((m) => {
        const first = new Date(2026, m - 1, 1).getDay();
        const days = new Date(2026, m, 0).getDate();
        const cells = [];
        for (let i = 0; i < first; i++) cells.push(null);
        for (let d = 1; d <= days; d++) cells.push(d);
        return (
          <div className="cal" key={m}>
            <div className="cal-title">{m}월</div>
            <div className="cal-grid">
              {DOW.map((w, i) => <div key={"d" + i} className={"cal-dow" + (i === 0 ? " sun" : "")}>{w}</div>)}
              {cells.map((d, i) => {
                if (d == null) return <div key={i} className="cal-cell out" />;
                const att = byMonth[m][d];
                const cls = att ? (ATT_CLS[att] || "ok") : "";
                return <div key={i} className={"cal-cell" + (att ? " has " + cls : "")}>{d}</div>;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Dashboard() {
  const [id, setId] = useStateDB("s1");
  const [filt, setFilt] = useStateDB("all");
  const list = window.SEED.STUDENTS;
  const st = list.find((s) => s.id === id);
  const subjNames = st.subjects.map((s) => s.name);
  const activeFilt = subjNames.includes(filt) ? filt : "all";

  const valOf = (h, kind) => {
    if (activeFilt === "all") return h[kind];
    const s = h.subjects.find((x) => x.name === activeFilt);
    return s ? s[kind] : h[kind];
  };
  const primaryColor = activeFilt === "all" ? "var(--accent)" : subjectColor(activeFilt).ink;
  const series = [
    { label: "확인테스트", color: primaryColor, primary: true, vals: st.history.map((h) => pctOf(valOf(h, "check"))) },
    { label: "일일테스트", color: "var(--ink-faint)", primary: false, vals: st.history.map((h) => pctOf(valOf(h, "daily"))) },
  ];

  const attCls = ATT_CLS[st.attendance] || "";
  const recs = [...st.history].reverse();

  const KPI = ({ k, v, u }) => (
    <div className="kpi"><span className="k">{k}</span><span className="v tnum">{v}<small>{u}</small></span></div>
  );

  return (
    <div className="sv-wrap">
      <div className="sv sv--wide">
        <div className="sv-switch dash">
          미리보기
          <select value={id} onChange={(e) => setId(e.target.value)}>
            {list.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.tag})</option>)}
          </select>
        </div>

        <div className="sv-head">
          <span className={"att " + attCls}>{st.attendance}</span>
          <div className="ey">최근 4주 · 학습 누적 현황</div>
          <div className="ttl">{st.name} 님, 환영해요</div>
          <div className="who">{st.grade} {st.tag} · {st.subjects.map((s) => subjectColor(s.name).key).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</div>
        </div>

        <div className="kpi-grid">
          <KPI k="평균 정답률" v={st.stat.avgPct} u="%" />
          <KPI k="출석률" v={st.stat.attRate} u="%" />
          <KPI k="학습 횟수" v={st.stat.sessions} u="회" />
          <KPI k="진도 완료" v={st.stat.currPct} u="%" />
        </div>

        <div className="sv-card">
          <div className="chart-head">
            <div className="sec-ttl" style={{ margin: 0 }}>테스트 점수 추이</div>
            <div className="legend">
              <span><i style={{ background: primaryColor }} />확인</span>
              <span><i style={{ background: "var(--ink-faint)" }} />일일</span>
            </div>
          </div>
          <div className="filt-row">
            <button className={"filt" + (activeFilt === "all" ? " on" : "")}
              style={activeFilt === "all" ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" } : null}
              onClick={() => setFilt("all")}>전체</button>
            {st.subjects.map((su) => {
              const c = subjectColor(su.name);
              const on = activeFilt === su.name;
              return (
                <button key={su.name} className={"filt" + (on ? " on" : "")}
                  style={on ? { background: c.ink, borderColor: c.ink, color: "#fff" } : { color: c.ink }}
                  onClick={() => setFilt(su.name)}>{su.name}</button>
              );
            })}
          </div>
          <LineChart series={series} />
          <div className="chart-x">
            {st.history.map((h, i) => <span key={i}>{h.date}</span>)}
          </div>
        </div>

        <div className="sv-card">
          <div className="sec-ttl">과목별 진도 진척</div>
          {st.curriculum.map((c, i) => {
            const col = subjectColor(c.name);
            const p = Math.round((c.done / c.total) * 100);
            return (
              <div className="cur-row" key={i}>
                <div className="cur-top">
                  <span className="cur-nm" style={{ color: col.ink }}>{c.name}</span>
                  <span className="cur-fr tnum">{c.done}/{c.total}강 · {p}%</span>
                </div>
                <div className="cur-track"><div className="cur-fill" style={{ width: p + "%", background: col.ink }} /></div>
              </div>
            );
          })}
        </div>

        <div className="sv-card">
          <div className="chart-head">
            <div className="sec-ttl" style={{ margin: 0 }}>출결 달력</div>
            <div className="legend">
              <span><i className="dot ok" />출석</span>
              <span><i className="dot late" />지각</span>
              <span><i className="dot absent" />결석</span>
            </div>
          </div>
          <Calendar history={st.history} />
        </div>

        <div className="sv-card">
          <div className="sec-ttl">최근 수업 기록 <span className="hint">· 날짜를 누르면 그날 리포트로</span></div>
          {recs.map((h, i) => {
            const ac = ATT_CLS[h.attendance] || "";
            const absent = h.attendance === "결석";
            return (
              <a className="rec" key={i} href={`학생 리포트.html?student=${id}&date=${encodeURIComponent(h.date)}`}>
                <span className="date tnum">{h.date}</span>
                <span className={"att " + ac} style={{ justifySelf: "start" }}>{h.attendance}</span>
                <span className="scores">
                  <span className={"sc tnum" + (absent ? " muted" : "")}>일일 {absent ? "—" : h.daily}</span>
                  <span className={"sc tnum" + (absent ? " muted" : "")}>확인 {absent ? "—" : h.check}</span>
                </span>
                <span className="chev">›</span>
              </a>
            );
          })}
        </div>

        <div className="sv-foot">원스크린 · 학생 누적 리포트</div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<Dashboard />);
