// parts.jsx — shared components + panels for 선생님 원스크린
const { useState, useRef, useEffect } = React;

/* ---------- helpers ---------- */
function pct(score, max) { return max ? Math.round((score / max) * 100) : 0; }

function DeltaChip({ score, prev }) {
  if (score == null) return null;
  if (prev == null) return null;
  const d = score - prev;
  const cls = d > 0 ? "up" : d < 0 ? "down" : "flat";
  const arrow = d > 0 ? "▲" : d < 0 ? "▼" : "—";
  const txt = d === 0 ? "동일" : `${arrow}${Math.abs(d)}`;
  return <span className={"delta " + cls + " tnum"}>{txt}</span>;
}

function studentStatus(st) {
  // progress
  const prog = st.progressConfirmed ? "ok" : "todo";
  // tests
  const d = st.tests.daily.score != null;
  const c = st.tests.check.score != null;
  const test = d && c ? "ok" : d || c ? "warn" : "todo";
  // report
  const rep = st.reportSent ? "ok" : st.reportDraft && st.reportDraft.trim() ? "warn" : "todo";
  return { prog, test, rep };
}
function isStudentDone(st) {
  const s = studentStatus(st);
  return s.prog === "ok" && s.test === "ok" && s.rep === "ok";
}

/* ---------- report text generator ---------- */
function buildReport(st) {
  const subj = st.subjects.map((s) => `${s.name} ${s.today}`).join(", ");
  const lines = [];
  lines.push(`${st.name} 학생, 오늘 ${subj} 진도를 진행했습니다.`);

  const d = st.tests.daily, c = st.tests.check;
  const tparts = [];
  const dtxt = (t) => {
    if (t.prevScore == null || t.score == null) return "";
    const diff = t.score - t.prevScore;
    if (diff === 0) return " (지난 회차와 동일)";
    return ` (지난 회차 대비 ${diff > 0 ? "▲" : "▼"}${Math.abs(diff)}점)`;
  };
  if (d.score != null) tparts.push(`일일테스트(이전 진도) ${d.score}/${d.max}${dtxt(d)}`);
  if (c.score != null) tparts.push(`확인테스트(오늘 진도) ${c.score}/${c.max}${dtxt(c)}`);
  if (tparts.length) lines.push(tparts.join(", ") + " 결과를 받았습니다.");

  if (st.attitude) lines.push(`수업 태도는 '${st.attitude}', 과제는 ${st.homework} 상태입니다.`);

  // closing by average
  const scores = [d, c].filter((t) => t.score != null);
  if (scores.length) {
    const avg = scores.reduce((a, t) => a + pct(t.score, t.max), 0) / scores.length;
    if (avg >= 90) lines.push("전반적으로 안정적인 성취를 보이고 있습니다. 가정에서도 격려 부탁드립니다.");
    else if (avg >= 70) lines.push("꾸준히 잘 따라오고 있습니다. 오늘 배운 내용 가볍게 점검해 주시면 좋겠습니다.");
    else lines.push("틀린 문항 위주로 복습이 필요해 보입니다. 가정에서도 관심 부탁드립니다.");
  }
  return lines.join(" ");
}

/* ---------- student list row ---------- */
function StudentRow({ st, active, onClick }) {
  const s = studentStatus(st);
  const att = st.attendance;
  const attCls = att === "지각" ? "late" : att === "결석" ? "absent" : "";
  return (
    <button className={"srow" + (active ? " active" : "")} onClick={onClick}>
      <div>
        <div className="srow-name">
          {st.name}
          {att !== "출석" && <span className={"att-flag " + attCls} style={{ marginLeft: 7 }}>{att}</span>}
        </div>
        <div className="srow-meta">
          <span>{st.grade}</span>
          <span className="subj-dots">
            {st.subjects.map((su, i) => {
              const c = subjectColor(su.name);
              return <span key={i} className="sdot" title={su.name} style={{ background: c.ink }} />;
            })}
          </span>
        </div>
      </div>
      <div className="srow-status">
        <span className={"scell " + (s.prog === "ok" ? "ok" : s.prog === "warn" ? "warn" : "")} title="진도">진</span>
        <span className={"scell " + (s.test === "ok" ? "ok" : s.test === "warn" ? "warn" : "")} title="테스트">테</span>
        <span className={"scell " + (s.rep === "ok" ? "ok" : s.rep === "warn" ? "warn" : "")} title="보고서">보</span>
      </div>
    </button>
  );
}

