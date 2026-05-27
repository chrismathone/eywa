// screens-shell.jsx — shared chrome + atoms for all 12 EYWA tabs.
// Light "Daylight" editorial palette consistent with the landing.

const S = {
  bg: '#fbf9f3',                          // page background (warm ivory)
  bgSoft: '#f1ede2',                      // softer cream
  surface: '#ffffff',
  surfaceHi: '#fafaf5',
  text: '#1a1f1c',
  textDim: '#5a635f',
  textFaint: '#9aa39d',
  ink: '#0d1110',
  line: 'rgba(13, 17, 16, 0.08)',
  lineStrong: 'rgba(13, 17, 16, 0.16)',
  primary: '#1a5f3c',                     // deep forest
  primaryHover: '#185533',
  primarySoft: 'rgba(26, 95, 60, 0.10)',
  primarySofter: 'rgba(26, 95, 60, 0.05)',
  gold: '#b8893a',
  goldSoft: 'rgba(184, 137, 58, 0.14)',
  blue: '#1f6ba8',
  blueSoft: 'rgba(31, 107, 168, 0.12)',
  purple: '#7a4ba8',
  purpleSoft: 'rgba(122, 75, 168, 0.12)',
  rose: '#c44d6d',
  roseSoft: 'rgba(196, 77, 109, 0.12)',
  amber: '#d68f1a',
  amberSoft: 'rgba(214, 143, 26, 0.14)',
  danger: '#d04848',
  dangerSoft: 'rgba(208, 72, 72, 0.10)',
  font: '"Pretendard Variable", Pretendard, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, monospace',
};

