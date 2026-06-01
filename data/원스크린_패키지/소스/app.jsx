// app.jsx — 선생님 원스크린 main
const { useState, useEffect, useMemo } = React;

/* base tone (크롬은 중립, 색은 과목이 가짐) */
const BASES = {
  cool: { label: "쿨 그레이", "--paper": "#f3f5f8", "--surface": "#ffffff", "--surface-2": "#eceff3", "--ink": "#1d2128", "--ink-soft": "#525a66", "--ink-faint": "#8b929e", "--line": "#e3e7ed", "--line-strong": "#d2d8e1", "--accent": "#2f8a55", "--accent-ink": "#1f6b40", "--accent-soft": "#e1f0e7", "--ok": "#2f8a55", "--ok-soft": "#e1f0e7" },
  warm: { label: "움 페이퍼", "--paper": "#f6f4ee", "--surface": "#fcfbf7", "--surface-2": "#f1eee5", "--ink": "#211d17", "--ink-soft": "#5c5547", "--ink-faint": "#948c7c", "--line": "#e3ddcf", "--line-strong": "#d3cbb8", "--accent": "#2f6e4f", "--accent-ink": "#1f4d36", "--accent-soft": "#e4ede6", "--ok": "#2f6e4f", "--ok-soft": "#e4ede6" },
};

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "base": "cool",
  "density": "compact",
  "layout": "stacked"
}/*EDITMODE-END*/;

function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", zIndex: 50,
      background: "var(--ink)", color: "var(--paper)", padding: "11px 18px", borderRadius: 10,
      fontSize: 13.5, fontWeight: 600, boxShadow: "0 8px 24px rgba(0,0,0,.18)", display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--accent)" }}>✓</span>{msg}
    </div>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const [students, setStudents] = useState(() =>
    window.SEED.STUDENTS.map((s) => ({
      ...s,
      progressConfirmed: ["s1", "s4", "s7"].includes(s.id),
      reportDraft: s.reportSent ? buildReport(s) : "",
    }))
  );
  const [selId, setSelId] = useState("s1");
  const [classFilter, setClassFilter] = useState("전체");
  const [toast, setToast] = useState("");
  const [winW, setWinW] = useState(typeof window !== "undefined" ? window.innerWidth : 1440);

  useEffect(() => {
    const r = () => setWinW(window.innerWidth);
    window.addEventListener("resize", r);
    return () => window.removeEventListener("resize", r);
  }, []);

  const showToast = (m) => { setToast(m); clearTimeout(window.__tt); window.__tt = setTimeout(() => setToast(""), 2400); };

  const classes = useMemo(() => ["전체", ...Array.from(new Set(students.map((s) => s.tag)))], [students]);
  const visible = students.filter((s) => classFilter === "전체" || s.tag === classFilter);
  const sel = students.find((s) => s.id === selId);

  const doneCount = students.filter(isStudentDone).length;

  const update = (id, patch) => setStudents((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateFn = (id, fn) => setStudents((prev) => prev.map((s) => (s.id === id ? fn(s) : s)));

  const onScore = (id, which, val) =>
    updateFn(id, (s) => ({ ...s, tests: { ...s.tests, [which]: { ...s.tests[which], score: val } } }));

  // effective layout: collapse to stacked on narrow viewports
  const effLayout = winW < 1080 ? "stacked" : t.layout;
  const pal = BASES[t.base] || BASES.cool;
  const rootStyle = { ...pal };

  const Header = sel && (
    <div className="card">
      <div className="detail-id">
        <div>
          <div className="detail-name">{sel.name}</div>
          <div className="detail-meta">{sel.grade} · {sel.tag} · {sel.attendance}</div>
        </div>
      </div>
    </div>
  );

  const Progress = sel && <ProgressCard st={sel} onConfirm={() => update(sel.id, { progressConfirmed: !sel.progressConfirmed })} />;
  const Test = sel && <TestCard st={sel} onScore={(w, v) => onScore(sel.id, w, v)} />;
  const Report = sel && (
    <ReportCard
      st={sel}
      attitudes={window.SEED.ATTITUDE}
      onAttitude={(a) => update(sel.id, { attitude: a })}
      onDraft={(d) => update(sel.id, { reportDraft: d })}
      onSend={() => update(sel.id, { reportSent: true })}
      onToast={showToast}
    />
  );

  return (
    <div className="app" data-density={t.density} style={rootStyle}>
      {/* top bar */}
      <div className="topbar">
        <div className="brand">
          <span className="brand-mark">원스크린<span className="dot">.</span></span>
          <span className="brand-sub">수업 마감 워크스페이스</span>
        </div>
        <div className="ctx-chip">📅 <b>{window.SEED.TODAY}</b></div>
        <div style={{ display: "flex", gap: 6 }}>
          {classes.map((c) => (
            <button key={c} className={"chip" + (classFilter === c ? " on" : "")} style={{ padding: "5px 12px", fontSize: 12.5 }}
              onClick={() => setClassFilter(c)}>{c}</button>
          ))}
        </div>
        <div className="topbar-spacer" />
        <div className="dayprog">
          <span>오늘 마감 <b className="tnum" style={{ color: "var(--ink)" }}>{doneCount}/{students.length}</b></span>
          <div className="dayprog-bar"><div className="dayprog-fill" style={{ width: `${(doneCount / students.length) * 100}%` }} /></div>
        </div>
      </div>

      {/* main */}
      <div className="main" data-layout={effLayout}>
        {/* list */}
        <div className="col">
          <div className="card" style={{ flex: 1, minHeight: 0 }}>
            <div className="list-head">
              <span className="list-title">학생 {visible.length}명</span>
              <span className="card-sub">진 · 테 · 보</span>
            </div>
            <div className="list-scroll" style={{ flex: 1 }}>
              {visible.map((s) => (
                <StudentRow key={s.id} st={s} active={s.id === selId} onClick={() => setSelId(s.id)} />
              ))}
            </div>
          </div>
        </div>

        {!sel ? (
          <div className="col"><div className="card empty-detail">학생을 선택하세요</div></div>
        ) : effLayout === "split" ? (
          <>
            <div className="col scroll">
              {Header}
              {Progress}
              {Test}
            </div>
            <div className="col report-col">{Report}</div>
          </>
        ) : (
          <div className="col scroll">
            <div className="detail-stack">
              {Header}
              {Progress}
              {Test}
              {Report}
            </div>
          </div>
        )}
      </div>

      <Toast msg={toast} />

      {/* tweaks */}
      <TweaksPanel>
        <TweakSection label="화면" />
        <TweakRadio label="레이아웃" value={t.layout} options={["split", "stacked"]}
          onChange={(v) => setTweak("layout", v)} />
        <TweakRadio label="밀도" value={t.density} options={["regular", "compact"]}
          onChange={(v) => setTweak("density", v)} />
        <TweakSection label="베이스 톤" />
        <TweakRadio label="배경" value={t.base} options={["cool", "warm"]}
          onChange={(v) => setTweak("base", v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
