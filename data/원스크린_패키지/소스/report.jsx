// report.jsx — today 보고서 작성/발송
const { useState: useStateR } = React;

function MiniSummary({ st }) {
  const d = st.tests.daily, c = st.tests.check;
  const fmt = (t) => (t.score == null ? "미입력" : `${t.score}/${t.max}`);
  return (
    <div style={{ marginBottom: 12 }}>
      <div className="kv"><span className="kv-k">오늘 진도</span>
        <span style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {st.subjects.map((s, i) => {
            const c = subjectColor(s.name);
            return <span key={i} className="subj-chip" style={{ color: c.ink, background: c.soft }}>{c.key} · {s.today}</span>;
          })}
        </span>
      </div>
      <div className="kv"><span className="kv-k">일일테스트</span><span className="kv-v tnum">{fmt(d)} {d.score != null && <DeltaChip score={d.score} prev={d.prevScore} />}</span></div>
      <div className="kv"><span className="kv-k">확인테스트</span><span className="kv-v tnum">{fmt(c)} {c.score != null && <DeltaChip score={c.score} prev={c.prevScore} />}</span></div>
      <div className="kv"><span className="kv-k">태도 · 과제</span><span className="kv-v">{st.attitude || "—"} · {st.homework}</span></div>
    </div>
  );
}

function ReportCard({ st, attitudes, onAttitude, onDraft, onSend, onToast }) {
  const draft = st.reportDraft || "";
  const auto = () => onDraft(buildReport(st));
  const sendable = draft.trim().length > 0;

  const fireSend = (channel) => {
    if (!sendable) { auto(); }
    onSend();
    onToast(channel === "pdf" ? "보고서를 PDF로 내보냈습니다" : channel === "save" ? "내부 기록에 저장했습니다" : `${st.name} 학부모님께 ${channel} 발송했습니다`);
  };

  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <div className="eyebrow">today 보고서</div>
          <div className="card-title">{st.name} · 학부모 보고</div>
        </div>
        {st.reportSent && <span className="att-flag" style={{ color: "var(--accent-ink)", background: "var(--ok-soft)", border: "none", fontSize: 11, padding: "3px 8px" }}>발송 완료</span>}
      </div>

      <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0 }}>
        <MiniSummary st={st} />

        <div>
          <div className="field-label" style={{ marginBottom: 7 }}>수업 태도</div>
          <div className="chips">
            {attitudes.map((a) => (
              <button key={a} className={"chip" + (st.attitude === a ? " on" : "")} onClick={() => onAttitude(a)}>{a}</button>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 7, flex: 1, minHeight: 110 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span className="field-label">보고서 내용</span>
            <button className="btn ghost sm" onClick={auto}>✦ 자동 작성</button>
          </div>
          <textarea
            className="report-area"
            value={draft}
            placeholder="‘자동 작성’을 누르면 오늘 진도·테스트·태도를 합쳐 초안을 만들어 줍니다. 그대로 보내거나 수정하세요."
            onChange={(e) => onDraft(e.target.value)}
          />
        </div>

        <div className="btn-row">
          <button className="btn primary" onClick={() => fireSend("카카오톡")}>카톡 발송</button>
          <button className="btn" onClick={() => fireSend("문자")}>문자</button>
          <button className="btn ghost" onClick={() => fireSend("pdf")}>PDF</button>
          <button className="btn ghost" onClick={() => fireSend("save")}>저장</button>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { ReportCard, MiniSummary });