// ──────────────────────────────────────────────────────────────────────
// Sidebar — same 12 menus, active state driven by prop
// ──────────────────────────────────────────────────────────────────────
function Sidebar({ active }) {
  return (
    <aside style={{
      width: 232, height: '100%', background: S.bgSoft,
      borderRight: `1px solid ${S.line}`,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* brand */}
      <div style={{ padding: '22px 22px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7, background: S.ink,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="16" height="16" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="5" fill="none" stroke="#fff" strokeWidth="1.2" />
              <circle cx="8" cy="8" r="2" fill="#fff" />
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: S.font, fontSize: 17, fontWeight: 800, color: S.text, letterSpacing: -0.4 }}>EYWA</div>
            <div style={{ fontSize: 10, color: S.textDim, fontFamily: S.fontMono, letterSpacing: 0.8, marginTop: 1 }}>인재원 · 강남</div>
          </div>
        </div>
      </div>

      {/* nav */}
      <nav style={{ flex: 1, padding: '4px 10px', overflowY: 'auto' }}>
        {['home', 'class', 'student', 'ops', 'help'].map((g, gi) => (
          <div key={g} style={{ marginBottom: 12 }}>
            <div style={{
              padding: '6px 12px 4px',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              fontSize: 10, color: S.textFaint, fontFamily: S.fontMono,
              letterSpacing: 1.2, textTransform: 'uppercase',
            }}>
              <span>{EYWA_GROUPS[g]}</span>
              <span>0{gi + 1}</span>
            </div>
            {EYWA_MENUS.filter((m) => m.group === g).map((m) => {
              const isActive = m.id === active;
              return (
                <div key={m.id} style={{
                  padding: '8px 12px', borderRadius: 10,
                  display: 'flex', alignItems: 'center', gap: 10,
                  background: isActive ? S.primary : 'transparent',
                  color: isActive ? '#fff' : S.text,
                  fontSize: 13, fontWeight: isActive ? 600 : 500,
                  cursor: 'pointer',
                  boxShadow: isActive ? `0 6px 16px rgba(26, 95, 60, 0.22)` : 'none',
                }}>
                  <span style={{
                    width: 26, height: 26, borderRadius: 6,
                    background: isActive ? 'rgba(255,255,255,0.16)' : 'transparent',
                    color: isActive ? '#fff' : S.textDim,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <EyIcon name={m.icon} size={14} />
                  </span>
                  {m.label}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* user footer */}
      <div style={{
        padding: '14px 16px', borderTop: `1px solid ${S.line}`,
        display: 'flex', alignItems: 'center', gap: 10, background: S.bgSoft,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 10, background: S.primary,
          color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 700, fontSize: 13, letterSpacing: -0.3,
        }}>김</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: S.text, fontWeight: 700 }}>김수진</div>
          <div style={{ fontSize: 11, color: S.textDim }}>원장 · master</div>
        </div>
      </div>
    </aside>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Topbar — title + breadcrumb + search + actions
// ──────────────────────────────────────────────────────────────────────
function Topbar({ title, breadcrumb, actions }) {
  return (
    <div style={{
      height: 64, padding: '0 28px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      borderBottom: `1px solid ${S.line}`, background: S.bg,
    }}>
      <div>
        {breadcrumb && (
          <div style={{
            fontSize: 11, color: S.textDim, fontFamily: S.fontMono,
            letterSpacing: 1, textTransform: 'uppercase', marginBottom: 3,
          }}>{breadcrumb}</div>
        )}
        <div style={{ fontSize: 19, color: S.text, fontWeight: 800, letterSpacing: -0.4 }}>{title}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 14px', borderRadius: 999,
          background: S.surface, border: `1px solid ${S.line}`,
          minWidth: 280, color: S.textDim,
        }}>
          <EyIcon name="search" size={13} />
          <span style={{ flex: 1, fontSize: 12 }}>검색</span>
          <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, background: S.bgSoft, color: S.textFaint, fontFamily: S.fontMono }}>⌘K</span>
        </div>
        <button style={{
          width: 36, height: 36, borderRadius: 10,
          background: S.surface, color: S.text, border: `1px solid ${S.line}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          position: 'relative',
        }}>
          <EyIcon name="bell" size={15} />
          <span style={{ position: 'absolute', top: 7, right: 7, width: 7, height: 7, borderRadius: '50%', background: S.rose, border: `2px solid ${S.surface}` }} />
        </button>
        {actions}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// AppShell — wraps a screen with sidebar + topbar
// ──────────────────────────────────────────────────────────────────────
function AppShell({ active, title, breadcrumb, actions, children }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex',
      background: S.bg, color: S.text, fontFamily: S.font, overflow: 'hidden',
    }}>
      <Sidebar active={active} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <Topbar title={title} breadcrumb={breadcrumb} actions={actions} />
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 28px' }}>
          {children}
        </div>
      </main>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Shared atoms
// ──────────────────────────────────────────────────────────────────────

function Pill({ color = S.primary, children, soft = true, style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 999,
      background: soft ? `${color}1f` : color,
      color: soft ? color : '#fff',
      fontSize: 11, fontWeight: 700, letterSpacing: 0.3,
      ...style,
    }}>{children}</span>
  );
}

function PrimaryButton({ children, color = S.primary, icon, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 16px', borderRadius: 10,
      background: color, color: '#fff', border: 'none',
      fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      boxShadow: `0 6px 14px ${color}33`,
      ...style,
    }}>{icon && <EyIcon name={icon} size={13} />}{children}</button>
  );
}

function GhostButton({ children, icon, onClick, style }) {
  return (
    <button onClick={onClick} style={{
      padding: '9px 14px', borderRadius: 10,
      background: S.surface, color: S.text,
      border: `1px solid ${S.lineStrong}`,
      fontSize: 13, fontWeight: 500, fontFamily: 'inherit', cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
      ...style,
    }}>{icon && <EyIcon name={icon} size={13} />}{children}</button>
  );
}

function Card({ children, padding = 20, style }) {
  return (
    <div style={{
      background: S.surface, borderRadius: 16,
      border: `1px solid ${S.line}`, padding,
      boxShadow: '0 1px 3px rgba(13,17,16,0.02)',
      ...style,
    }}>{children}</div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      marginBottom: 14,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: S.text, letterSpacing: -0.2 }}>{children}</div>
      {action}
    </div>
  );
}

// Small avatar — just colored circle with initial (per user request: 동그란 프사 거의 안 씀)
function Initial({ name, color = S.primary, size = 28 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: 8,
      background: `${color}1a`, color,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 700, fontSize: size <= 28 ? 12 : 14, letterSpacing: -0.3, flexShrink: 0,
    }}>{name.slice(0, 1)}</div>
  );
}

Object.assign(window, {
  S, Sidebar, Topbar, AppShell,
  Pill, PrimaryButton, GhostButton, Card, SectionTitle, Initial,
});
