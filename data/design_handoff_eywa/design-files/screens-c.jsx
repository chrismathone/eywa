// screens-c.jsx — 4 ops/help screens: staff / billing / meetings / help

// ──────────────────────────────────────────────────────────────────────
// 9) 직원관리
// ──────────────────────────────────────────────────────────────────────
function ScreenStaff() {
  const staff = [
    { name: '박지훈', role: '수학 강사 · 부원장', tenure: '7년차', classes: 8,  students: 84,  pay: '320만',  status: 'on',   color: S.primary },
    { name: '이연우', role: '영어 강사',           tenure: '4년차', classes: 6,  students: 62,  pay: '280만',  status: 'on',   color: S.blue },
    { name: '최보라', role: '국어 강사',           tenure: '3년차', classes: 4,  students: 38,  pay: '250만',  status: 'on',   color: S.purple },
    { name: '김상담', role: '상담실장',             tenure: '5년차', classes: 0,  students: 0,   pay: '260만',  status: 'on',   color: S.gold },
    { name: '박지원', role: '수학 강사 · 신입',     tenure: '1개월', classes: 2,  students: 14,  pay: '180만',  status: 'on',   color: S.primary },
    { name: '정유진', role: '행정',                 tenure: '2년차', classes: 0,  students: 0,   pay: '220만',  status: 'off',  color: S.textDim },
  ];

  const STATUS = {
    on: { label: '근무 중', color: S.primary },
    off: { label: '휴가 중', color: S.amber },
  };

  return (
    <AppShell active="staff" title="직원관리" breadcrumb="EYWA · 운영 · 직원관리"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="arrowDown">급여 명세서</GhostButton>
          <PrimaryButton icon="plus">직원 추가</PrimaryButton>
        </div>
      }>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['전체',     '8',   '명', S.text,    '강사 5 · 행정 2 · 상담 1'],
          ['근무 중', '7',   '명', S.primary, '오늘 출근 6'],
          ['휴가',     '1',   '명', S.amber,   '정유진 · ~5/29'],
          ['총 급여',  '2,140', '만', S.blue,    '이번 달'],
          ['평균 재직', '3.2', '년', S.purple,  '업계 평균보다 높음'],
        ].map((s, i) => (
          <Card key={i} padding={16}>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s[0]}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 26, fontWeight: 800, color: s[3], letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{s[1]}</span>
              <span style={{ fontSize: 11, color: S.textDim }}>{s[2]}</span>
            </div>
            <div style={{ fontSize: 11, color: S.textFaint, marginTop: 4 }}>{s[4]}</div>
          </Card>
        ))}
      </div>

      {/* Staff cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {staff.map((s, i) => {
          const st = STATUS[s.status];
          return (
            <Card key={i} padding={20} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Initial name={s.name} color={s.color} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 15, color: S.text, fontWeight: 800, letterSpacing: -0.3 }}>{s.name}</span>
                    <Pill color={st.color} style={{ fontSize: 9 }}>● {st.label}</Pill>
                  </div>
                  <div style={{ fontSize: 12, color: S.textDim, marginTop: 2 }}>{s.role}</div>
                  <div style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono, marginTop: 2 }}>{s.tenure}</div>
                </div>
              </div>

              {s.classes > 0 ? (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10,
                  padding: 12, background: S.bgSoft, borderRadius: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 10, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}>담당 반</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: S.text, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{s.classes}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}>학생</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: S.text, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{s.students}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 0.5, textTransform: 'uppercase' }}>이번달</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: s.color, fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{s.pay}</div>
                  </div>
                </div>
              ) : (
                <div style={{ padding: 12, background: S.bgSoft, borderRadius: 10, fontSize: 12, color: S.textDim }}>
                  비강사 · 이번달 급여 <span style={{ color: s.color, fontWeight: 700 }}>{s.pay}원</span>
                </div>
              )}

              <div style={{ paddingTop: 12, borderTop: `1px solid ${S.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>/staff/{s.name}</span>
                <a style={{ fontSize: 12, color: s.color, fontWeight: 700 }}>관리 →</a>
              </div>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 10) 수납관리
// ──────────────────────────────────────────────────────────────────────
function ScreenBilling() {
  const rows = [
    { name: '강민서', cls: '수학 심화 A', period: '2026.06', amount: 352000, due: '2026.06.05', status: 'paid',     paidAt: '2026.05.30' },
    { name: '윤소율', cls: '수학 심화 A', period: '2026.06', amount: 288000, due: '2026.06.05', status: 'paid',     paidAt: '2026.05.31' },
    { name: '이도현', cls: '국어 정규',   period: '2026.06', amount: 352000, due: '2026.06.05', status: 'due',      paidAt: '-' },
    { name: '정수아', cls: '영어 정규 B', period: '2026.06', amount: 420000, due: '2026.05.20', status: 'overdue',  paidAt: '-', overdueDays: 7 },
    { name: '한지우', cls: '수학 심화 C', period: '2026.06', amount: 352000, due: '2026.06.05', status: 'paid',     paidAt: '2026.06.01' },
    { name: '박서진', cls: '수학 심화 A', period: '2026.06', amount: 352000, due: '2026.06.05', status: 'due',      paidAt: '-' },
    { name: '최예준', cls: '영어 정규 B', period: '2026.06', amount: 420000, due: '2026.05.25', status: 'overdue',  paidAt: '-', overdueDays: 2 },
    { name: '신아린', cls: '예비 중1 수학', period: '2026.06', amount: 240000, due: '2026.06.10', status: 'paid',  paidAt: '2026.06.02' },
  ];

  const STATUS = {
    paid:     { label: '완납',   color: S.primary, dot: true },
    due:      { label: '청구 대기', color: S.amber,   dot: true },
    overdue:  { label: '미납',     color: S.danger,  dot: true },
  };

  const fmt = (n) => n.toLocaleString('ko-KR');

  return (
    <AppShell active="billing" title="수납관리" breadcrumb="EYWA · 운영 · 수납관리"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="arrowDown">청구서 일괄 발행</GhostButton>
          <PrimaryButton icon="plus">수동 청구</PrimaryButton>
        </div>
      }>

      {/* Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          { label: '이번달 청구',   value: '8,754',  unit: '만원', sub: '248건',    color: S.text },
          { label: '수납 완료',     value: '7,612',  unit: '만원', sub: '216건 · 87.1%', color: S.primary },
          { label: '청구 대기',     value: '880',    unit: '만원', sub: '23건',     color: S.amber },
          { label: '미납',         value: '262',    unit: '만원', sub: '9건 · 평균 4일', color: S.danger },
        ].map((s, i) => (
          <Card key={i} padding={18}>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: s.color, letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{s.value}</span>
              <span style={{ fontSize: 12, color: S.textDim }}>{s.unit}</span>
            </div>
            <div style={{ fontSize: 11, color: S.textFaint, marginTop: 4 }}>{s.sub}</div>
          </Card>
        ))}
      </div>

      {/* Progress strip */}
      <Card padding={16} style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
              <span style={{ color: S.textDim }}>2026년 6월 수납 진행률</span>
              <span style={{ color: S.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>87.1%</span>
            </div>
            <div style={{ display: 'flex', height: 10, borderRadius: 999, overflow: 'hidden', background: S.bgSoft }}>
              <div style={{ width: '87.1%', background: S.primary }} />
              <div style={{ width: '9.7%', background: S.amber }} />
              <div style={{ width: '3.2%', background: S.danger }} />
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 11, color: S.textDim }}>
              <span><span style={{ width: 8, height: 8, borderRadius: 2, background: S.primary, display: 'inline-block', marginRight: 5 }} />완납 216건</span>
              <span><span style={{ width: 8, height: 8, borderRadius: 2, background: S.amber, display: 'inline-block', marginRight: 5 }} />대기 23건</span>
              <span><span style={{ width: 8, height: 8, borderRadius: 2, background: S.danger, display: 'inline-block', marginRight: 5 }} />미납 9건</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Tabs + Table */}
      <Card padding={0}>
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${S.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            {['전체 248', '미납 9', '완납 216', '대기 23'].map((t, i) => (
              <div key={t} style={{
                padding: '6px 12px', fontSize: 12, fontWeight: i === 1 ? 700 : 500,
                color: i === 1 ? S.danger : S.textDim, cursor: 'pointer',
                background: i === 1 ? S.dangerSoft : 'transparent', borderRadius: 6,
              }}>{t}</div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>2026.06 기준</div>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '40px 1.3fr 1.4fr 90px 110px 110px 110px 80px',
          padding: '10px 18px', borderBottom: `1px solid ${S.line}`,
          fontSize: 11, color: S.textFaint, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase',
        }}>
          <span></span>
          <span>학생</span>
          <span>반</span>
          <span>기간</span>
          <span style={{ textAlign: 'right' }}>금액</span>
          <span>납기</span>
          <span>상태</span>
          <span style={{ textAlign: 'right' }}>액션</span>
        </div>
        {rows.map((r, i) => {
          const st = STATUS[r.status];
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '40px 1.3fr 1.4fr 90px 110px 110px 110px 80px',
              alignItems: 'center', padding: '12px 18px',
              borderBottom: i < rows.length - 1 ? `1px solid ${S.line}` : 'none',
              fontSize: 13,
            }}>
              <Initial name={r.name} color={st.color} size={26} />
              <span style={{ fontWeight: 600, color: S.text }}>{r.name}</span>
              <span style={{ color: S.textDim, fontSize: 12 }}>{r.cls}</span>
              <span style={{ color: S.textDim, fontFamily: S.fontMono, fontSize: 11 }}>{r.period}</span>
              <span style={{ textAlign: 'right', fontFamily: S.fontMono, fontVariantNumeric: 'tabular-nums', color: S.text, fontWeight: 600 }}>{fmt(r.amount)}원</span>
              <span style={{ color: r.status === 'overdue' ? S.danger : S.textDim, fontFamily: S.fontMono, fontSize: 11, fontWeight: r.status === 'overdue' ? 700 : 400 }}>
                {r.due}
                {r.overdueDays && <span style={{ display: 'block', fontSize: 9, marginTop: 1 }}>{r.overdueDays}일 경과</span>}
              </span>
              <Pill color={st.color} style={{ fontSize: 10 }}>● {st.label}</Pill>
              <a style={{ textAlign: 'right', color: r.status === 'paid' ? S.textDim : st.color, fontSize: 12, fontWeight: 600 }}>
                {r.status === 'paid' ? '영수증' : r.status === 'overdue' ? '독촉' : '청구'}
              </a>
            </div>
          );
        })}
      </Card>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 11) 회의록 — AI 요약 + Realtime
