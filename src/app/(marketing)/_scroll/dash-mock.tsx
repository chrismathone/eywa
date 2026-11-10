/**
 * 에이와 대시보드 예시 — 최신 운영실 모양(2026-11-09 새 대시보드 · 차콜 테마, `dashboard/_instruments/instruments.css`·`new-shape.*`)을
 * 축소해 HTML/CSS로 그린다(원장 2026-11-10 *"최신 대시보드 스타일로"* — 옛 네이비 SVG 대체). 차트도 CSS(인라인 SVG 금지 가드).
 * 크기는 담는 틀 폭(`cqw`)을 따른다 — 히어로 액자와 쇼룸 슬라이드에 같은 모형. 숫자·학원은 모두 가상, 읽기 도구에는 숨긴다(액자 alt가 설명).
 */
/* 히어로 액자(폭 ~580px)에서도 읽히게 칸 설명 줄은 뺐다(Codex 협의 — 항목을 줄여 글자를 키운다). */
const KPIS: [string, string, string][] = [
  ["재원생", "168", "명"],
  ["강좌수", "232", "개"],
  ["신규 문의", "4", "건"],
  ["전일 입테", "2", "건"],
  ["최근 결석", "5", "명"],
  ["보강 예정", "6", "건"],
];
const MONTHS = ["6월", "7월", "8월", "9월", "10월", "11월"];

/** `compact` = 히어로 액자용 간단판(업무 비서 · 큰 숫자 셋 · 추이 카드 하나) — 작은 액자에서 글씨가 몰리지 않게(Codex 4차). */
export function DashMock({ compact = false }: { compact?: boolean }) {
  if (compact) return <DashMockCompact />;
  return (
    <div className="dmk" aria-hidden="true">
      <div className="dmk-head">
        <div><small>운영실 · 예시 학원</small><b>학원 전체 현황</b></div>
        <span className="dmk-fresh"><i />방금 갱신</span>
      </div>
      <div className="dmk-switch"><span className="on">한눈에 보기</span><span>오늘 운영</span><span>경영 현황</span></div>
      <div className="dmk-sum">
        <div className="dmk-brief">
          <small>업무 비서</small><b>오늘 확인할 일 3건</b>
          <ul><li>미발송 보고서 2건</li><li>오늘 상담 16:20</li><li>결석 확인 1건</li></ul>
        </div>
        <div className="dmk-kpis">
          {KPIS.map(([label, value, unit]) => <div key={label}><small>{label}</small><b>{value}<em>{unit}</em></b></div>)}
        </div>
      </div>
      <div className="dmk-block"><b>학원 운영 한눈에</b><span>재원 · 출결 · 수납</span></div>
      <div className="dmk-cards">
        <div className="dmk-card"><small>오늘 출결</small><div className="dmk-gauge"><span>75%</span></div><p>출석 54 · 지각 4</p></div>
        <div className="dmk-card"><small>이달 수납</small><b className="dmk-big">84%</b><div className="dmk-bar"><i /></div><p>청구서 기준</p></div>
        <div className="dmk-card wide">
          <small>재원생 추이</small>
          <div className="dmk-area"><i /><s /></div>
          <div className="dmk-axis">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

function DashMockCompact() {
  return (
    <div className="dmk compact" aria-hidden="true">
      <div className="dmk-head">
        <div><small>운영실 · 예시 학원</small><b>학원 전체 현황</b></div>
        <span className="dmk-fresh"><i />방금 갱신</span>
      </div>
      <div className="dmk-sum">
        <div className="dmk-brief"><small>업무 비서</small><b>확인할 일 2건</b><ul><li>미발송 보고서 2건</li><li>오늘 상담 16:20</li></ul></div>
        <div className="dmk-kpis">
          {KPIS.slice(0, 3).map(([label, value, unit]) => <div key={label}><small>{label}</small><b>{value}<em>{unit}</em></b></div>)}
        </div>
      </div>
      <div className="dmk-card">
        <small>재원생 추이</small>
        <div className="dmk-area"><i /><s /></div>
        <div className="dmk-axis">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
      </div>
    </div>
  );
}
