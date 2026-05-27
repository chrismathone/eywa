// screens-b.jsx — 4 student-facing screens

// ──────────────────────────────────────────────────────────────────────
// 5) 학생목록
// ──────────────────────────────────────────────────────────────────────
function ScreenStudents() {
  const students = [
    { name: '강민서', grade: '중2', cls: '수학 심화 A', joined: '2024.03', parent: '강아빠 · 010-2345-1234', billing: 'paid',     ai: '활발',  color: S.primary },
    { name: '윤소율', grade: '중2', cls: '수학 심화 A', joined: '2024.09', parent: '윤엄마 · 010-3456-2345', billing: 'paid',     ai: '집중',  color: S.blue },
    { name: '이도현', grade: '고2', cls: '국어 정규',   joined: '2023.01', parent: '이아빠 · 010-4567-3456', billing: 'due',      ai: '주의',  color: S.amber },
    { name: '정수아', grade: '고1', cls: '영어 정규 B', joined: '2024.06', parent: '정엄마 · 010-5678-4567', billing: 'overdue',  ai: '활발',  color: S.danger },
    { name: '한지우', grade: '중3', cls: '수학 심화 C', joined: '2023.09', parent: '한엄마 · 010-6789-5678', billing: 'paid',     ai: '안정',  color: S.primary },
    { name: '박서진', grade: '중2', cls: '수학 심화 A', joined: '2024.03', parent: '박아빠 · 010-7890-6789', billing: 'paid',     ai: '안정',  color: S.primary },
    { name: '최예준', grade: '고1', cls: '영어 정규 B', joined: '2024.06', parent: '최엄마 · 010-8901-7890', billing: 'paid',     ai: '활발',  color: S.blue },
    { name: '신아린', grade: '예비중1', cls: '예비 중1 수학', joined: '2026.05', parent: '신엄마 · 010-9012-8901', billing: 'paid', ai: '신규', color: S.gold },
  ];

  const BILLING = {
    paid:     { label: '납부 완료', color: S.primary },
    due:      { label: '청구 대기', color: S.amber },
    overdue:  { label: '미납',     color: S.danger },
  };

  return (
    <AppShell active="students" title="학생목록" breadcrumb="EYWA · 학생 · 학생목록"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="arrowDown">엑셀</GhostButton>
          <PrimaryButton icon="plus">새 학생</PrimaryButton>
        </div>
      }>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        {[
          ['재원생',   '248', '명',  S.primary, '+14 신규'],
          ['예비',     '12',  '명',  S.gold,    '예비 중1'],
          ['퇴원',     '2',   '명',  S.textDim, '이번 달'],
          ['평균 출석', '94.2', '%', S.blue,    '+1.8pt'],
          ['평균 재원', '14',   '개월', S.purple, '안정'],
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

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, borderBottom: `1px solid ${S.line}` }}>
        {['전체 248', '재원 248', '예비 12', '퇴원 24', '결석 위험 9'].map((t, i) => (
          <div key={t} style={{
            padding: '10px 16px', fontSize: 13, fontWeight: i === 0 ? 700 : 500,
            color: i === 0 ? S.primary : S.textDim, cursor: 'pointer',
            borderBottom: i === 0 ? `2px solid ${S.primary}` : '2px solid transparent',
            marginBottom: -1,
          }}>{t}</div>
        ))}
      </div>

      <Card padding={0}>
        <div style={{
          display: 'grid', gridTemplateColumns: '32px 1.5fr 80px 1.3fr 100px 1.8fr 100px 100px 60px',
          padding: '12px 18px', borderBottom: `1px solid ${S.line}`,
          fontSize: 11, color: S.textFaint, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase',
        }}>
          <span></span>
          <span>학생</span>
          <span>학년</span>
          <span>반</span>
          <span>등록</span>
          <span>학부모 연락처</span>
          <span>수납</span>
          <span>AI 케어</span>
          <span style={{ textAlign: 'right' }}></span>
        </div>
        {students.map((s, i) => {
          const b = BILLING[s.billing];
          return (
            <div key={s.name} style={{
              display: 'grid', gridTemplateColumns: '32px 1.5fr 80px 1.3fr 100px 1.8fr 100px 100px 60px',
              alignItems: 'center', padding: '12px 18px',
              borderBottom: i < students.length - 1 ? `1px solid ${S.line}` : 'none',
              fontSize: 13, color: S.text,
            }}>
              <Initial name={s.name} color={s.color} size={26} />
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: S.textDim, fontSize: 12 }}>{s.grade}</span>
              <span style={{ fontSize: 12 }}>{s.cls}</span>
              <span style={{ color: S.textDim, fontFamily: S.fontMono, fontSize: 11 }}>{s.joined}</span>
              <span style={{ color: S.textDim, fontSize: 12 }}>{s.parent}</span>
              <Pill color={b.color} style={{ fontSize: 10 }}>{b.label}</Pill>
              <Pill color={s.color} style={{ fontSize: 10 }}>● {s.ai}</Pill>
              <a style={{ textAlign: 'right', color: S.primary, fontSize: 12, fontWeight: 600 }}>관리</a>
            </div>
          );
        })}
        <div style={{
          padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          fontSize: 12, color: S.textDim,
        }}>
          <span>1 — 8 / 248명</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ padding: '4px 10px', borderRadius: 6, background: S.surface, border: `1px solid ${S.line}`, fontFamily: S.fontMono }}>1</span>
            <span style={{ padding: '4px 10px', borderRadius: 6, color: S.text, fontFamily: S.fontMono }}>2</span>
            <span style={{ padding: '4px 10px', borderRadius: 6, color: S.text, fontFamily: S.fontMono }}>3</span>
            <span style={{ padding: '4px 10px', borderRadius: 6, color: S.textFaint, fontFamily: S.fontMono }}>···</span>
            <span style={{ padding: '4px 10px', borderRadius: 6, color: S.text, fontFamily: S.fontMono }}>31</span>
          </div>
        </div>
      </Card>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 6) 등록상담 — AI 분석이 핵심