// ──────────────────────────────────────────────────────────────────────
function ScreenMeetings() {
  const meetings = [
    {
      title: '주간 강사 회의', date: '2026.05.27 20:30', dur: '32:14',
      attendees: ['박지훈', '이연우', '최보라', '김상담', '박지원'],
      status: 'ai-done', actions: 4,
    },
    {
      title: '신입생 적응 점검', date: '2026.05.26 11:00', dur: '18:42',
      attendees: ['김상담', '박지훈'],
      status: 'ai-done', actions: 2,
    },
    {
      title: '6월 시험 일정 조율', date: '2026.05.24 16:30', dur: '24:08',
      attendees: ['박지훈', '이연우', '최보라'],
      status: 'recording', actions: 0,
    },
    {
      title: '5월 마감 회의', date: '2026.05.20 19:00', dur: '45:36',
      attendees: ['전체'],
      status: 'ai-done', actions: 7,
    },
  ];

  const STATUS = {
    'ai-done':   { label: 'AI 요약 완료', color: S.primary },
    'recording': { label: '녹음 중',     color: S.danger },
    'ai-pending':{ label: 'AI 분석 중',  color: S.amber },
  };

  return (
    <AppShell active="meetings" title="회의록" breadcrumb="EYWA · 운영 · 회의록"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="sparkle">AI 재요약</GhostButton>
          <PrimaryButton icon="plus">새 회의 시작</PrimaryButton>
        </div>
      }>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        {/* Meetings list */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 700, color: S.text, margin: 0, letterSpacing: -0.2 }}>최근 회의</h2>
            <span style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>이번 달 12건</span>
            <div style={{ flex: 1 }} />
            <Pill color={S.danger} style={{ fontSize: 10 }}>● 1건 녹음 중</Pill>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {meetings.map((m, i) => {
              const st = STATUS[m.status];
              const live = m.status === 'recording';
              return (
                <Card key={i} padding={18} style={{
                  border: live ? `1.5px solid ${S.danger}` : `1px solid ${S.line}`,
                  background: live ? S.dangerSoft : S.surface,
                  position: 'relative',
                }}>
                  {live && (
                    <div style={{
                      position: 'absolute', top: 12, right: 14,
                      display: 'inline-flex', alignItems: 'center', gap: 6,
                      padding: '4px 9px', borderRadius: 999, background: S.danger, color: '#fff',
                      fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                    }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} />
                      LIVE
                    </div>
                  )}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 44, height: 44, borderRadius: 12,
                      background: live ? S.danger : S.primarySoft,
                      color: live ? '#fff' : S.primary,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <EyIcon name={live ? 'pulse' : 'rings'} size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, color: S.text, fontWeight: 700, letterSpacing: -0.3 }}>{m.title}</div>
                      <div style={{ display: 'flex', gap: 14, marginTop: 4, fontSize: 11, color: S.textDim, fontFamily: S.fontMono }}>
                        <span>{m.date}</span><span>{m.dur}</span><span>참석 {m.attendees.length}명</span>
                      </div>
                      {!live && m.status === 'ai-done' && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
                          <Pill color={st.color} style={{ fontSize: 10 }}>● {st.label}</Pill>
                          <span style={{ fontSize: 11, color: S.textDim }}>액션 아이템 {m.actions}개</span>
                        </div>
                      )}
                    </div>
                    {!live && <a style={{ fontSize: 12, color: S.primary, fontWeight: 700 }}>보기 →</a>}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        {/* AI summary panel */}
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: S.primarySoft, color: S.primary,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <EyIcon name="sparkle" size={16} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: S.text, fontWeight: 700 }}>주간 강사 회의</div>
              <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono }}>2026.05.27 · AI 요약</div>
            </div>
            <Pill color={S.primary} style={{ fontSize: 10 }}>AI 완료</Pill>
          </div>

          <div style={{
            padding: 12, background: S.bgSoft, borderRadius: 10, marginBottom: 16,
            fontFamily: S.fontMono, fontSize: 11, color: S.textDim, lineHeight: 1.6,
          }}>
            <div>// confidence 0.94 · 5 speakers · 32m 14s</div>
            <div>// summary + action items + decisions</div>
          </div>

          <div style={{ fontSize: 12, color: S.text, lineHeight: 1.75 }}>
            <div style={{ fontSize: 10, color: S.primary, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>핵심 결정사항</div>
            <ul style={{ margin: 0, paddingLeft: 18, marginBottom: 14 }}>
              <li>6월 시험 일정 6/14 토 확정</li>
              <li>고1 영어 정규 B반 → C반 분반 검토</li>
              <li>신입 강사 박지원 → 중1 수학 보조 배정</li>
            </ul>

            <div style={{ fontSize: 10, color: S.gold, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 6 }}>액션 아이템 4건</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[
                { who: '박지훈', what: '6/14 시험 출제 일정 공유', due: '5/30', done: true },
                { who: '이연우', what: 'B반 분반 시뮬레이션 검토', due: '6/3',  done: false },
                { who: '김상담', what: '학부모 시험 안내 카톡 작성', due: '6/1', done: false },
                { who: '박지원', what: '중1 수학 교재 검토 보고', due: '6/5', done: false },
              ].map((a, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 10px', borderRadius: 8,
                  background: a.done ? S.bgSoft : 'transparent',
                  border: a.done ? 'none' : `1px solid ${S.line}`,
                  opacity: a.done ? 0.6 : 1,
                }}>
                  <div style={{
                    width: 16, height: 16, borderRadius: 4,
                    background: a.done ? S.primary : 'transparent',
                    border: a.done ? 'none' : `1.5px solid ${S.lineStrong}`,
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    {a.done && <EyIcon name="check" size={10} strokeWidth={3} />}
                  </div>
                  <Initial name={a.who} color={S.primary} size={20} />
                  <span style={{ fontSize: 11, color: S.textDim, fontWeight: 600 }}>{a.who}</span>
                  <span style={{ flex: 1, fontSize: 12, color: S.text, textDecoration: a.done ? 'line-through' : 'none' }}>{a.what}</span>
                  <span style={{ fontSize: 10, color: S.textFaint, fontFamily: S.fontMono }}>~{a.due}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 12) 도움말
// ──────────────────────────────────────────────────────────────────────
function ScreenHelp() {
  const guides = [
    { title: '시작하기',         items: 8,  icon: 'sprout',  color: S.primary, desc: '5분 안에 EYWA를 설정하는 법' },
    { title: '학생 등록',         items: 12, icon: 'seed',    color: S.blue,    desc: '신규/예비 학생 추가, 일괄 가져오기' },
    { title: '시간표 짜기',       items: 6,  icon: 'leaf',    color: S.purple,  desc: '드래그로 반 이동, 충돌 자동 감지' },
    { title: '출결과 알림',       items: 9,  icon: 'pulse',   color: S.amber,   desc: '카톡 알림 설정, 일괄 체크' },
    { title: '수납 관리',         items: 14, icon: 'pollen',  color: S.gold,    desc: '청구서 발행, 미납 독촉, 영수증' },
    { title: 'AI 분석 활용',     items: 7,  icon: 'sparkle', color: S.primary, desc: '등록상담 · 케어 · 회의록 요약' },
  ];

  const shortcuts = [
    ['⌘ K', '전역 검색'],
    ['⌘ N', '새 학생 추가'],
    ['⌘ /', '단축키 도움말'],
    ['G + D', '대시보드로'],
    ['G + S', '학생목록으로'],
    ['G + B', '수납관리로'],
  ];

  const faqs = [
    { q: 'AI 상담분석은 어떻게 작동하나요?', a: 'Anthropic Claude API로 녹음·메모를 분석해 학습 스타일·관심사·우려를 요약합니다. 한 번 생성된 분석은 동결되어 모델이 바뀌어도 인쇄물이 변하지 않습니다.' },
    { q: '데이터는 안전한가요?', a: 'Supabase Postgres + RLS로 운영합니다. 모든 테이블에 tenant_id가 있어 학원간 데이터 노출이 원천 차단됩니다.' },
    { q: '기존 ijw-calander 데이터를 옮길 수 있나요?', a: '네, 무료 마이그레이션을 제공합니다. Firestore에서 학생·반·결제·출석 데이터를 Supabase로 옮기는 데 평균 3일 소요됩니다.' },
  ];

  return (
    <AppShell active="help" title="도움말" breadcrumb="EYWA · 지원 · 도움말"
      actions={<GhostButton icon="bell">새 기능 알림 받기</GhostButton>}>

      {/* Search hero */}
      <Card padding={28} style={{
        marginBottom: 18, position: 'relative', overflow: 'hidden',
        background: `linear-gradient(135deg, ${S.surface} 0%, ${S.surfaceHi} 100%)`,
      }}>
        <svg width="220" height="220" viewBox="0 0 220 220"
          style={{ position: 'absolute', right: -20, top: -50, opacity: 0.4 }}>
          {[20, 50, 84, 122, 160].map((r, i) => (
            <circle key={i} cx="110" cy="110" r={r} fill="none" stroke={S.primary} strokeWidth={i === 0 ? 1.6 : 0.5} opacity="0.25" />
          ))}
        </svg>
        <div style={{ position: 'relative', maxWidth: 560 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: S.text, margin: 0, letterSpacing: -0.5, lineHeight: 1.2 }}>
            무엇을 도와드릴까요?
          </h2>
          <p style={{ fontSize: 13, color: S.textDim, marginTop: 6, lineHeight: 1.6 }}>
            가이드 검색, 단축키 확인, 1:1 문의까지 한 곳에서.
          </p>
          <div style={{
            marginTop: 16, padding: '12px 16px', borderRadius: 12,
            background: S.surface, border: `1px solid ${S.lineStrong}`,
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 4px 14px rgba(13,17,16,0.04)',
          }}>
            <EyIcon name="search" size={16} color={S.textDim} />
            <span style={{ flex: 1, fontSize: 14, color: S.textDim }}>예: 학생 등록, 청구서, 단축키...</span>
            <Pill color={S.primary} style={{ fontSize: 10, fontFamily: S.fontMono }}>⌘K</Pill>
          </div>
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 14 }}>
        {/* Guide categories */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 700, color: S.text, margin: '0 0 12px', letterSpacing: -0.2 }}>가이드 카테고리</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            {guides.map((g, i) => (
              <Card key={i} padding={16} style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: `${g.color}18`, color: g.color,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <EyIcon name={g.icon} size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, color: S.text, fontWeight: 700, letterSpacing: -0.2 }}>{g.title}</span>
                    <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 999, background: S.bgSoft, color: S.textDim, fontFamily: S.fontMono }}>{g.items}</span>
                  </div>
                  <div style={{ fontSize: 12, color: S.textDim, marginTop: 2 }}>{g.desc}</div>
                </div>
                <EyIcon name="arrowRight" size={12} color={S.textFaint} />
              </Card>
            ))}
          </div>

          {/* FAQ */}
          <h3 style={{ fontSize: 13, fontWeight: 700, color: S.text, margin: '22px 0 12px', letterSpacing: -0.2 }}>자주 묻는 질문</h3>
          <Card padding={0}>
            {faqs.map((f, i) => (
              <div key={i} style={{
                padding: '16px 18px',
                borderBottom: i < faqs.length - 1 ? `1px solid ${S.line}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ fontSize: 11, color: S.primary, fontWeight: 700, fontFamily: S.fontMono, flexShrink: 0, paddingTop: 1 }}>Q{i + 1}.</span>
                  <div>
                    <div style={{ fontSize: 13, color: S.text, fontWeight: 700, lineHeight: 1.4 }}>{f.q}</div>
                    <div style={{ fontSize: 12, color: S.textDim, marginTop: 5, lineHeight: 1.65 }}>{f.a}</div>
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </div>

        {/* Right column: shortcuts + contact */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Card padding={18}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: S.primarySoft, color: S.primary, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <EyIcon name="branch" size={14} />
              </div>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: S.text, margin: 0 }}>키보드 단축키</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {shortcuts.map((s, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < shortcuts.length - 1 ? `1px solid ${S.line}` : 'none' }}>
                  <span style={{ fontSize: 12, color: S.textDim }}>{s[1]}</span>
                  <span style={{
                    fontSize: 11, padding: '3px 8px', borderRadius: 5,
                    background: S.bgSoft, border: `1px solid ${S.line}`,
                    color: S.text, fontFamily: S.fontMono, fontWeight: 600, letterSpacing: 0.5,
                  }}>{s[0]}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card padding={18} style={{
            background: `linear-gradient(135deg, ${S.primary} 0%, #2a7a52 100%)`,
            color: '#fff', border: 'none',
          }}>
            <div style={{ fontSize: 11, fontFamily: S.fontMono, color: '#e9c876', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8, fontWeight: 700 }}>1:1 문의</div>
            <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.3 }}>해결되지 않았나요?</div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.78)', marginTop: 4, lineHeight: 1.6, margin: '4px 0 14px' }}>
              평일 1시간 안에 답변드립니다.
            </p>
            <button style={{
              width: '100%', padding: 10, borderRadius: 10,
              background: '#fff', color: S.primary, border: 'none',
              fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}>채팅 문의 시작 <EyIcon name="arrowRight" size={12} /></button>
            <div style={{ marginTop: 10, fontSize: 11, color: 'rgba(255,255,255,0.6)', fontFamily: S.fontMono, textAlign: 'center', letterSpacing: 0.5 }}>
              1670-0000 · 평일 10:00 — 18:00
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

Object.assign(window, { ScreenStaff, ScreenBilling, ScreenMeetings, ScreenHelp });
