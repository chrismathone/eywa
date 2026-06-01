// student.jsx — 학생/학부모용 읽기 전용 리포트
const { useState: useStateSV } = React;

function pctSV(s, m) { return m ? Math.round((s / m) * 100) : 0; }
function perfColor(p) { return p >= 80 ? "var(--accent)" : p >= 60 ? "#c9962f" : "#c25540"; }

function SVTest({ kick, sub, test }) {
  if (test.score == null) {
    return (
      <div className="sv-tb pending">
        <div className="lab"><span className="kick">{kick}</span><span className="sub">{sub}</span></div>
        <div className="pendtxt">아직 점수가 입력되지 않았어요.</div>
      </div>
    );
  }
  const p = pctSV(test.score, test.max);
  const col = perfColor(p);
  return (
    <div className="sv-tb">
      <div className="lab"><span className="kick">{kick}</span><span className="sub">{sub}</span></div>
      <div className="row">
        <span className="score tnum" style={{ color: col }}>{test.score}</span>
        <span className="max tnum">/ {test.max}</span>
        <DeltaChip score={test.score} prev={test.prevScore} />
        <span className="pct tnum">{p}%</span>
      </div>
      <div className="track"><div className="fill" style={{ width: p + "%", background: col }} /></div>
    </div>
  );
}

function StudentView() {
  const params = new URLSearchParams(window.location.search);
  const list = window.SEED.STUDENTS;
  const [id, setId] = useStateSV(params.get("student") || "s1");
  const [date, setDate] = useStateSV(params.get("date") || null);

  const st = list.find((s) => s.id === id) || list[0];
  const session = window.findSession(st, date);
  const isLatest = session === st.history[st.history.length - 1];
  const view = window.sessionStudent(st, session);
  const note = view.reportSent ? buildReport(view) : "";
  const attCls = view.attendance === "지각" ? "late" : view.attendance === "결석" ? "absent" : "";
  const headDate = isLatest ? window.SEED.TODAY : `2026년 ${window.dateKo(session.date)}`;

  return (
    <div className="sv-wrap">
      <div className="sv">
        <div className="sv-topnav">
          <a className="sv-back" href={`내 학습 현황.html?student=${id}`}>← 누적 현황</a>
          <span className="sv-switch">
            미리보기
            <select value={id} onChange={(e) => setId(e.target.value)}>
              {list.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.tag})</option>)}
            </select>
          </span>
        </div>

        <div className="sv-head">
          <span className={"att " + attCls}>{view.attendance}</span>
          <div className="ey">{headDate} · {isLatest ? "오늘" : "지난"} 데일리 리포트</div>
          <div className="ttl">오늘의 학습 리포트</div>
          <div className="who">{st.name} · {st.grade} {st.tag}</div>
        </div>

        <div className="sv-card">
          <div className="sec-ttl">오늘 배운 내용</div>
          {view.subjects.map((su, i) => {
            const c = subjectColor(su.name);
            return (
              <div className="sv-subj" key={i}>
                <span className="bar" style={{ background: c.ink }} />
                <div>
                  <div className="nm" style={{ color: c.ink }}>{su.name}</div>
                  <div className="flow">
                    <span className="prev">{su.prev}</span>
                    <span className="arr" style={{ color: c.ink }}>→</span>
                    <span className="now">{su.today}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sv-card">
          <div className="sec-ttl">오늘의 테스트</div>
          <div className="sv-test">
            <SVTest kick="일일테스트" sub="이전 진도 복습" test={view.tests.daily} />
            <SVTest kick="확인테스트" sub="오늘 진도" test={view.tests.check} />
          </div>
        </div>

        <div className="sv-card sv-note">
          <div className="sec-ttl">선생님 한마디</div>
          {note
            ? <div className="body">{note}</div>
            : <div className="sv-empty">아직 선생님이 작성 중이에요. 잠시만 기다려 주세요.</div>}
          <div className="sv-meta">
            <span className="sv-tag">수업 태도 <b>{view.attitude || "—"}</b></span>
            <span className="sv-tag">과제 <b>{view.homework}</b></span>
          </div>
        </div>

        <div className="sv-foot">원스크린 · 학생 리포트</div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<StudentView />);
