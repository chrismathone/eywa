// landing-network.jsx — B · Daylight (editorial direction)
// Inspired by — but not copying — typical Korean academy SaaS landings.
// Tone: editorial, manifesto-like, confident. Big numbers, asymmetric grids,
// monochrome logo wall, quote-as-section testimonials.

const P_NET = EYWA_PALETTES.net;

// Local editorial palette overrides (kept inside this file so dashboards aren't affected)
const E = {
  ...P_NET,
  bg: '#fbf9f3',           // warm ivory
  bgSoft: '#f1ede2',       // softer cream
  surface: '#ffffff',
  text: '#1a1f1c',
  textDim: '#5a635f',
  textFaint: '#9aa39d',
  ink: '#0d1110',          // deep black-green for inverted sections
  line: 'rgba(13, 17, 16, 0.10)',
  lineStrong: 'rgba(13, 17, 16, 0.20)',
  primary: '#1a5f3c',      // deep forest
  primarySoft: 'rgba(26, 95, 60, 0.08)',
  gold: '#b8893a',
  goldSoft: 'rgba(184, 137, 58, 0.14)',
};

// ────────────────────────────────────────────────────────────
// Scroll reveal + global keyframes
// ────────────────────────────────────────────────────────────
const REVEAL_STYLE = `
@keyframes eywa-mq-l { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes eywa-mq-r { from { transform: translateX(-50%); } to { transform: translateX(0); } }
.eywa-reveal { opacity: 0; transform: translateY(40px); transition: opacity 0.85s cubic-bezier(.2,.6,.2,1), transform 0.85s cubic-bezier(.2,.6,.2,1); }
.eywa-reveal.in { opacity: 1; transform: translateY(0); }
.eywa-rd-1 { transition-delay: 0.08s; }
.eywa-rd-2 { transition-delay: 0.18s; }
.eywa-rd-3 { transition-delay: 0.28s; }
.eywa-rd-4 { transition-delay: 0.38s; }
.eywa-mq-track { display: flex; gap: 56px; animation-duration: 48s; animation-iteration-count: infinite; animation-timing-function: linear; width: max-content; align-items: center; }
.eywa-mq-track.l { animation-name: eywa-mq-l; }
.eywa-mq-track.r { animation-name: eywa-mq-r; }
`;

function useReveal() {
  const ref = React.useRef(null);
  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const t = setTimeout(() => el.classList.add('in'), 1500);
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { el.classList.add('in'); clearTimeout(t); } });
    }, { threshold: 0.1 });
    obs.observe(el);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, []);
  return ref;
}

function Reveal({ delay = 0, children, style, as: As = 'div' }) {
  const ref = useReveal();
  const cls = `eywa-reveal${delay ? ` eywa-rd-${delay}` : ''}`;
  return <As ref={ref} className={cls} style={style}>{children}</As>;
}

// ────────────────────────────────────────────────────────────
// Tiny atoms
// ────────────────────────────────────────────────────────────
function Eyebrow({ children, color = E.primary, style }) {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 10,
      fontSize: 12, fontWeight: 700, color, letterSpacing: 2, textTransform: 'uppercase',
      whiteSpace: 'nowrap',
      ...style,
    }}>
      <span style={{ width: 22, height: 1, background: color }} />
      {children}
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Nav
// ────────────────────────────────────────────────────────────
function Nav() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '20px 64px', borderBottom: `1px solid ${E.line}`,
      background: E.bg, position: 'sticky', top: 0, zIndex: 30,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, background: E.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="8" cy="8" r="2" fill="#fff" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: E.text, letterSpacing: -0.5 }}>EYWA</div>
        </div>
        <div style={{ display: 'flex', gap: 28, fontSize: 14, color: E.textDim, fontWeight: 500 }}>
          <a>기능</a><a>요금</a><a>도입 사례</a><a>고객 지원</a><a>회사 소개</a>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <a style={{ fontSize: 14, color: E.text, fontWeight: 500 }}>로그인</a>
        <button style={{
          padding: '10px 18px', borderRadius: 8,
          background: E.ink, color: '#fff', border: 'none',
          fontSize: 14, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
        }}>무료로 시작하기</button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Hero — editorial, no split-screen floating cards.
// Big typography + subtle organic background pattern + stats row.
// ────────────────────────────────────────────────────────────
function HeroBackground() {
  return (
    <svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 1440 760"
      style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }}>
      <defs>
        <radialGradient id="hero-bloom-r" cx="80%" cy="20%" r="55%">
          <stop offset="0%" stopColor={E.primary} stopOpacity="0.18" />
          <stop offset="100%" stopColor={E.primary} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="hero-bloom-b" cx="10%" cy="90%" r="50%">
          <stop offset="0%" stopColor={E.gold} stopOpacity="0.16" />
          <stop offset="100%" stopColor={E.gold} stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#hero-bloom-r)" />
      <rect width="100%" height="100%" fill="url(#hero-bloom-b)" />
      {/* organic flowing lines */}
      <g stroke={E.primary} strokeWidth="1" fill="none" opacity="0.25">
        <path d="M -50 220 Q 360 80, 720 220 T 1490 200" />
        <path d="M -50 380 Q 360 240, 720 380 T 1490 360" />
        <path d="M -50 540 Q 360 400, 720 540 T 1490 520" />
      </g>
    </svg>
  );
}

