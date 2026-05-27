// screens-a.jsx — 4 screens: dashboard / timetable / attendance / classes

// ──────────────────────────────────────────────────────────────────────
// 1) 대시보드
// ──────────────────────────────────────────────────────────────────────
function ScreenDashboard() {
  const kpis = [
    { label: '재원생',         value: '248',  unit: '명',  delta: '+12',    up: true,  helper: '신규 14 · 퇴원 2',         color: S.primary, icon: 'seed' },
    { label: '오늘 출석률',     value: '94.2', unit: '%',   delta: '+1.8pt', up: true,  helper: '234/248 · 결석 9',         color: S.blue,    icon: 'pulse' },
    { label: '이번달 수납률',   value: '87.1', unit: '%',   delta: '-2.4pt', up: false, helper: '216/248 · 미수 32',         color: S.gold,    icon: 'pollen' },
    { label: '진행중 상담',     value: '11',   unit: '건',  delta: '+3',     up: true,  helper: 'AI 분석 대기 4',           color: S.purple,  icon: 'sprout' },
  ];

  const events = EYWA_DATA.events;
  const TYPE = {
    class:   { color: S.primary, icon: 'leaf', name: '수업' },
    consult: { color: S.rose,    icon: 'wave', name: '상담' },
    meeting: { color: S.amber,   icon: 'rings', name: '회의' },
  };

  return (
    <AppShell active="dashboard" title="대시보드" breadcrumb="EYWA · 홈"
      actions={<PrimaryButton icon="sparkle">AI 인사이트</PrimaryButton>}>

      {/* Greeting hero */}
      <Card style={{ marginBottom: 18, padding: '24px 28px', position: 'relative', overflow: 'hidden' }}>
        <svg width="220" height="220" viewBox="0 0 220 220"
          style={{ position: 'absolute', right: -30, top: -50, opacity: 0.5 }}>
          {[28, 56, 88, 124, 160].map((r, i) => (
            <circle key={i} cx="110" cy="110" r={r} fill="none" stroke={S.primary} strokeWidth={i === 0 ? 1.6 : 0.6} opacity={0.18 + (i === 0 ? 0.3 : 0)} />
          ))}
          <circle cx="110" cy="110" r="10" fill={S.gold} />
        </svg>
        <div style={{ position: 'relative' }}>
          <div style={{ fontSize: 11, color: S.primary, fontFamily: S.fontMono, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 }}>2026 · 05 · 27 · 水 · 학원 17일째</div>
          <h1 style={{ fontSize: 30, fontWeight: 800, color: S.text, margin: 0, letterSpacing: -1, lineHeight: 1.15 }}>
            안녕하세요, <span style={{ color: S.primary }}>김수진</span> 원장님.
          </h1>
          <p style={{ fontSize: 13, color: S.textDim, marginTop: 8, lineHeight: 1.6, maxWidth: 540, margin: '8px 0 0' }}>
            오늘 출석률은 평소보다 1.8pt 올랐어요. 수납률이 살짝 떨어졌으니 미수금 32건은 한번 살펴보세요.
          </p>
        </div>
      </Card>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 18 }}>
        {kpis.map((k, i) => (
          <Card key={i} padding={20} style={{ position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', top: -30, right: -30, width: 100, height: 100,
              borderRadius: '50%', background: `${k.color}14`, filter: 'blur(4px)',
            }} />
            <div style={{ position: 'relative', display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase' }}>{k.label}</div>
              <div style={{
                width: 26, height: 26, borderRadius: 7,
                background: `${k.color}18`, color: k.color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}><EyIcon name={k.icon} size={13} /></div>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <div style={{ fontSize: 32, fontWeight: 800, color: S.text, letterSpacing: -0.8, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{k.value}</div>
              <div style={{ fontSize: 12, color: S.textDim, fontWeight: 600 }}>{k.unit}</div>
            </div>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
              <span style={{
                fontSize: 11, padding: '2px 7px', borderRadius: 999, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                background: k.up ? S.primarySoft : S.dangerSoft, color: k.up ? S.primary : S.danger,
                display: 'inline-flex', alignItems: 'center', gap: 3,
              }}><EyIcon name={k.up ? 'arrowUp' : 'arrowDown'} size={10} />{k.delta}</span>
              <span style={{ fontSize: 11, color: S.textFaint }}>지난 주</span>
            </div>
            <div style={{ position: 'relative', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${S.line}`, fontSize: 11, color: S.textDim, lineHeight: 1.5 }}>
              {k.helper}
            </div>
          </Card>
        ))}
      </div>

      {/* Timeline + Announcements */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 14 }}>
        <Card padding={0}>
          <div style={{ padding: '18px 22px 14px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', borderBottom: `1px solid ${S.line}` }}>
            <div>
              <div style={{ fontSize: 11, color: S.primary, fontFamily: S.fontMono, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>오늘 · 5월 27일</div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: S.text, margin: 0, letterSpacing: -0.3 }}>오늘의 일정</h2>
            </div>
            <Pill color={S.rose}>● 진행 중 1건</Pill>
          </div>
          <div style={{ padding: '6px 22px 18px' }}>
            {events.map((e, i) => {
              const meta = TYPE[e.type];
              const done = e.status === 'done';
              const now = e.status === 'ongoing';
              return (
                <div key={e.id} style={{
                  display: 'flex', gap: 14, alignItems: 'stretch',
                  padding: '8px 0', opacity: done ? 0.55 : 1,
                }}>
                  <div style={{ width: 54, flexShrink: 0, fontFamily: S.fontMono, fontSize: 12, color: done ? S.textFaint : S.text, paddingTop: 10, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                    <div style={{ textDecoration: done ? 'line-through' : 'none', fontWeight: 600 }}>{e.time}</div>
                    <div style={{ fontSize: 10, color: S.textFaint, marginTop: 2 }}>{e.mins}분</div>
                  </div>
                  <div style={{
                    flex: 1, borderRadius: 12, padding: '10px 14px',
                    background: now ? `${meta.color}0d` : S.bgSoft,
                    border: now ? `1.5px solid ${meta.color}` : `1px solid ${S.line}`,
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}>
                    <div style={{ width: 32, height: 32, borderRadius: 10, background: `${meta.color}1f`, color: meta.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <EyIcon name={meta.icon} size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 13, color: S.text, fontWeight: 600 }}>{e.title}</div>
                        {now && <Pill color={meta.color} soft={false} style={{ fontSize: 9 }}>NOW</Pill>}
                      </div>
                      <div style={{ fontSize: 11, color: S.textDim, marginTop: 2 }}>{e.ctx}</div>
                    </div>
                    {e.room && <div style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>{e.room}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card padding={0}>
          <div style={{ padding: '18px 22px 14px', borderBottom: `1px solid ${S.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, color: S.amber, fontFamily: S.fontMono, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 4 }}>공지</div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: S.text, margin: 0, letterSpacing: -0.3 }}>최근 알림</h2>
            </div>
            <GhostButton icon="plus" style={{ padding: '6px 10px', fontSize: 11 }}>새 공지</GhostButton>
          </div>
          <div style={{ padding: '6px 22px 14px' }}>
            {EYWA_DATA.announcements.map((a, i) => (
              <div key={a.id} style={{
                padding: '14px 0', borderBottom: i < EYWA_DATA.announcements.length - 1 ? `1px solid ${S.line}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Pill color={i === 0 ? S.amber : (i === 1 ? S.blue : S.textDim)} style={{ fontSize: 10 }}>{a.tag}</Pill>
                  <span style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>{a.when}</span>
                </div>
                <div style={{ fontSize: 13, color: S.text, fontWeight: 600, lineHeight: 1.4 }}>{a.title}</div>
                <div style={{ fontSize: 11, color: S.textDim, marginTop: 4 }}>{a.author}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 2) 시간표
// ──────────────────────────────────────────────────────────────────────
function ScreenTimetable() {
  const days = ['월', '화', '수', '목', '금', '토'];
  const hours = ['14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00'];

  // sample blocks — { day, start (hr index), span, title, room, teacher, color }
  const blocks = [
    { day: 0, start: 0, span: 2, title: '중2 수학 심화 A', room: '301호', teacher: '박지훈', color: S.primary, students: 12 },
    { day: 0, start: 3, span: 2, title: '고1 영어 정규 B', room: '205호', teacher: '이연우', color: S.blue,    students: 10 },
    { day: 1, start: 1, span: 2, title: '중3 수학 심화 C', room: '301호', teacher: '박지훈', color: S.primary, students: 14 },
    { day: 1, start: 5, span: 2, title: '고2 국어 정규',   room: '404호', teacher: '최보라', color: S.purple,  students: 8  },
    { day: 2, start: 0, span: 1.5, title: '중2 수학 심화 A', room: '301호', teacher: '박지훈', color: S.primary, students: 12, current: true },
    { day: 2, start: 2, span: 2, title: '고1 영어 정규 B', room: '205호', teacher: '이연우', color: S.blue,    students: 10 },
    { day: 2, start: 5, span: 1.5, title: '중3 수학 심화 C', room: '301호', teacher: '박지훈', color: S.primary, students: 14 },
    { day: 2, start: 6.5, span: 0.5, title: '강사 회의', room: '회의실', teacher: '전체', color: S.amber,   students: 0, mini: true },
    { day: 3, start: 0, span: 2, title: '중2 수학 심화 A', room: '301호', teacher: '박지훈', color: S.primary, students: 12 },
    { day: 3, start: 4, span: 2, title: '고2 국어 정규',   room: '404호', teacher: '최보라', color: S.purple,  students: 8  },
    { day: 4, start: 1, span: 2, title: '중3 수학 심화 C', room: '301호', teacher: '박지훈', color: S.primary, students: 14 },
    { day: 4, start: 3, span: 2, title: '고1 영어 정규 B', room: '205호', teacher: '이연우', color: S.blue,    students: 10 },
    { day: 5, start: 0, span: 4, title: '주말 보강반', room: '301호', teacher: '박지훈', color: S.gold,    students: 24 },
  ];

  const cellH = 56; // px per hour row
  const headerH = 36;

  return (
    <AppShell active="timetable" title="시간표" breadcrumb="EYWA · 수업 · 시간표"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="arrowRight">이번 주</GhostButton>
          <PrimaryButton icon="plus">수업 추가</PrimaryButton>
        </div>
      }>

      {/* Filter strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, padding: '12px 18px', background: S.surface, borderRadius: 12, border: `1px solid ${S.line}` }}>
        <div style={{ fontSize: 12, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 0.5 }}>2026.05.25 — 05.30</div>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {[
            ['수업', S.primary],
            ['영어', S.blue],
            ['국어', S.purple],
            ['특강', S.gold],
            ['회의', S.amber],
          ].map(([n, c]) => (
            <span key={n} style={{ fontSize: 11, color: S.text, display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: S.fontMono }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />{n}
            </span>
          ))}
        </div>
        <GhostButton icon="search" style={{ padding: '7px 11px', fontSize: 12 }}>필터</GhostButton>
      </div>

      <Card padding={0} style={{ overflow: 'hidden' }}>
        {/* Day header */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(6, 1fr)', borderBottom: `1px solid ${S.line}`, background: S.bgSoft }}>
          <div style={{ height: headerH }} />
          {days.map((d, i) => (
            <div key={d} style={{
              height: headerH, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              borderLeft: `1px solid ${S.line}`,
              fontSize: 12, fontWeight: i === 2 ? 700 : 600, color: i === 2 ? S.primary : S.text,
              background: i === 2 ? S.primarySofter : 'transparent',
            }}>
              <span>{d}</span>
              <span style={{ fontSize: 11, fontFamily: S.fontMono, color: i === 2 ? S.primary : S.textFaint, fontWeight: 600 }}>0{25 + i}</span>
            </div>
          ))}
        </div>
        {/* Body */}
        <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: '60px repeat(6, 1fr)' }}>
          {/* time column */}
          <div>
            {hours.map((h, i) => (
              <div key={h} style={{
                height: cellH, padding: '4px 8px 0', textAlign: 'right',
                fontSize: 10, color: S.textFaint, fontFamily: S.fontMono,
                borderBottom: `1px solid ${S.line}`,
              }}>{h}</div>
            ))}
          </div>
          {/* day columns */}
          {days.map((d, di) => (
            <div key={d} style={{ position: 'relative', borderLeft: `1px solid ${S.line}` }}>
              {hours.map((_, hi) => (
                <div key={hi} style={{
                  height: cellH, borderBottom: `1px solid ${S.line}`,
                  background: di === 2 && hi === 1 ? `${S.primary}06` : 'transparent',
                }} />
              ))}
              {blocks.filter((b) => b.day === di).map((b, bi) => (
                <div key={bi} style={{
                  position: 'absolute', left: 4, right: 4,
                  top: b.start * cellH + 4, height: b.span * cellH - 8,
                  background: b.current ? b.color : `${b.color}14`,
                  color: b.current ? '#fff' : b.color,
                  borderRadius: 8, padding: b.mini ? '4px 8px' : '8px 10px',
                  border: b.current ? 'none' : `1px solid ${b.color}30`,
                  borderLeft: b.current ? 'none' : `3px solid ${b.color}`,
                  boxShadow: b.current ? `0 6px 16px ${b.color}55` : 'none',
                  display: 'flex', flexDirection: 'column', gap: b.mini ? 0 : 4, overflow: 'hidden',
                }}>
                  <div style={{
                    fontSize: b.mini ? 11 : 12, fontWeight: 700, color: b.current ? '#fff' : S.text,
                    letterSpacing: -0.2, lineHeight: 1.2,
                  }}>{b.title}</div>
                  {!b.mini && (
                    <>
                      <div style={{ fontSize: 10, color: b.current ? 'rgba(255,255,255,0.85)' : S.textDim, fontFamily: S.fontMono }}>
                        {b.room} · {b.teacher}
                      </div>
                      {b.students > 0 && (
                        <div style={{
                          marginTop: 'auto', fontSize: 10, color: b.current ? 'rgba(255,255,255,0.9)' : b.color,
                          fontFamily: S.fontMono, fontWeight: 600,
                        }}>● {b.students}명</div>
                      )}
                      {b.current && (
                        <div style={{
                          position: 'absolute', top: 6, right: 6,
                          fontSize: 9, padding: '2px 6px', borderRadius: 3,
                          background: 'rgba(255,255,255,0.22)', fontFamily: S.fontMono, letterSpacing: 0.5,
                        }}>NOW</div>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 3) 출석부
// ──────────────────────────────────────────────────────────────────────
function ScreenAttendance() {
  const students = [
    { name: '강민서', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'O', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '100%' },
    { name: '윤소율', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'L', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '93%'  },
    { name: '이도현', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'O', wed: 'O', thu: 'X', fri: 'O', sat: '-', rate: '86%'  },
    { name: '한지우', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'O', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '100%' },
    { name: '정수아', grade: '중2',  cls: '수학 심화 A', mon: 'L', tue: 'O', wed: 'O', thu: 'O', fri: 'L', sat: '-', rate: '86%'  },
    { name: '김도윤', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'O', wed: 'X', thu: 'O', fri: 'O', sat: '-', rate: '86%'  },
    { name: '박서진', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'O', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '100%' },
    { name: '최예준', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'L', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '93%'  },
    { name: '신아린', grade: '중2',  cls: '수학 심화 A', mon: 'O', tue: 'O', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '100%' },
    { name: '장유나', grade: '중2',  cls: '수학 심화 A', mon: 'X', tue: 'X', wed: 'O', thu: 'O', fri: 'O', sat: '-', rate: '60%'  },
  ];

  const MARK = (v) => {
    if (v === 'O') return { bg: S.primarySoft, color: S.primary, label: '출석' };
    if (v === 'X') return { bg: S.dangerSoft, color: S.danger, label: '결석' };
    if (v === 'L') return { bg: S.amberSoft, color: S.amber, label: '지각' };
    return { bg: 'transparent', color: S.textFaint, label: '-' };
  };

  return (
    <AppShell active="attendance" title="출석부" breadcrumb="EYWA · 수업 · 출석부"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="arrowDown">엑셀 다운로드</GhostButton>
          <PrimaryButton icon="check">일괄 체크</PrimaryButton>
        </div>
      }>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          { label: '이번 주 평균', value: '94.2%', delta: '+1.8pt', color: S.primary },
          { label: '오늘 출석',   value: '234',   sub: '/ 248명',   color: S.blue },
          { label: '결석',        value: '9',     sub: '명 · 학부모 알림 발송',  color: S.danger },
          { label: '지각',        value: '5',     sub: '명',        color: S.amber },
        ].map((s, i) => (
          <Card key={i} padding={16}>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: s.color, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
              {s.sub && <span style={{ fontSize: 12, color: S.textDim }}>{s.sub}</span>}
              {s.delta && <Pill color={S.primary} style={{ fontSize: 10, marginLeft: 'auto' }}>{s.delta}</Pill>}
            </div>
          </Card>
        ))}
      </div>

      {/* Filter strip */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Pill color={S.primary} soft={false} style={{ padding: '6px 12px', fontSize: 12 }}>중2 수학 심화 A</Pill>
        <Pill color={S.text} style={{ padding: '6px 12px', fontSize: 12, background: S.surface, border: `1px solid ${S.line}` }}>중3 수학 심화 C</Pill>
        <Pill color={S.text} style={{ padding: '6px 12px', fontSize: 12, background: S.surface, border: `1px solid ${S.line}` }}>고1 영어 정규 B</Pill>
        <Pill color={S.text} style={{ padding: '6px 12px', fontSize: 12, background: S.surface, border: `1px solid ${S.line}` }}>고2 국어 정규</Pill>
        <div style={{ flex: 1 }} />
        <GhostButton icon="search" style={{ padding: '7px 11px', fontSize: 12 }}>학생 검색</GhostButton>
      </div>

      <Card padding={0}>
        {/* Header row */}
        <div style={{
          display: 'grid', gridTemplateColumns: '40px 1.4fr 80px repeat(6, 1fr) 80px',
          borderBottom: `1px solid ${S.line}`, padding: '12px 18px',
          fontSize: 11, color: S.textFaint, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase',
        }}>
          <span></span>
          <span>학생</span>
          <span>학년</span>
          {['월 25', '화 26', '수 27', '목 28', '금 29', '토 30'].map((d) => (
            <span key={d} style={{ textAlign: 'center' }}>{d}</span>
          ))}
          <span style={{ textAlign: 'right' }}>출석률</span>
        </div>
        {/* Rows */}
        {students.map((s, i) => (
          <div key={s.name} style={{
            display: 'grid', gridTemplateColumns: '40px 1.4fr 80px repeat(6, 1fr) 80px',
            alignItems: 'center', padding: '10px 18px',
            borderBottom: i < students.length - 1 ? `1px solid ${S.line}` : 'none',
            fontSize: 13,
          }}>
            <Initial name={s.name} color={S.primary} size={26} />
            <span style={{ fontWeight: 600, color: S.text }}>{s.name}</span>
            <span style={{ color: S.textDim, fontSize: 12 }}>{s.grade}</span>
            {[s.mon, s.tue, s.wed, s.thu, s.fri, s.sat].map((v, j) => {
              const m = MARK(v);
              return (
                <div key={j} style={{
                  margin: '0 auto', width: 28, height: 28, borderRadius: 8,
                  background: m.bg, color: m.color, fontWeight: 700, fontSize: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: S.fontMono,
                }}>{v}</div>
              );
            })}
            <span style={{
              textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums',
              color: parseInt(s.rate) >= 90 ? S.primary : parseInt(s.rate) >= 80 ? S.amber : S.danger,
              fontSize: 14,
            }}>{s.rate}</span>
          </div>
        ))}
      </Card>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 4) 수업목록
// ──────────────────────────────────────────────────────────────────────
function ScreenClasses() {
  const classes = [
    { name: '중2 수학 심화 A', grade: '중2', subject: '수학', teacher: '박지훈', students: 12, cap: 14, days: '월수금', time: '14:00 – 15:30', room: '301호', color: S.primary, status: '진행중' },
    { name: '중3 수학 심화 C', grade: '중3', subject: '수학', teacher: '박지훈', students: 14, cap: 14, days: '화수목', time: '19:00 – 20:30', room: '301호', color: S.primary, status: '진행중' },
    { name: '고1 영어 정규 B', grade: '고1', subject: '영어', teacher: '이연우', students: 10, cap: 12, days: '월수금', time: '16:00 – 17:30', room: '205호', color: S.blue,    status: '진행중' },
    { name: '고2 국어 정규',    grade: '고2', subject: '국어', teacher: '최보라', students: 8,  cap: 12, days: '화목',    time: '18:00 – 19:30', room: '404호', color: S.purple,  status: '진행중' },
    { name: '주말 보강반',     grade: '전체', subject: '특강', teacher: '박지훈', students: 24, cap: 30, days: '토',      time: '10:00 – 13:00', room: '301호', color: S.gold,    status: '진행중' },
    { name: '예비 중1 수학',   grade: '예비중1', subject: '수학', teacher: '박지원', students: 6,  cap: 14, days: '월화수', time: '17:00 – 18:00', room: '202호', color: S.primary, status: '모집중' },
  ];

  return (
    <AppShell active="classes" title="수업목록" breadcrumb="EYWA · 수업 · 수업목록"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="search">필터</GhostButton>
          <PrimaryButton icon="plus">새 반 만들기</PrimaryButton>
        </div>
      }>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          ['진행중인 반', '24', '개', S.primary],
          ['모집중인 반',  '3',  '개', S.gold],
          ['평균 정원율', '82', '%', S.blue],
          ['이번 주 수업', '142', '시간', S.purple],
        ].map((s, i) => (
          <Card key={i} padding={16}>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s[0]}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: s[3], letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{s[1]}</span>
              <span style={{ fontSize: 12, color: S.textDim }}>{s[2]}</span>
            </div>
          </Card>
        ))}
      </div>

      {/* Class cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {classes.map((c, i) => {
          const fillPct = (c.students / c.cap) * 100;
          return (
            <Card key={i} padding={20} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Pill color={c.color} style={{ fontSize: 10 }}>{c.grade} · {c.subject}</Pill>
                  <Pill color={c.status === '진행중' ? S.primary : S.amber} style={{ fontSize: 10 }}>● {c.status}</Pill>
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: S.text, letterSpacing: -0.4, lineHeight: 1.25 }}>{c.name}</div>
              </div>

              <div style={{ fontSize: 12, color: S.textDim, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Initial name={c.teacher} color={S.gold} size={22} />
                  <span style={{ color: S.text, fontWeight: 600 }}>{c.teacher}</span>
                  <span style={{ marginLeft: 'auto', color: S.textFaint, fontSize: 11, fontFamily: S.fontMono }}>{c.room}</span>
                </div>
                <div style={{ fontFamily: S.fontMono, fontSize: 11, color: S.textDim }}>{c.days} · {c.time}</div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 5 }}>
                  <span style={{ color: S.textDim }}>정원 현황</span>
                  <span style={{ color: S.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{c.students} / {c.cap}명</span>
                </div>
                <div style={{ height: 6, background: S.bgSoft, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${fillPct}%`, height: '100%', background: fillPct >= 90 ? S.danger : fillPct >= 70 ? c.color : S.gold }} />
                </div>
              </div>

              <div style={{
                paddingTop: 12, borderTop: `1px solid ${S.line}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>/class/{c.name.replace(/\s/g, '-')}</span>
                <a style={{ fontSize: 12, color: c.color, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  관리 <EyIcon name="arrowRight" size={11} />
                </a>
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}

Object.assign(window, { ScreenDashboard, ScreenTimetable, ScreenAttendance, ScreenClasses });