/* ---------- progress ---------- */
function ProgressCard({ st, onConfirm }) {
  return (
    <div className="card">
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <div className="eyebrow">진도 확인</div>
          <div className="card-title">오늘 어디까지 나갔나요</div>
        </div>
        <button
          className={"btn sm " + (st.progressConfirmed ? "ghost" : "primary")}
          onClick={onConfirm}
        >
          {st.progressConfirmed ? "✓ 확정됨" : "오늘 진도 확정"}
        </button>
      </div>
      <div className="card-pad" style={{ paddingTop: 4, paddingBottom: 6 }}>
        {st.subjects.map((su, i) => {
          const c = subjectColor(su.name);
          return (
            <div className="subj-row" key={i}>
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span className="subj-bar" style={{ background: c.ink }} />
                <div>
                  <div className="subj-name" style={{ color: c.ink }}>{su.name}</div>
                  <div className="subj-flow">
                    <span className="subj-prev">{su.prev}</span>
                    <span className="subj-arrow" style={{ color: c.ink }}>→</span>
                    <span className="subj-today">{su.today}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- score block ---------- */
function ScoreBlock({ kicker, range, test, onChange, focus }) {
  const empty = test.score == null;
  const setVal = (v) => {
    if (v === "" || v == null) return onChange(null);
    let n = parseInt(v, 10);
    if (isNaN(n)) return;
    n = Math.max(0, Math.min(test.max, n));
    onChange(n);
  };
  return (
    <div className={"score-block" + (focus ? " focus" : "")}>
      <div className="score-label">
        <span className="score-kicker">{kicker}</span>
        <span className="score-range">{range}</span>
      </div>
      <div className="score-entry">
        <input
          className={"score-input tnum" + (empty ? " empty" : "")}
          inputMode="numeric"
          value={empty ? "" : test.score}
          placeholder="—"
          onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))}
        />
        <span className="score-max tnum">/ {test.max}</span>
        <div className="score-step">
          <button className="stepbtn" onClick={() => setVal((test.score ?? 0) + 1)}>▲</button>
          <button className="stepbtn" onClick={() => setVal((test.score ?? 0) - 1)}>▼</button>
        </div>
        {!empty && <DeltaChip score={test.score} prev={test.prevScore} />}
        {!empty && <span className="score-note tnum">{pct(test.score, test.max)}%</span>}
      </div>
    </div>
  );
}

/* ---------- test card ---------- */
function TestCard({ st, onScore }) {
  const todayRange = st.subjects.map((s) => s.today.split("·")[0].trim()).join(" / ");
  const prevRange = st.subjects.map((s) => s.prev.split("·")[0].trim()).join(" / ");
  return (
    <div className="card">
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <div className="eyebrow">데일리 · 확인 테스트</div>
          <div className="card-title">점수 입력</div>
        </div>
        <div className="card-sub">맞은 개수만 입력</div>
      </div>
      <div className="card-pad" style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
        <ScoreBlock
          kicker="일일테스트"
          range={"이전 진도 · " + prevRange}
          test={st.tests.daily}
          focus
          onChange={(v) => onScore("daily", v)}
        />
        <ScoreBlock
          kicker="확인테스트"
          range={"오늘 진도 · " + todayRange}
          test={st.tests.check}
          onChange={(v) => onScore("check", v)}
        />
      </div>
    </div>
  );
}

Object.assign(window, {
  pct, DeltaChip, studentStatus, isStudentDone, buildReport,
  StudentRow, ProgressCard, ScoreBlock, TestCard,
});
