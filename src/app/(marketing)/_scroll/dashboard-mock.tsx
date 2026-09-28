import { sv } from "./style";

/**
 * 첫 화면 속 **대시보드 예시** — 지금 운영실(`/dashboard` '학원 전체 현황', 2026-09-12 확정 디자인)을 그대로 줄여 그린다.
 * 머리 줄(자동 갱신) · 지표 8칸(금일 등록·보강예정 포함, 전일 결석만 붉은 카드) · '학원 운영 한눈에' 패널 · 추이 두 칸.
 * 🔴 운영실이 바뀌면 이 목업도 따라 고칠 것 — 원장이 옛 운영실(오늘 브리핑 카드) 목업을 보고 *"최신 코드가 아니네"*(2026-09-22).
 * 사이드바는 지금 메뉴 묶음(홈·수업·원생·운영·지원)에서 일부만 보인다. 이름·숫자는 모두 예시다.
 */
const SIDE: { group: string; items: [icon: string, label: string][] }[] = [
  { group: "홈", items: [["layoutGrid", "대시보드"]] },
  { group: "수업", items: [["weekGrid", "시간표"], ["sheetColumns", "강사 시트"], ["clipboardCheck", "출석부"], ["book", "수업목록"]] },
  { group: "원생", items: [["users", "원생목록"], ["userCheck", "원생상담"], ["messages", "콜&상담"], ["userMinus", "퇴원관리"]] },
  { group: "운영", items: [["userSettings", "직원관리"], ["wallet", "수납관리"], ["note", "회의록"]] },
  { group: "지원", items: [["help", "도움말"]] },
];
const KPIS: [icon: string, label: string, value: string, unit: string, sub: string, warn?: boolean][] = [
  ["users", "재원생", "212", "명", "영어 118 · 수학 131"],
  ["userMinus", "퇴원생", "3", "명", "9/1 ~ 오늘"],
  ["messages", "신규문의", "2", "건", "오늘 접수"],
  ["exam", "금일입테", "1", "건", "16:20"],
  ["userCheck", "금일 등록", "2", "명", "반 배정 1 · 배정 전 1"],
  ["userPlus", "오늘첫수업", "2", "명", "수학 1 · 영어 1"],
  ["userX", "전일 결석", "3", "명", "어제 9/21 · 사전 통보 2", true],
  ["undo", "보강예정", "6", "건", "10/21까지 · 오늘 0"],
];
/** 급별 재원생 — 영어·동시수강·수학 비율(--a·--b)과 막대 길이(--w, 가장 많은 급 = 1). */
const LEVELS: [label: string, count: number, a: string, b: string, w: string][] = [
  ["초등", 64, ".38", ".22", ".65"], ["중등", 98, ".30", ".34", "1"], ["고등", 50, ".24", ".26", ".51"],
];
const NEWCOMERS: [label: string, count: number, w: string][] = [
  ["7일 이내", 3, ".6"], ["30일 이내", 5, "1"], ["60일 이내", 4, ".8"], ["90일 이내", 2, ".4"],
];
const MONTHS = ["26.04", "26.05", "26.06", "26.07", "26.08", "26.09"];
const TREND: [inn: string, out: string][] = [[".55", ".2"], [".4", ".25"], [".45", ".15"], [".7", ".3"], [".95", ".2"], [".6", ".1"]];
const BILLED = [".78", ".8", ".82", ".86", ".92", ".95"];

export function DashboardMock() {
  return (
    <div className="app">
      <aside className="side" aria-hidden="true">
        <div className="brand">에이와</div>
        {SIDE.map((g) => (
          <div key={g.group} className="grp">
            <p>{g.group}</p>
            {g.items.map(([icon, label]) => (
              <div key={label} className={label === "대시보드" ? "mi on" : "mi"}><i className={`stk i-${icon}`}></i>{label}</div>
            ))}
          </div>
        ))}
      </aside>
      <div className="main">
        <div className="dh">
          <b>학원 전체 현황</b><span className="num">2026.09.22</span>
          <span className="tools"><em>강의실 2D/3D</em><em className="live"><i></i>자동 갱신 · 16:20 확인</em></span>
        </div>
        <div className="kpis">
          {KPIS.map(([icon, label, value, unit, sub, warn]) => (
            <div key={label} className={warn ? "kpi warn" : "kpi"}>
              <small><i className={`stk i-${icon}`}></i>{label}</small>
              <b className="num">{value}<span>{unit}</span></b>
              <em>{sub}</em>
            </div>
          ))}
        </div>
        <div className="secline"><b>학원 운영 한눈에</b><span>재원 · 출결 · 수납 · 신규생</span></div>
        <div className="pans">
          <div className="pan">
            <h4>재원생 구성<span>초·중·고 · 영어·동시수강·수학</span></h4>
            {LEVELS.map(([label, count, a, b, w]) => (
              <div key={label} className="lv"><span>{label}</span><i style={sv({ "--a": a, "--b": b, "--w": w })}></i><b className="num">{count}</b></div>
            ))}
            <div className="lg"><span><i style={sv({ background: "#e8899a" })}></i>영어</span><span><i style={sv({ background: "#a894e0" })}></i>동시</span><span><i style={sv({ background: "#7ea6d8" })}></i>수학</span></div>
          </div>
          <div className="pan">
            <h4>출결 현황<span>오늘 · 학생·반·교시별 출결 칸</span></h4>
            <div className="donut"><i style={sv({ "--p": "78" })}></i><div><b className="num">78%</b><small>출석 43 · 지각 3 · 결석 2 · 미입력 7</small></div></div>
          </div>
          <div className="pan">
            <h4>9월 수납 현황<span>당월 청구서 · 취소 청구 제외</span></h4>
            <div className="rate"><b className="num">70%</b><small>수납률</small></div>
            <div className="stackbar"><i style={sv({ width: "70%", background: "#7ea6d8" })}></i><i style={sv({ width: "5%", background: "#f0c46c" })}></i><i style={sv({ width: "25%", background: "#e8899a" })}></i></div>
            <div className="lg"><span>완납 128</span><span>부분납 9</span><span>미납 47</span></div>
          </div>
          <div className="pan">
            <h4>신규생 단계별 관리<span>등록 후 90일 · 재원·휴원 학생</span></h4>
            {NEWCOMERS.map(([label, count, w]) => (
              <div key={label} className="nw"><span>{label}</span><i style={sv({ "--w": w })}></i><b className="num">{count}</b></div>
            ))}
          </div>
          <div className="pan wide">
            <h4>등록 · 퇴원 추이<span>최근 6개월 · 당월은 오늘까지</span></h4>
            <div className="cols6">{TREND.map(([inn, out], i) => <div key={MONTHS[i]}><i style={sv({ "--h": inn })}></i><i className="o" style={sv({ "--h": out })}></i></div>)}</div>
            <div className="axis6">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
          </div>
          <div className="pan wide">
            <h4>6개월 청구 · 수납<span>최근 6개월 · 청구월 기준 실청구액(청구 − 할인)</span></h4>
            <div className="cols6 one">{BILLED.map((h, i) => <div key={MONTHS[i]}><i style={sv({ "--h": h })}></i></div>)}</div>
            <div className="axis6">{MONTHS.map((m) => <span key={m}>{m}</span>)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