// ──────────────────────────────────────────────────────────────────────
function ScreenEnrollment() {
  const sessions = [
    { name: '윤소율 학부모', grade: '예비 중1', date: '5/27 14:40', dur: '12:36', status: 'ai-done',    color: S.primary, counselor: '김상담', recommend: '수학 심화 A + 영어 정규 C' },
    { name: '오현우 학부모', grade: '중2',     date: '5/27 16:00', dur: '08:14', status: 'ai-pending', color: S.amber,   counselor: '박지훈', recommend: 'AI 분석 대기 (큐 3/5)' },
    { name: '강민지 학부모', grade: '고1',     date: '5/26 11:00', dur: '15:42', status: 'ai-done',    color: S.primary, counselor: '이연우', recommend: '영어 정규 B + 국어 정규' },
    { name: '서지호 학부모', grade: '예비 중1', date: '5/26 09:30', dur: '11:20', status: 'enrolled',   color: S.gold,    counselor: '김상담', recommend: '등록 완료 · 6/3 첫 수업' },
  ];

  return (
    <AppShell active="enrollment" title="등록상담" breadcrumb="EYWA · 학생 · 등록상담"
      actions={<PrimaryButton icon="sparkle">새 상담 시작</PrimaryButton>}>

      {/* AI banner */}
      <div style={{
        marginBottom: 18, padding: '20px 24px', borderRadius: 16,
        background: `linear-gradient(135deg, ${S.primary} 0%, #2a7a52 100%)`,
        color: '#fff', position: 'relative', overflow: 'hidden',
        display: 'flex', alignItems: 'center', gap: 20,
        boxShadow: `0 14px 32px rgba(26, 95, 60, 0.20)`,
      }}>
        <svg width="280" height="280" viewBox="0 0 280 280"
          style={{ position: 'absolute', right: -40, top: -60, opacity: 0.18 }}>
          {[40, 70, 100, 130, 160, 190].map((r, i) => (
            <circle key={i} cx="140" cy="140" r={r} fill="none" stroke="#fff" strokeWidth={i === 0 ? 1.6 : 0.5} />
          ))}
        </svg>
        <div style={{
          position: 'relative', width: 52, height: 52, borderRadius: 14,
          background: 'rgba(255,255,255,0.18)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <EyIcon name="sparkle" size={24} />
        </div>
        <div style={{ position: 'relative', flex: 1 }}>
          <div style={{ fontSize: 11, color: '#e9c876', fontFamily: S.fontMono, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4, fontWeight: 700 }}>POWERED BY CLAUDE</div>
          <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>AI가 등록상담을 듣고, 학습 스타일을 정리합니다.</div>
          <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)', marginTop: 4 }}>녹음만 업로드하면 학습 스타일 · 관심사 · 우려사항 · 반 추천을 자동으로 요약해드려요.</div>
        </div>
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 999, background: 'rgba(255,255,255,0.12)', fontSize: 12, fontFamily: S.fontMono }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#e9c876' }} />
          이번달 87회 사용
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 14 }}>
        {/* Sessions list */}
        <Card padding={0}>
          <div style={{ padding: '18px 22px', borderBottom: `1px solid ${S.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: S.text, margin: 0, letterSpacing: -0.3 }}>최근 상담 세션</h2>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono }}>이번 주 7건</div>
          </div>
          {sessions.map((s, i) => {
            const STATUS = {
              'ai-done':    { label: 'AI 분석 완료', color: S.primary },
              'ai-pending': { label: 'AI 분석 대기', color: S.amber },
              'enrolled':   { label: '등록 완료',     color: S.gold },
            }[s.status];
            return (
              <div key={i} style={{
                padding: '16px 22px',
                borderBottom: i < sessions.length - 1 ? `1px solid ${S.line}` : 'none',
                display: 'flex', alignItems: 'center', gap: 16,
              }}>
                <Initial name={s.name} color={s.color} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, color: S.text, fontWeight: 700 }}>{s.name}</span>
                    <Pill color={s.color} style={{ fontSize: 10 }}>{s.grade}</Pill>
                  </div>
                  <div style={{ fontSize: 12, color: S.textDim, marginTop: 3 }}>{s.recommend}</div>
                  <div style={{ display: 'flex', gap: 14, marginTop: 6, fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>
                    <span>{s.date}</span><span>{s.dur}</span><span>· {s.counselor}</span>
                  </div>
                </div>
                <Pill color={STATUS.color} style={{ fontSize: 11 }}>● {STATUS.label}</Pill>
                <a style={{ fontSize: 12, color: S.primary, fontWeight: 700 }}>보기 →</a>
              </div>
            );
          })}
        </Card>

        {/* Featured AI analysis preview */}
        <Card padding={20}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Initial name="윤소율 학부모" color={S.primary} size={36} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: S.text, fontWeight: 700 }}>윤소율 학부모</div>
              <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono }}>예비 중1 · 12분 36초</div>
            </div>
            <Pill color={S.primary} style={{ fontSize: 10 }}>AI 완료</Pill>
          </div>

          <div style={{
            padding: 14, background: S.bgSoft, borderRadius: 10, marginBottom: 14,
            fontFamily: S.fontMono, fontSize: 11, color: S.textDim, lineHeight: 1.6,
          }}>
            <div>// powered by Claude · 2026.05.27 14:55</div>
            <div>// confidence 0.92 · 학습스타일 · 관심사 · 우려 · 반추천</div>
          </div>

          <div style={{ fontSize: 12, color: S.text, lineHeight: 1.8 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: S.primary, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>학습 스타일</div>
              <div>시각적 학습 선호. 반복보다 이해 중심. 또래와의 협력 학습 효과적.</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: S.primary, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>관심사</div>
              <div>수학 약함 · 영어 강함 · 책 읽기 좋아함</div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 10, color: S.primary, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>우려 사항</div>
              <div>새 환경 적응에 2-3주 필요. 강사와 친밀감 형성이 중요.</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: S.gold, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 700, marginBottom: 4 }}>AI 제안</div>
              <div style={{ padding: 10, background: S.goldSoft, borderRadius: 8, color: S.text, fontWeight: 600 }}>수학 심화 A반 + 영어 정규 C반</div>
            </div>
          </div>

          <button style={{
            marginTop: 16, width: '100%', padding: 10,
            background: S.surface, color: S.primary,
            border: `1px solid ${S.primary}`, borderRadius: 8,
            fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}><EyIcon name="arrowDown" size={12} />학부모에게 인쇄해서 전달</button>
        </Card>
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 7) 학생상담 — 재원생 케어
// ──────────────────────────────────────────────────────────────────────
function ScreenConsultations() {
  const ongoing = [
    { name: '이도현', grade: '고2', issue: '진로 고민 · 의대 vs 공대', updated: '2일 전', stage: 'AI 분석 완료', color: S.primary, urgent: false },
    { name: '정수아', grade: '고1', issue: '성적 하락 · 영어 -8점',    updated: '3일 전', stage: '면담 필요',     color: S.amber,   urgent: true },
    { name: '강민서', grade: '중2', issue: '수업 집중도 저하',           updated: '5일 전', stage: '관찰 중',       color: S.blue,    urgent: false },
    { name: '한지우', grade: '중3', issue: '학부모 요청 · 면담',         updated: '1주 전', stage: '예약 완료',     color: S.purple,  urgent: false },
  ];

  return (
    <AppShell active="consultation" title="학생상담" breadcrumb="EYWA · 학생 · 학생상담"
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <GhostButton icon="sparkle">AI 케어 진단</GhostButton>
          <PrimaryButton icon="plus">새 상담 기록</PrimaryButton>
        </div>
      }>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['진행중', '11', '건',  S.primary, '+3 신규'],
          ['긴급',   '3',  '건',  S.danger,  '24시간 이내'],
          ['예약',   '8',  '건',  S.blue,    '이번 주'],
          ['완료',   '42', '건',  S.textDim, '이번 달'],
        ].map((s, i) => (
          <Card key={i} padding={16}>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s[0]}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: s[3], letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{s[1]}</span>
              <span style={{ fontSize: 11, color: S.textDim }}>{s[2]}</span>
            </div>
            <div style={{ fontSize: 11, color: S.textFaint, marginTop: 4 }}>{s[4]}</div>
          </Card>
        ))}
      </div>

      {/* Kanban-ish 3 columns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        {[
          { title: '예약 / 대기', count: 4, color: S.gold, items: [
            { name: '윤소율', issue: '학습 태도 점검', when: '오늘 17:40', color: S.primary },
            { name: '한지우', issue: '학부모 요청 면담', when: '내일 14:00', color: S.purple },
            { name: '신아린', issue: '신규생 적응', when: '5/30', color: S.gold },
          ]},
          { title: '진행 중', count: 5, color: S.primary, items: [
            { name: '이도현', issue: '진로 고민 · 의대 vs 공대', when: 'AI 분석 완료', color: S.primary, hot: true },
            { name: '정수아', issue: '성적 하락 · 영어 -8점',     when: '면담 필요',     color: S.amber, urgent: true },
            { name: '강민서', issue: '집중도 저하 관찰',          when: '4일째',         color: S.blue },
          ]},
          { title: '완료 (이번 주)', count: 6, color: S.textDim, items: [
            { name: '박서진', issue: '교우 관계', when: '5/26 완료', color: S.primary },
            { name: '최예준', issue: '학습 동기', when: '5/25 완료', color: S.blue },
            { name: '김도윤', issue: '시간 관리', when: '5/24 완료', color: S.purple },
          ]},
        ].map((col, ci) => (
          <Card key={ci} padding={0}>
            <div style={{ padding: '14px 16px', borderBottom: `1px solid ${S.line}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: col.color }} />
                <span style={{ fontSize: 13, color: S.text, fontWeight: 700 }}>{col.title}</span>
              </div>
              <Pill color={col.color} style={{ fontSize: 10 }}>{col.count}</Pill>
            </div>
            <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {col.items.map((it, ii) => (
                <div key={ii} style={{
                  padding: 12, borderRadius: 10, background: it.urgent ? S.dangerSoft : S.bgSoft,
                  border: it.urgent ? `1px solid ${S.danger}40` : `1px solid transparent`,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Initial name={it.name} color={it.color} size={24} />
                    <span style={{ fontSize: 13, color: S.text, fontWeight: 700 }}>{it.name}</span>
                    {it.urgent && <Pill color={S.danger} soft={false} style={{ fontSize: 9, marginLeft: 'auto' }}>긴급</Pill>}
                    {it.hot && <Pill color={S.primary} style={{ fontSize: 9, marginLeft: 'auto' }}>AI</Pill>}
                  </div>
                  <div style={{ fontSize: 12, color: S.textDim, lineHeight: 1.4 }}>{it.issue}</div>
                  <div style={{ fontSize: 10, color: S.textFaint, fontFamily: S.fontMono, letterSpacing: 0.5 }}>{it.when}</div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────────────────
// 8) 퇴원관리
// ──────────────────────────────────────────────────────────────────────
function ScreenWithdrawal() {
  const recent = [
    { name: '최서윤', grade: '고2', reason: '입시학원 이전',  date: '2026.05.20', duration: '14개월', recoverable: false, color: S.textDim },
    { name: '박지원', grade: '중3', reason: '성적 정체 · 만족도 하락', date: '2026.05.15', duration: '8개월', recoverable: true, color: S.amber },
    { name: '윤민호', grade: '고1', reason: '경제 사정',     date: '2026.05.08', duration: '22개월', recoverable: true, color: S.gold },
    { name: '이지안', grade: '중2', reason: '이사',           date: '2026.04.30', duration: '6개월',  recoverable: false, color: S.textDim },
  ];

  const reasons = [
    { label: '입시학원 이전', count: 8, pct: 33, color: S.primary },
    { label: '경제 사정',     count: 5, pct: 21, color: S.gold },
    { label: '이사',           count: 4, pct: 17, color: S.blue },
    { label: '성적 정체',     count: 4, pct: 17, color: S.amber },
    { label: '기타',           count: 3, pct: 12, color: S.textDim },
  ];

  return (
    <AppShell active="withdrawal" title="퇴원관리" breadcrumb="EYWA · 학생 · 퇴원관리"
      actions={<GhostButton icon="arrowDown">월별 리포트</GhostButton>}>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        {[
          ['이번 달 퇴원', '2',  '명', S.text,    '전월 대비 -3'],
          ['올해 누적',   '24', '명', S.textDim, '연 9.7%'],
          ['평균 재원',   '14', '개월', S.primary, '안정'],
          ['회복 가능',   '7',  '명', S.amber,   '리텐션 캠페인 진행'],
        ].map((s, i) => (
          <Card key={i} padding={16}>
            <div style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{s[0]}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: s[3], letterSpacing: -0.6, fontVariantNumeric: 'tabular-nums' }}>{s[1]}</span>
              <span style={{ fontSize: 11, color: S.textDim }}>{s[2]}</span>
            </div>
            <div style={{ fontSize: 11, color: S.textFaint, marginTop: 4 }}>{s[4]}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
        {/* Recent list */}
        <Card padding={0}>
          <div style={{ padding: '16px 22px', borderBottom: `1px solid ${S.line}` }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: S.text, margin: 0, letterSpacing: -0.3 }}>최근 퇴원 ({recent.length}건)</h2>
            <div style={{ fontSize: 11, color: S.textDim, marginTop: 3 }}>회복 가능 학생은 자동으로 리텐션 후보에 추가됩니다.</div>
          </div>
          {recent.map((r, i) => (
            <div key={i} style={{
              padding: '14px 22px',
              borderBottom: i < recent.length - 1 ? `1px solid ${S.line}` : 'none',
              display: 'grid', gridTemplateColumns: '1.6fr 70px 1.6fr 100px 90px 60px',
              gap: 14, alignItems: 'center',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Initial name={r.name} color={r.color} size={28} />
                <span style={{ fontSize: 14, color: S.text, fontWeight: 700 }}>{r.name}</span>
              </div>
              <span style={{ fontSize: 12, color: S.textDim }}>{r.grade}</span>
              <span style={{ fontSize: 13, color: S.text }}>{r.reason}</span>
              <span style={{ fontSize: 11, color: S.textFaint, fontFamily: S.fontMono }}>{r.date}</span>
              <span style={{ fontSize: 11, color: S.textDim, fontFamily: S.fontMono }}>{r.duration}</span>
              {r.recoverable
                ? <Pill color={S.amber}>회복 가능</Pill>
                : <span style={{ fontSize: 11, color: S.textFaint }}>—</span>}
            </div>
          ))}
        </Card>

        {/* Reason breakdown */}
        <Card padding={20}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: S.text, margin: 0, letterSpacing: -0.2 }}>올해 퇴원 사유</h2>
          <div style={{ fontSize: 11, color: S.textDim, marginTop: 4, marginBottom: 18 }}>2026 누적 24건</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {reasons.map((r, i) => (
              <div key={i}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                  <span style={{ fontSize: 12, color: S.text, fontWeight: 600 }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: S.textDim, fontVariantNumeric: 'tabular-nums', fontFamily: S.fontMono }}>{r.count}건 · {r.pct}%</span>
                </div>
                <div style={{ height: 6, background: S.bgSoft, borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${r.pct}%`, height: '100%', background: r.color }} />
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 20, padding: 14, borderRadius: 10,
            background: S.amberSoft, border: `1px solid ${S.amber}40`,
            display: 'flex', alignItems: 'flex-start', gap: 10,
          }}>
            <div style={{ width: 24, height: 24, borderRadius: 7, background: S.amber, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <EyIcon name="sparkle" size={12} />
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: S.text }}>AI 인사이트</div>
              <div style={{ fontSize: 11, color: S.textDim, marginTop: 3, lineHeight: 1.5 }}>
                "성적 정체" 사유 4건은 모두 도입 12개월 차에 발생. 1년차 학습 만족도 점검 추천.
              </div>
            </div>
          </div>
        </Card>
      </div>
    </AppShell>
  );
}

Object.assign(window, { ScreenStudents, ScreenEnrollment, ScreenConsultations, ScreenWithdrawal });