function Hero() {
  return (
    <div style={{ position: 'relative', padding: '92px 64px 80px', overflow: 'hidden' }}>
      <HeroBackground />
      <div style={{ position: 'relative', maxWidth: 1100 }}>
        <Reveal>
          <Eyebrow color={E.primary} style={{ marginBottom: 28 }}>학원관리 SaaS · v2.0</Eyebrow>
        </Reveal>

        <Reveal delay={1}>
          <h1 style={{
            fontSize: 96, fontWeight: 800, lineHeight: 1.03, letterSpacing: -3.5,
            color: E.text, margin: 0,
          }}>
            학원의 모든 일을<br />
            <span style={{
              display: 'inline-block', position: 'relative',
            }}>
              <span style={{ position: 'relative', zIndex: 1, color: E.primary }}>한 곳에서.</span>
              <span style={{
                position: 'absolute', left: -4, right: -4, bottom: 10, height: 16,
                background: E.goldSoft, zIndex: 0, borderRadius: 4,
              }} />
            </span>
          </h1>
        </Reveal>

        <Reveal delay={2}>
          <p style={{
            fontSize: 19, lineHeight: 1.7, color: E.textDim, marginTop: 32,
            maxWidth: 580,
          }}>
            출결 · 수납 · 상담 · 학부모 알림까지,<br />
            학원 운영에 꼭 필요한 모든 기능을 한 화면에서 관리하세요.
          </p>
        </Reveal>

        <Reveal delay={3}>
          <div style={{ display: 'flex', gap: 12, marginTop: 40, alignItems: 'center' }}>
            <button style={{
              padding: '15px 28px', borderRadius: 10,
              background: E.ink, color: '#fff', border: 'none',
              fontSize: 15, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>무료로 시작하기 <EyIcon name="arrowRight" size={14} /></button>
            <button style={{
              padding: '15px 22px', borderRadius: 10,
              background: 'transparent', color: E.text,
              border: `1px solid ${E.lineStrong}`,
              fontSize: 15, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}>요금 안내</button>
            <div style={{ fontSize: 13, color: E.textFaint, marginLeft: 12 }}>신용카드 없이 · 첫 달 무료</div>
          </div>
        </Reveal>

        {/* Inline stats — editorial */}
        <Reveal delay={4}>
          <div style={{
            display: 'flex', gap: 80, marginTop: 80, paddingTop: 32,
            borderTop: `1px solid ${E.line}`,
          }}>
            {[
              ['47', '도입 학원', '전국 단위'],
              ['12,800+', '관리되는 학생', '월 평균'],
              ['4.9', '원장님 만족도', '5점 만점'],
              ['28%', '행정 시간 감소', '도입 6개월 후'],
            ].map((s, i) => (
              <div key={i}>
                <div style={{
                  fontSize: 44, fontWeight: 800, color: E.text,
                  letterSpacing: -1.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                }}>{s[0]}</div>
                <div style={{ fontSize: 14, color: E.text, fontWeight: 600, marginTop: 10 }}>{s[1]}</div>
                <div style={{ fontSize: 12, color: E.textFaint, marginTop: 2, fontFamily: E.fontMono, letterSpacing: 0.5 }}>{s[2]}</div>
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Flow — abstract data flow showing how one action propagates
// Instead of central node + avatars, we show a left-to-right story:
// "학생 한 명이 등원하면" → 4 simultaneous outcomes
// ────────────────────────────────────────────────────────────
function Flow() {
  const outcomes = [
    { tag: '학부모',  body: '카카오톡으로 등원 알림이 즉시 전송됩니다.',                 color: E.gold },
    { tag: '강사',    body: '담당 강사의 출석부에 자동으로 체크됩니다.',                 color: E.primary },
    { tag: '원장',    body: '대시보드 출석률 KPI가 실시간으로 갱신됩니다.',              color: '#1f6ba8' },
    { tag: '회계',    body: '수업 잔여 차감과 수강료 처리가 자동으로 이루어집니다.',     color: '#7a4ba8' },
  ];

  return (
    <div style={{
      background: E.bgSoft, padding: '120px 64px',
      borderTop: `1px solid ${E.line}`, borderBottom: `1px solid ${E.line}`,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 80, alignItems: 'flex-start' }}>
          <div>
            <Reveal>
              <Eyebrow style={{ marginBottom: 20 }}>01 — 연결</Eyebrow>
              <h2 style={{
                fontSize: 56, fontWeight: 800, color: E.text, margin: 0,
                letterSpacing: -1.8, lineHeight: 1.05,
              }}>
                한 번의 액션,<br />
                <span style={{ color: E.primary }}>모두에게 흐른다.</span>
              </h2>
            </Reveal>
            <Reveal delay={1}>
              <p style={{
                fontSize: 16, color: E.textDim, marginTop: 28, lineHeight: 1.75,
                maxWidth: 360,
              }}>
                학생이 학원에 들어선 그 순간, 학부모·강사·원장·회계까지 동시에 연결됩니다. 따로 입력하지 않아도, 따로 알리지 않아도.
              </p>
            </Reveal>
          </div>

          <div>
            {/* "trigger" event card */}
            <Reveal delay={1}>
              <div style={{
                background: E.surface,
                color: E.text,
                borderRadius: 16,
                border: `1px solid ${E.line}`,
                padding: '22px 28px',
                display: 'flex', alignItems: 'center', gap: 18,
                boxShadow: '0 16px 36px rgba(26, 95, 60, 0.08)',
                position: 'relative', overflow: 'hidden',
              }}>
                {/* left accent stripe */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, width: 4, height: '100%',
                  background: E.primary,
                }} />
                <div style={{
                  width: 48, height: 48, borderRadius: 12,
                  background: E.primary, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  boxShadow: `0 6px 16px ${E.primarySoft}`,
                }}><EyIcon name="check" size={22} strokeWidth={2.4} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontSize: 11, color: E.primary, fontFamily: E.fontMono,
                    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4,
                    fontWeight: 700,
                  }}>오후 4:02 · 트리거</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: E.text, letterSpacing: -0.3 }}>강민서 학생이 등원했습니다.</div>
                </div>
                <div style={{
                  fontSize: 11, padding: '5px 10px', borderRadius: 999,
                  background: E.primarySoft, color: E.primary,
                  fontFamily: E.fontMono, letterSpacing: 0.5, fontWeight: 700,
                }}>1 EVENT</div>
              </div>
            </Reveal>

            {/* divider with branching arrows */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 56px', position: 'relative', height: 56 }}>
              <svg width="100%" height="100%" viewBox="0 0 800 56" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0 }}>
                {[0.125, 0.375, 0.625, 0.875].map((x, i) => (
                  <g key={i}>
                    <path d={`M 400 0 Q 400 28 ${x * 800} 28 L ${x * 800} 56`} stroke={E.lineStrong} strokeWidth="1.4" fill="none" />
                    <circle cx={x * 800} cy="56" r="3" fill={outcomes[i].color} />
                  </g>
                ))}
              </svg>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
              {outcomes.map((o, i) => (
                <Reveal key={i} delay={(i + 1)}>
                  <div style={{
                    background: E.surface, borderRadius: 14, padding: 18,
                    border: `1px solid ${E.line}`, height: '100%',
                    borderTop: `3px solid ${o.color}`,
                  }}>
                    <div style={{
                      fontSize: 11, fontWeight: 700, color: o.color,
                      fontFamily: E.fontMono, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8,
                    }}>→ {o.tag}</div>
                    <div style={{ fontSize: 13.5, color: E.text, lineHeight: 1.55, fontWeight: 500 }}>
                      {o.body}
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>

            <Reveal delay={4}>
              <div style={{
                marginTop: 24, padding: '14px 20px',
                background: E.surface, border: `1px solid ${E.line}`, borderRadius: 12,
                display: 'inline-flex', alignItems: 'center', gap: 12,
                fontSize: 13, color: E.text,
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: E.primary, boxShadow: `0 0 0 4px ${E.primarySoft}` }} />
                <span style={{ fontWeight: 600 }}>0.4초 안에 동기화 완료</span>
                <span style={{ color: E.textDim }}>· Supabase Realtime</span>
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Logo marquee — monochrome wordmarks, two rows opposite direction
// ────────────────────────────────────────────────────────────
function LogoWall() {
  // Light "live network" section — keeps the impact (counters + LIVE pulse)
  // and premium feel (data mosaic with student counts), but on cream background.
  const tiles = [
    { name: '청솔학원',  loc: '경기 분당',    students: 312, span: 4, accent: true },
    { name: 'MS어학원',  loc: '경기 일산',    students: 187, span: 3 },
    { name: '명문국어',  loc: '서울 강남',    students: 240, span: 5 },
    { name: '수림수학',  loc: '서울 잠실',    students: 198, span: 3 },
    { name: '하이클래스', loc: '서울 목동',    students: 156, span: 4 },
    { name: '에듀온',    loc: '부산 해운대',  students: 421, span: 5, accent: true },
    { name: '베스트영어', loc: '대구 수성',    students: 168, span: 3 },
    { name: '인재원',    loc: '서울 강남',    students: 248, span: 3 },
    { name: '드림에듀',  loc: '대전 둔산',    students: 134, span: 3 },
    { name: '큐브어학원', loc: '광주 상무',    students: 92,  span: 3 },
  ];

  const counters = [
    { label: '오늘 출석 체크',    value: '12,847', sub: '실시간 누적',  color: E.primary },
    { label: '학부모 알림 발송',  value: '8,326',  sub: '카톡 + 푸시',  color: '#1f6ba8' },
    { label: '진행 중 상담',     value: '142',    sub: '17개 학원',   color: '#7a4ba8' },
    { label: '함께하는 학원',     value: '47',     sub: '전국',         color: E.gold },
  ];

  return (
    <div style={{
      background: E.bgSoft, padding: '120px 0 110px',
      position: 'relative', overflow: 'hidden',
      borderTop: `1px solid ${E.line}`, borderBottom: `1px solid ${E.line}`,
    }}>
      {/* soft ambient washes */}
      <div style={{
        position: 'absolute', top: -150, left: -150, width: 520, height: 520,
        background: `radial-gradient(circle, ${E.primarySoft}, transparent 60%)`,
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: 80, right: -180, width: 540, height: 540,
        background: `radial-gradient(circle, ${E.goldSoft}, transparent 60%)`, opacity: 0.8,
        pointerEvents: 'none',
      }} />
      {/* faint grid */}
      <svg width="100%" height="100%" preserveAspectRatio="none"
        viewBox="0 0 1440 980"
        style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }}>
        <defs>
          <pattern id="logo-grid-light" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={E.ink} strokeWidth="0.4" opacity="0.06" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#logo-grid-light)" />
      </svg>

      <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '0 64px' }}>
        {/* Header */}
        <Reveal>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 56 }}>
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 10, marginBottom: 18,
                fontSize: 11, fontWeight: 700, color: E.primary, letterSpacing: 2, textTransform: 'uppercase',
              }}>
                <span style={{ width: 22, height: 1, background: E.primary }} />
                LIVE NETWORK
              </div>
              <h2 style={{
                fontSize: 44, fontWeight: 800, color: E.text, margin: 0,
                letterSpacing: -1.4, lineHeight: 1.1, maxWidth: 720,
              }}>
                지금 이 순간에도<br />
                전국 <span style={{
                  backgroundImage: `linear-gradient(transparent 62%, ${E.goldSoft} 62%, ${E.goldSoft} 92%, transparent 92%)`,
                  boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
                  padding: '0 4px', color: E.primary,
                  fontVariantNumeric: 'tabular-nums',
                }}>47개 학원이</span> EYWA를 쓰고 있어요.
              </h2>
            </div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 10,
              padding: '8px 14px', borderRadius: 999,
              background: E.surface, border: `1px solid ${E.line}`,
              color: E.primary, fontSize: 11, fontFamily: E.fontMono,
              letterSpacing: 1, textTransform: 'uppercase',
              boxShadow: '0 4px 12px rgba(13,17,16,0.04)',
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: E.primary,
                boxShadow: `0 0 0 4px ${E.primarySoft}`,
              }} />
              Supabase Realtime · 2026.05.27 14:32
            </div>
          </div>
        </Reveal>

        {/* Live counters strip */}
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16,
          marginBottom: 56,
        }}>
          {counters.map((c, i) => (
            <Reveal key={i} delay={(i + 1)}>
              <div style={{
                position: 'relative', padding: 24, borderRadius: 16,
                background: E.surface, border: `1px solid ${E.line}`,
                overflow: 'hidden', height: '100%',
                boxShadow: '0 4px 14px rgba(13,17,16,0.04)',
              }}>
                <div style={{
                  position: 'absolute', top: -24, right: -24, width: 110, height: 110,
                  borderRadius: '50%', background: c.color, opacity: 0.12,
                  filter: 'blur(8px)', pointerEvents: 'none',
                }} />
                <div style={{
                  position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14,
                }}>
                  <div style={{ fontSize: 11, color: E.textDim, fontFamily: E.fontMono, letterSpacing: 1, textTransform: 'uppercase' }}>{c.label}</div>
                  <div style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 3,
                    background: `${c.color}18`, color: c.color,
                    fontFamily: E.fontMono, letterSpacing: 0.5, fontWeight: 700,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: c.color }} />
                    LIVE
                  </div>
                </div>
                <div style={{
                  position: 'relative', fontSize: 44, fontWeight: 800, color: E.text,
                  letterSpacing: -1.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
                }}>{c.value}</div>
                <div style={{
                  position: 'relative', marginTop: 8, fontSize: 12, color: E.textDim,
                }}>{c.sub}</div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* Bento mosaic of academies */}
        <Reveal delay={1}>
          <div style={{
            fontSize: 11, color: E.textDim, fontFamily: E.fontMono,
            letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 18,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: E.gold }} />
            함께 만들어가는 학원들 · 10/47
          </div>
        </Reveal>

        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(12, 1fr)', gap: 10,
        }}>
          {tiles.map((t, i) => (
            <Reveal key={t.name} delay={(i % 4) + 1}
              style={{ gridColumn: `span ${t.span}` }}>
              <div style={{
                height: 116,
                background: t.accent
                  ? `linear-gradient(135deg, ${E.primary} 0%, #2a7a52 100%)`
                  : E.surface,
                color: t.accent ? '#fff' : E.text,
                border: t.accent ? 'none' : `1px solid ${E.line}`,
                borderRadius: 14, padding: 18,
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                position: 'relative', overflow: 'hidden',
                boxShadow: t.accent
                  ? `0 14px 32px rgba(26, 95, 60, 0.20)`
                  : '0 2px 8px rgba(13,17,16,0.03)',
              }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: -0.4 }}>{t.name}</div>
                  <div style={{
                    fontSize: 11, color: t.accent ? 'rgba(255,255,255,0.78)' : E.textDim,
                    marginTop: 3,
                  }}>{t.loc}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{
                      fontSize: 22, fontWeight: 800, letterSpacing: -0.6, lineHeight: 1,
                      fontVariantNumeric: 'tabular-nums',
                      color: t.accent ? '#fff' : E.primary,
                    }}>{t.students}</span>
                    <span style={{
                      marginLeft: 4, fontSize: 10, color: t.accent ? 'rgba(255,255,255,0.65)' : E.textFaint,
                      fontFamily: E.fontMono, letterSpacing: 0.5,
                    }}>학생</span>
                  </div>
                  <span style={{
                    fontSize: 9, padding: '2px 6px', borderRadius: 3,
                    background: t.accent ? 'rgba(255,255,255,0.20)' : E.primarySoft,
                    color: t.accent ? '#fff' : E.primary,
                    fontFamily: E.fontMono, letterSpacing: 0.5, fontWeight: 700,
                  }}>● ACTIVE</span>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* footer status bar */}
        <Reveal delay={2}>
          <div style={{
            marginTop: 24, padding: '14px 20px', borderRadius: 12,
            background: E.surface, border: `1px solid ${E.line}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            fontSize: 12, color: E.textDim,
            fontFamily: E.fontMono, letterSpacing: 0.5,
          }}>
            <span>// 전국 47개 학원 · 12,800+ 학생 · 220+ 강사</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span>uptime 99.97%</span>
              <span style={{ color: E.line }}>·</span>
              <span style={{ color: E.primary, fontWeight: 600 }}>SLA 99.9%</span>
            </span>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Manifesto — 5 numbered statements, editorial style. No cards.
// ────────────────────────────────────────────────────────────
function Manifesto() {
  const items = [
    {
      no: '01',
      title: '운영은 쉽게, 교육은 깊게.',
      body: '청구서 자동 생성, 미납 관리, 출결 체크, 상담 기록까지\n매일 반복되는 일은 EYWA가 합니다.',
      accent: E.primary,
      tint: 'rgba(26, 95, 60, 0.07)',
      icon: 'roots',
    },
    {
      no: '02',
      title: '더 많은 기능이 아닌, 더 깊은 이해.',
      body: '학부모와 진짜로 소통하고 강사와 매끄럽게 연결됩니다.\n학원 운영을 진심으로 이해하는 도구.',
      accent: '#b8893a',
      tint: 'rgba(184, 137, 58, 0.10)',
      icon: 'wave',
    },
    {
      no: '03',
      title: '원장님의 한마디가 로드맵.',
      body: '실제로 운영해본 원장님의 제안만이\n다음 버전의 EYWA를 만듭니다.',
      accent: '#1f6ba8',
      tint: 'rgba(31, 107, 168, 0.08)',
      icon: 'check',
    },
    {
      no: '04',
      title: '처음부터 끝까지 함께.',
      body: '학생 한 명으로 시작할 때도, 분원을 늘릴 때도,\nEYWA는 같은 자리에서 같은 약속을 지킵니다.',
      accent: '#7a4ba8',
      tint: 'rgba(122, 75, 168, 0.08)',
      icon: 'rings',
    },
    {
      no: '05',
      title: '중요한 일에 집중할 수 있도록.',
      body: '수업, 상담, 마케팅. 학원을 키우는 일에 집중하세요.\n나머지는 EYWA에게 맡기세요.',
      accent: '#c44d6d',
      tint: 'rgba(196, 77, 109, 0.08)',
      icon: 'sparkle',
    },
  ];

  return (
    <div style={{ padding: '140px 64px 120px', background: E.bg }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <Reveal>
          <Eyebrow style={{ marginBottom: 28 }}>02 — 약속</Eyebrow>
          <h2 style={{
            fontSize: 56, fontWeight: 800, color: E.text, margin: 0,
            letterSpacing: -1.8, lineHeight: 1.1, maxWidth: 880,
          }}>
            EYWA의 핵심가치는<br />
            <span style={{
              backgroundImage: `linear-gradient(transparent 62%, ${E.goldSoft} 62%, ${E.goldSoft} 92%, transparent 92%)`,
              boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
              padding: '0 4px',
            }}>학원의 성장</span>입니다.
          </h2>
          <p style={{ fontSize: 16, color: E.textDim, marginTop: 24, lineHeight: 1.7, maxWidth: 560 }}>
            기술이 아닌 학원을 위한 도구. EYWA가 매일 지키는 다섯 가지 약속입니다.
          </p>
        </Reveal>

        <div style={{
          marginTop: 72,
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gridAutoRows: 'minmax(220px, auto)',
          gap: 20,
        }}>
          {items.map((it, i) => {
            // 01 spans 3 cols, 02 spans 3 cols, 03 spans 2, 04 spans 2, 05 spans 2
            const spans = [3, 3, 2, 2, 2];
            return (
              <Reveal key={i} delay={(i % 4) + 1} style={{ gridColumn: `span ${spans[i]}` }}>
                <div style={{
                  background: E.surface, borderRadius: 20, padding: '32px 32px 28px',
                  border: `1px solid ${E.line}`, height: '100%',
                  position: 'relative', overflow: 'hidden',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 24,
                }}>
                  {/* tinted corner wash */}
                  <div style={{
                    position: 'absolute', top: -80, right: -80, width: 240, height: 240,
                    borderRadius: '50%', background: it.tint, pointerEvents: 'none',
                  }} />

                  <div style={{ position: 'relative' }}>
                    <div style={{
                      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                      marginBottom: 20,
                    }}>
                      <div style={{
                        display: 'inline-flex', alignItems: 'center', gap: 10,
                        padding: '5px 10px 5px 8px', borderRadius: 999,
                        background: it.tint, color: it.accent,
                        fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
                      }}>
                        <span style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: it.accent, color: '#fff',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 10, fontWeight: 800,
                        }}>{it.no}</span>
                        PROMISE
                      </div>
                      <div style={{
                        width: 40, height: 40, borderRadius: 10,
                        background: it.tint, color: it.accent,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <EyIcon name={it.icon} size={20} />
                      </div>
                    </div>

                    <h3 style={{
                      fontSize: 24, fontWeight: 800, color: E.text, margin: 0,
                      letterSpacing: -0.7, lineHeight: 1.3,
                    }}>{it.title}</h3>
                    <p style={{
                      fontSize: 14, color: E.textDim, marginTop: 12, lineHeight: 1.7,
                      whiteSpace: 'pre-line', margin: '12px 0 0',
                    }}>{it.body}</p>
                  </div>

                  <div style={{
                    position: 'relative',
                    paddingTop: 16, borderTop: `1px solid ${E.line}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  }}>
                    <span style={{
                      fontSize: 10, color: E.textFaint, fontFamily: E.fontMono,
                      letterSpacing: 1.5, textTransform: 'uppercase',
                    }}>{it.no} / 05</span>
                    <span style={{
                      width: 24, height: 1, background: it.accent,
                    }} />
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Testimonials — editorial. One large featured quote + 3 smaller.
// No colored card backgrounds.
// ────────────────────────────────────────────────────────────
function Testimonials() {
  const featured = {
    quote: 'EYWA를 도입한 이후 출결 관리가 완전히 달라졌습니다. 예전엔 수기로 체크하느라 시간도 많이 들고 누락도 잦았는데, 이제는 학생이 등원만 해도 자동으로 출결이 기록되고 학부모에게 알림이 바로 전송됩니다.',
    name: '김수진 원장',
    academy: '새봄가우스 수학학원',
    loc: '경기 남양주',
    metric: '월 평균 행정시간 28% 감소',
    avatar: '김',
  };
  const others = [
    {
      quote: '자동청구서 기능 덕분에 매달 청구 업무가 간단해졌습니다. 수강료가 자동 계산되어 청구되니 실수가 줄고, 학부모도 청구 내역을 명확히 확인할 수 있습니다.',
      name: '박정호 원장', academy: '바른스터디', loc: '서울 강북구', avatar: '박',
    },
    {
      quote: '출결앱과 학부모앱을 추가 비용 없이 사용할 수 있어 부담이 없었습니다. 학부모가 자녀의 출결과 알림을 직접 확인할 수 있어 신뢰가 높아졌습니다.',
      name: '이연우 원장', academy: '티클래스 호평', loc: '경기 남양주', avatar: '이',
    },
    {
      quote: '상담 내용이 AI로 자동 정리되고, 필요한 안내는 바로 메시지로 전달할 수 있어 업무 효율이 매끄럽습니다. 학부모 응대가 훨씬 수월해졌습니다.',
      name: '정민호 원장', academy: '유클리드', loc: '경기 의정부', avatar: '정',
    },
  ];

  return (
    <div style={{ padding: '120px 64px', background: E.bg }}>
      <div style={{ maxWidth: 1280, margin: '0 auto' }}>
        <Reveal>
          <Eyebrow style={{ marginBottom: 20 }}>03 — 도입 사례</Eyebrow>
          <h2 style={{
            fontSize: 52, fontWeight: 800, color: E.text, margin: 0,
            letterSpacing: -1.6, lineHeight: 1.1, maxWidth: 880,
          }}>
            원장님들의 진짜 이야기.
          </h2>
        </Reveal>

        {/* Featured */}
        <Reveal delay={1}>
          <div style={{
            marginTop: 64, padding: '48px 56px',
            background: E.surface, borderRadius: 24,
            border: `1px solid ${E.line}`,
            display: 'grid', gridTemplateColumns: '1fr 320px', gap: 56, alignItems: 'flex-start',
            position: 'relative', overflow: 'hidden',
          }}>
            {/* subtle accent corner */}
            <div style={{
              position: 'absolute', top: 0, left: 0, width: 4, height: '100%', background: E.primary,
            }} />
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                fontSize: 11, fontWeight: 700, color: E.primary, letterSpacing: 2, textTransform: 'uppercase',
                marginBottom: 28,
              }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 24, height: 24, borderRadius: '50%', background: E.primarySoft,
                }}>
                  <svg width="11" height="9" viewBox="0 0 11 9" fill="none">
                    <path d="M0 9V5.4C0 3.78 0.45 2.43 1.35 1.35C2.25 0.45 3.51 0 5.13 0V1.62C3.69 1.62 2.7 2.43 2.16 4.05H4.5V9H0Z" fill={E.primary} />
                    <path d="M6.5 9V5.4C6.5 3.78 6.95 2.43 7.85 1.35C8.75 0.45 10.01 0 11.63 0L11 1.62C9.69 1.62 8.7 2.43 8.16 4.05H10.5V9H6.5Z" fill={E.primary} />
                  </svg>
                </span>
                실제 도입 사례
              </div>
              <p style={{
                fontSize: 28, fontWeight: 500, color: E.text, margin: 0,
                lineHeight: 1.55, letterSpacing: -0.6,
                textWrap: 'pretty',
              }}>
                EYWA를 도입한 이후 출결 관리가 완전히 달라졌습니다. 예전엔 수기로 체크하느라 시간도 많이 들고 누락도 잦았는데, 이제는 학생이 등원만 해도 자동으로 출결이 기록되고 학부모에게 알림이 바로 전송됩니다.
              </p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 14, marginTop: 36,
                paddingTop: 24, borderTop: `1px solid ${E.line}`,
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, color: E.text, fontWeight: 700 }}>{featured.name}</div>
                  <div style={{ fontSize: 13, color: E.textDim, marginTop: 2 }}>{featured.academy} · {featured.loc}</div>
                </div>
                <div style={{ display: 'flex', gap: 1, color: E.gold, fontSize: 14, letterSpacing: 1 }}>★★★★★</div>
              </div>
            </div>
            <div style={{
              padding: 28, background: E.bgSoft, borderRadius: 16,
              border: `1px solid ${E.line}`,
            }}>
              <div style={{ fontSize: 11, color: E.primary, fontFamily: E.fontMono, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12 }}>도입 효과</div>
              <div style={{
                fontSize: 44, fontWeight: 800, color: E.text,
                letterSpacing: -1.6, lineHeight: 1, fontVariantNumeric: 'tabular-nums',
              }}>28<span style={{ fontSize: 24, color: E.textDim, fontWeight: 600 }}>%</span></div>
              <div style={{ fontSize: 14, color: E.text, marginTop: 10, fontWeight: 600 }}>월 평균 행정시간 감소</div>
              <div style={{ fontSize: 12, color: E.textFaint, marginTop: 4, fontFamily: E.fontMono }}>6개월 실측 평균</div>
              <div style={{ borderTop: `1px solid ${E.line}`, marginTop: 20, paddingTop: 16, fontSize: 12, color: E.textDim, lineHeight: 1.8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>출결 누락</span><span style={{ color: E.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>0건</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>학부모 항의</span><span style={{ color: E.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>-80%</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>신규 등록 전환</span><span style={{ color: E.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>+17pt</span></div>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Others — 3 quotes */}
        <div style={{
          marginTop: 24, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16,
        }}>
          {others.map((c, i) => (
            <Reveal key={i} delay={(i % 4) + 1}>
              <div style={{
                background: E.surface, borderRadius: 16, padding: '28px 28px 24px',
                border: `1px solid ${E.line}`, height: '100%',
                display: 'flex', flexDirection: 'column',
                position: 'relative',
              }}>
                <div style={{ display: 'flex', gap: 1, color: E.gold, fontSize: 13, letterSpacing: 1, marginBottom: 14 }}>★★★★★</div>
                <p style={{
                  flex: 1, fontSize: 14.5, color: E.text, margin: 0,
                  lineHeight: 1.65, fontWeight: 500, textWrap: 'pretty',
                }}>{c.quote}</p>
                <div style={{
                  marginTop: 20, paddingTop: 16, borderTop: `1px solid ${E.line}`,
                }}>
                  <div style={{ fontSize: 13, color: E.text, fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: E.textDim, marginTop: 2 }}>{c.academy} · {c.loc}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// Pricing — refined, monochrome with single accent
// ────────────────────────────────────────────────────────────
function Pricing() {
  const plans = [
    {
      name: '스타터', sub: '시작하는 학원에',
      features: ['재원생 50명까지', '12개 메뉴 전체', '학부모 카톡 알림'],
    },
    {
      name: '프로', sub: '대부분의 학원에 적합', highlight: true,
      features: ['재원생 무제한', 'AI 상담분석 월 100회', '카카오 비즈톡', '전화 지원'],
    },
    {
      name: '엔터프라이즈', sub: '대형 · 분원 학원에',
      features: ['분원 통합 관리', 'AI 분석 무제한', '전담 매니저', 'SLA 99.9%'],
    },
  ];

  return (
    <div style={{ padding: '120px 64px', background: E.bgSoft }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <Reveal>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 48 }}>
            <div>
              <Eyebrow style={{ marginBottom: 20 }}>04 — 요금</Eyebrow>
              <h2 style={{
                fontSize: 48, fontWeight: 800, color: E.text, margin: 0,
                letterSpacing: -1.4, lineHeight: 1.1,
              }}>
                정식 출시까지,<br />모든 플랜은 <span style={{ color: E.gold }}>베타</span>.
              </h2>
            </div>
            <div style={{
              maxWidth: 320, padding: 18, background: E.goldSoft,
              border: `1px solid ${E.gold}55`, borderRadius: 12,
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800, color: E.gold,
                letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6,
                display: 'inline-flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: E.gold }} />
                Beta Notice
              </div>
              <p style={{ fontSize: 13, color: E.text, lineHeight: 1.6, margin: 0, fontWeight: 500 }}>
                현재 EYWA는 베타 운영 중입니다.<br />
                정식 출시 후 가격이 변동될 수 있습니다.
              </p>
            </div>
          </div>
        </Reveal>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {plans.map((p, i) => (
            <Reveal key={i} delay={(i + 1)}>
              <div style={{
                background: E.surface,
                color: E.text,
                borderRadius: 20, padding: '32px 28px',
                border: p.highlight
                  ? `2px solid ${E.primary}`
                  : `1px solid ${E.line}`,
                height: '100%', display: 'flex', flexDirection: 'column',
                position: 'relative', overflow: 'hidden',
                boxShadow: p.highlight
                  ? `0 24px 50px rgba(26, 95, 60, 0.14)`
                  : '0 2px 8px rgba(13,17,16,0.03)',
              }}>
                {p.highlight && (
                  <div style={{
                    position: 'absolute', top: -40, right: -40, width: 160, height: 160,
                    borderRadius: '50%', background: E.primarySoft, pointerEvents: 'none',
                  }} />
                )}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.3, color: E.text }}>{p.name}</div>
                  {p.highlight && (
                    <span style={{
                      fontSize: 10, padding: '3px 9px', borderRadius: 999,
                      background: E.primary, color: '#fff', fontWeight: 800, letterSpacing: 0.5,
                    }}>가장 인기</span>
                  )}
                </div>
                <div style={{ position: 'relative', fontSize: 13, color: E.textDim, marginTop: 4 }}>{p.sub}</div>

                {/* Beta price block */}
                <div style={{ position: 'relative', marginTop: 24 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '4px 10px 4px 6px', borderRadius: 999,
                    background: E.goldSoft, color: E.gold,
                    fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
                  }}>
                    <span style={{
                      width: 16, height: 16, borderRadius: '50%',
                      background: E.gold, color: '#fff',
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, fontWeight: 800,
                    }}>β</span>
                    BETA
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
                    <span style={{ fontSize: 40, fontWeight: 800, letterSpacing: -1.2, lineHeight: 1, color: E.text }}>무료</span>
                    <span style={{ fontSize: 13, color: E.textDim }}>· 베타 기간</span>
                  </div>
                  <div style={{
                    fontSize: 11, color: E.textFaint,
                    marginTop: 8, lineHeight: 1.5,
                  }}>
                    정식 출시 후 가격이 변동될 수 있습니다.
                  </div>
                </div>

                <button style={{
                  position: 'relative',
                  marginTop: 24, padding: '12px',
                  background: p.highlight ? E.primary : E.surface,
                  color: p.highlight ? '#fff' : E.text,
                  border: p.highlight ? 'none' : `1px solid ${E.lineStrong}`,
                  borderRadius: 10, fontFamily: 'inherit',
                  fontSize: 14, fontWeight: 700, cursor: 'pointer',
                  boxShadow: p.highlight ? `0 8px 20px rgba(26, 95, 60, 0.25)` : 'none',
                }}>베타 신청하기</button>
                <div style={{
                  position: 'relative',
                  flex: 1, marginTop: 24, paddingTop: 20,
                  borderTop: `1px solid ${E.line}`,
                }}>
                  {p.features.map((f, j) => (
                    <div key={j} style={{
                      fontSize: 13, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8,
                      color: E.text,
                    }}>
                      <span style={{ color: E.primary, flexShrink: 0 }}>
                        <EyIcon name="check" size={13} strokeWidth={2.5} />
                      </span>
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// CTA + Footer
// ────────────────────────────────────────────────────────────
function CTA() {
  return (
    <div style={{ padding: '120px 64px', background: E.bg, position: 'relative' }}>
      <Reveal>
        <div style={{
          maxWidth: 1100, margin: '0 auto', padding: '64px 56px',
          background: E.surface, color: E.text, borderRadius: 28,
          border: `1px solid ${E.line}`,
          position: 'relative', overflow: 'hidden',
          boxShadow: `0 32px 80px rgba(13, 17, 16, 0.08)`,
        }}>
          {/* organic background bloom */}
          <div style={{
            position: 'absolute', top: -180, right: -180, width: 520, height: 520,
            borderRadius: '50%', background: `radial-gradient(circle, ${E.primarySoft}, transparent 65%)`,
            pointerEvents: 'none',
          }} />
          <div style={{
            position: 'absolute', bottom: -160, left: -120, width: 440, height: 440,
            borderRadius: '50%', background: `radial-gradient(circle, ${E.goldSoft}, transparent 65%)`,
            pointerEvents: 'none',
          }} />
          {/* concentric guides — premium tree-ring motif */}
          <svg width="700" height="700" viewBox="0 0 700 700"
            style={{ position: 'absolute', right: -180, top: -120, opacity: 0.18, pointerEvents: 'none' }}>
            <g stroke={E.primary} strokeWidth="1" fill="none">
              <circle cx="350" cy="350" r="140" />
              <circle cx="350" cy="350" r="200" />
              <circle cx="350" cy="350" r="270" strokeDasharray="2 6" />
              <circle cx="350" cy="350" r="330" strokeDasharray="2 8" />
            </g>
          </svg>

          <div style={{
            position: 'relative', display: 'grid', gridTemplateColumns: '1.3fr 1fr',
            gap: 56, alignItems: 'center',
          }}>
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '6px 14px', borderRadius: 999,
                background: E.primarySoft, color: E.primary,
                fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
                marginBottom: 28,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: E.primary,
                  boxShadow: `0 0 0 4px ${E.primarySoft}`,
                }} />
                BETA OPEN · 신규 등록 진행중
              </div>
              <h2 style={{
                fontSize: 48, fontWeight: 800, color: E.text, margin: 0,
                letterSpacing: -1.6, lineHeight: 1.1,
              }}>
                오늘 신청하면<br />
                <span style={{
                  backgroundImage: `linear-gradient(transparent 62%, ${E.goldSoft} 62%, ${E.goldSoft} 92%, transparent 92%)`,
                  boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone',
                  padding: '0 4px', color: E.primary,
                }}>다음 주에 적용</span>됩니다.
              </h2>
              <p style={{
                fontSize: 16, color: E.textDim, marginTop: 22,
                lineHeight: 1.75, maxWidth: 480,
              }}>
                상담 30분 · 데이터 마이그레이션 3일 · 직원 교육 2일.<br />
                다음 주 월요일에는 EYWA가 켜져 있습니다.
              </p>

              {/* trust strip */}
              <div style={{
                marginTop: 32, paddingTop: 24, borderTop: `1px solid ${E.line}`,
                display: 'flex', gap: 28, flexWrap: 'wrap',
              }}>
                {[
                  ['신용카드 없이', '무료 시작'],
                  ['평일 1시간 안', '응답 보장'],
                  ['데이터', '무료 마이그레이션'],
                ].map((t, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: '50%',
                      background: E.primarySoft, color: E.primary,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      <EyIcon name="check" size={11} strokeWidth={3} />
                    </span>
                    <div>
                      <div style={{ fontSize: 12, color: E.textDim }}>{t[0]}</div>
                      <div style={{ fontSize: 13, color: E.text, fontWeight: 700 }}>{t[1]}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Primary action — forest green */}
              <a style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '20px 24px', borderRadius: 16,
                background: `linear-gradient(135deg, ${E.primary} 0%, #2a7a52 100%)`, color: '#fff',
                fontSize: 15, fontWeight: 700, cursor: 'pointer',
                boxShadow: `0 14px 32px rgba(26, 95, 60, 0.28)`,
                textDecoration: 'none', transition: 'transform .15s ease',
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: 'rgba(255,255,255,0.7)', marginBottom: 3 }}>3분이면 끝</div>
                  <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: -0.3 }}>베타 신청하기</div>
                </div>
                <span style={{
                  width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.18)', color: '#fff',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  backdropFilter: 'blur(4px)',
                }}>
                  <EyIcon name="arrowRight" size={18} strokeWidth={2.4} />
                </span>
              </a>

              {/* Secondary action — outline cream */}
              <a style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '18px 24px', borderRadius: 16,
                background: E.bgSoft, color: E.text,
                border: `1px solid ${E.line}`,
                fontSize: 15, fontWeight: 600, cursor: 'pointer',
                textDecoration: 'none',
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: E.textDim, marginBottom: 3 }}>편하게 물어보세요</div>
                  <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: -0.3 }}>원장님과 30분 상담</div>
                </div>
                <span style={{
                  width: 36, height: 36, borderRadius: 10,
                  background: E.surface, color: E.primary,
                  border: `1px solid ${E.line}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </span>
              </a>

              {/* phone hint */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                marginTop: 4, fontSize: 12, color: E.textDim,
              }}>
                <span style={{ fontFamily: E.fontMono, letterSpacing: 0.5, color: E.text, fontWeight: 600 }}>1670-0000</span>
                <span style={{ color: E.line }}>·</span>
                <span>평일 10:00 – 18:00</span>
              </div>
            </div>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

function Footer() {
  return (
    <div style={{
      padding: '32px 64px', borderTop: `1px solid ${E.line}`, background: E.bg,
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      fontSize: 12, color: E.textDim,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 18, height: 18, borderRadius: 4, background: E.ink,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="10" height="10" viewBox="0 0 16 16">
            <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
            <circle cx="8" cy="8" r="2" fill="#fff" />
          </svg>
        </div>
        <span>© 2026 EYWA · 인재원 학원관리</span>
      </div>
      <div style={{ display: 'flex', gap: 24 }}>
        <a>이용약관</a><a>개인정보처리방침</a><a>사업자 정보</a><a>고객지원</a>
      </div>
    </div>
  );
}

function LandingNetwork() {
  return (
    <div style={{
      background: E.bg, color: E.text, fontFamily: E.font,
      width: '100%', overflow: 'hidden',
    }}>
      <style>{REVEAL_STYLE}</style>
      <Nav />
      <Hero />
      <Flow />
      <LogoWall />
      <Manifesto />
      <Testimonials />
      <Pricing />
      <CTA />
      <Footer />
    </div>
  );
}

window.LandingNetwork = LandingNetwork;
