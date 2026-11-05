// 편집기(app.tsx)와 같은 CSS를 같은 순서로 — 줄바꿈 금지(`white-space`)·좁은 폭 규칙이 뒤 파일들에 있다.
import "@/features/timetable-lab/editor/workspace.css";
import "@/features/timetable-lab/editor/timetable-views.css";
import "@/features/timetable-lab/editor/class-tools.css";
import "@/features/timetable-lab/editor/draft-library.css";
import "@/features/timetable-lab/editor/editor-tools.css";

/**
 * 시간표 편집기가 뜨기 전의 자리 표시 — 서버 loading.tsx와 클라 지연 로드(next/dynamic)가 함께 쓴다.
 * 🔴 줄 높이를 손으로 적지 않는다: 편집기 CSS(workspace.css)를 그대로 불러 **같은 클래스·같은 요소**(머리 줄 `.lab-topbar` ·
 *    조작 줄 `.lab-controls` · 빈 상태 `.lab-empty` · 상태 줄 `.lab-status`)를 그린다. 옛 손 치수(52/49/30px)는 실물(약 42/42/24px)과
 *    어긋나 도착 때 격자가 위로 튀었다. 줄 높이는 버튼 글자·여백이 정하므로 버튼도 실물 요소를 투명 글자로 둔다.
 * ⚠️ 그 CSS는 `@scope` 안에서 `all: revert`(레이어 밖)라 Tailwind 유틸이 진다 — 막대 색·맥박은 `!`(important)로만 얹는다.
 * 실물 첫 화면 = 연습본이 비어 있는 상태(빈 상태 안내 + 강사뷰 조작 줄)라 그 모양을 따른다.
 */
const BAR = "bg-bg-soft! text-transparent! border-transparent! animate-pulse!";
/** 글자만 지우는 안쪽 요소(바깥 막대가 이미 색을 입었다). */
const INK = "text-transparent!";

export function EditorSkeleton() {
  return (
    <div className="timetable-workspace" role="status" aria-busy="true" aria-label="시간표 편집기 불러오는 중">
      <header className="lab-topbar" inert>
        <h1 className={BAR}>
          시간표 편집기 <span className={INK}>영어 · 연습본</span>
        </h1>
        <span className="source-name" />
        <button type="button" className={BAR}>연습본 저장·불러오기·비교</button>
        <button type="button" className={BAR}>기존 시간표 불러오기</button>
        <button type="button" className={`primary ${BAR}`}>연습본 적용</button>
        <button type="button" className={BAR}>적용 내역</button>
      </header>
      <div className="lab-controls" inert>
        <div className="view-switch">
          <button type="button" className={BAR}>강사뷰</button>
          <button type="button" className={BAR}>통합뷰</button>
        </div>
        <button type="button" className={`add-button ${BAR}`}>＋ 추가</button>
        <button type="button" className={BAR}>관리</button>
        <button type="button" className={`view-option ${BAR}`}>빈 요일 접기</button>
        <button type="button" className={`view-option ${BAR}`}>토요일 숨기기</button>
        <button type="button" className={`view-option ${BAR}`}>일요일 보이기</button>
        <input className={`schedule-search ${BAR}`} aria-label="검색 자리" readOnly />
        <div className="history-buttons">
          <button type="button" className={BAR}>↶</button>
          <button type="button" className={BAR}>↷</button>
          <button type="button" className={`history-list ${BAR}`}>기록</button>
        </div>
        <label className="zoom-label">
          <span className={BAR}>크기</span>
          <select className={BAR} aria-label="크기 자리" defaultValue="1">
            <option value="1">기본</option>
          </select>
        </label>
        <button type="button" className={BAR}>요약</button>
        <button type="button" className={`check-toggle ${BAR}`}>배치 확인</button>
      </div>
      <div className="lab-workarea" inert>
        <section className="lab-empty">
          <div className="empty-schedule animate-pulse!" aria-hidden="true"><i /><i /><i /></div>
          <h2 className={BAR}>지금 쓰는 시간표를 펼쳐 보세요</h2>
          <p className={BAR}>
            수업을 옮겨 보고, 겹치는 이유를 확인하며
            <br />
            다음 시간표를 연습할 수 있습니다.
          </p>
          <button type="button" className={`primary ${BAR}`}>기존 시간표 불러오기</button>
          <button type="button" className={`sample-button ${BAR}`}>예제로 먼저 연습</button>
          <button type="button" className={`sample-button ${BAR}`}>빈 시간표에서 직접 만들기</button>
        </section>
      </div>
      <footer className="lab-status" inert>
        <span className={BAR}>수업을 잡아 옮겨 보세요. 충돌이 있어도 배치할 수 있습니다.</span>
        <span className={BAR}>빈 칸을 끌어 새 수업 · Shift+끌기 여러 개 고르기 · 끝을 끌어 길이 · Alt+끌기 복제 · 우클릭 메뉴 · Ctrl+C / X / V · Ctrl+Z</span>
        <b className={BAR}>이름을 붙여 연습본을 저장하세요</b>
      </footer>
    </div>
  );
}
