/** 실제 운영실의 메뉴·지표·배치와 무관한 랜딩 전용 가상 화면. */
const FLOW = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"];

export function DashboardMock() {
  return (
    <div className="concept-board" aria-hidden="true">
      <div className="concept-head">
        <div className="concept-brand"><span className="concept-mark"><i /><i /><i /></span><b>aywa</b><span className="concept-head-note">운영 흐름</span></div>
        <div className="concept-head-state"><i />하루의 흐름이 이어지고 있습니다</div>
      </div>

      <div className="concept-body">
        <div className="concept-field">
          <div className="concept-field-copy">
            <span>한눈에 이어지는 하루</span>
            <strong>흩어진 장면이<br />하나의 흐름으로.</strong>
          </div>
          <svg className="concept-map" viewBox="0 0 640 365" fill="none" aria-hidden="true">
            <defs>
              <linearGradient id="concept-line" x1="55" y1="295" x2="565" y2="60" gradientUnits="userSpaceOnUse">
                <stop stopColor="#6DD7CC" /><stop offset=".54" stopColor="#A6AFE8" /><stop offset="1" stopColor="#E7AF84" />
              </linearGradient>
              <radialGradient id="concept-glow"><stop stopColor="#70DDD1" stopOpacity=".24" /><stop offset="1" stopColor="#70DDD1" stopOpacity="0" /></radialGradient>
            </defs>
            <ellipse cx="326" cy="202" rx="210" ry="127" stroke="#425273" strokeOpacity=".5" strokeDasharray="3 8" />
            <ellipse cx="326" cy="202" rx="140" ry="84" stroke="#536588" strokeOpacity=".48" />
            <ellipse cx="326" cy="202" rx="78" ry="48" stroke="#6F83A7" strokeOpacity=".45" />
            <path d="M35 271C99 267 113 193 174 211S238 309 302 259 347 105 414 116 494 228 606 67" stroke="url(#concept-line)" strokeWidth="3" strokeLinecap="round" />
            <path d="M102 62C151 122 216 98 268 150S328 286 394 269 508 179 585 214" stroke="#7895B4" strokeOpacity=".42" strokeWidth="1.5" />
            <circle cx="326" cy="202" r="100" fill="url(#concept-glow)" />
            <circle cx="326" cy="202" r="25" fill="#182D47" stroke="#76DBCF" strokeWidth="2" />
            <circle cx="326" cy="202" r="8" fill="#76DBCF" />
            <circle cx="174" cy="211" r="7" fill="#74D9CD" stroke="#122139" strokeWidth="4" />
            <circle cx="414" cy="116" r="7" fill="#B4AFE6" stroke="#122139" strokeWidth="4" />
            <circle cx="528" cy="140" r="7" fill="#EAB48B" stroke="#122139" strokeWidth="4" />
            <circle cx="268" cy="150" r="5" fill="#9AADE0" />
            <circle cx="394" cy="269" r="5" fill="#9AADE0" />
          </svg>
          <div className="concept-field-foot"><span>연결된 기록의 움직임</span><span>● <i>●</i> ●</span></div>
        </div>

        <div className="concept-aside">
          <div className="concept-wave-card">
            <span className="concept-card-label">변화의 리듬</span>
            <svg viewBox="0 0 245 92" preserveAspectRatio="none" aria-hidden="true">
              <path d="M0 75H245M0 48H245M0 21H245" stroke="#61718C" strokeOpacity=".27" strokeDasharray="2 5" />
              <path d="M0 69C22 65 31 71 48 57S77 42 94 48 121 72 141 56 162 32 181 38 211 60 245 14" fill="none" stroke="#79DACE" strokeWidth="3" strokeLinecap="round" />
              <circle cx="245" cy="14" r="5" fill="#79DACE" />
            </svg>
            <strong>새로운 흐름을 발견하다</strong>
          </div>
          <div className="concept-links-card">
            <span className="concept-card-label">이어지는 장면</span>
            <div className="concept-link-row"><i className="mint" /><span /><b /></div>
            <div className="concept-link-row"><i className="lilac" /><span /><b /></div>
            <div className="concept-link-row"><i className="peach" /><span /><b /></div>
            <div className="concept-link-row"><i className="blue" /><span /><b /></div>
          </div>
        </div>
      </div>

      <div className="concept-bottom">
        <div><b>하루의 결</b><span>시간에 따라 달라지는 움직임</span></div>
        <div className="concept-flow">{FLOW.map((item) => <i key={item} className={`tone-${item}`} />)}</div>
        <span className="concept-example">화면 연출 예시</span>
      </div>
    </div>
  );
}
