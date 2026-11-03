import s from "./_overview/overview.module.css";
import { EXIT_BASIS_TAG } from "@/features/withdrawals/exit-basis";

// 운영실(학원 전체 현황) 초기 로드 스트리밍 — 여러 영역 병렬 조회가 도는 동안 Next가 이 loading을
// Suspense fallback으로 즉시 흘린다(첫 페인트 체감, B7).
//
// ⚠️ **실제 화면의 뼈대를 그대로 따른다** — 스켈레톤이 더 크거나 작으면 로드가 끝나는 순간 화면이 튄다.
// 🔑 격자·줄 높이를 손으로 다시 짓지 않는다: 실제 CSS 모듈 클래스(.header·.identity·.kpis·.kpiBody·.grid·.panel…)에
//    **같은 길이의 글자를 투명하게** 넣어 줄 높이를 그대로 얻는다(창 폭에 따른 열 수도 컨테이너 쿼리 한 벌로 같아진다).
// 구조: 머리 → KPI 아홉 칸 → '학원 운영 한눈에'(패널 넷 + 넓은 패널 둘 + 한 줄 추이 둘) → '학생 · 학습 · 상담'(일곱,
// 셋째는 두 줄 + 학습·보고와 학생 상담 한 쌍) → '수업과 학원 운영'(여덟) → 꼬리. 패널 속 높이는 흔한 내용 높이의 근삿값이다.
import type { CSSProperties } from "react";

const T = "text-transparent bg-bg-soft animate-pulse rounded";

const KPI = [
  ["재원생", "000", "명", "EiE 000 · 인재원 영어 000 · 수학 000"],
  // 강좌수(원장 2026-10-20 — 재원생 오른쪽) — 실제 띠와 칸 수·순서가 같아야 로드 끝에 화면이 안 튄다.
  ["강좌수", "000", "개", "EiE 00 · 인재원 영어 000 · 수학 000"],
  ["퇴원", "0", "명", "EiE 0 · 인재원 영어 0 · 수학 0"],
  ["신규문의", "0", "건", "마지막 접수 00:00"],
  ["전일 입테", "0", "건", "00/00 · 첫 일정 00:00"],
  // 전일 / 이달 신규(원장 2026-09-23 '금일 등록' — 입테 오른쪽 → 2026-10-21 어제·이번 달 두 숫자).
  ["전일 / 이달 신규", "0 / 0", "명", "전일 0 · 이달 0"],
  ["오늘첫수업", "0", "명", "첫 등원 0 · 처음 듣는 과목 0"],
  // 최근 결석(원장 2026-10-20 — 옛 '전일 결석'을 어제까지 7일로) — 보조 줄 = 기간 + 결석 횟수 + 연락 필요. 날짜는 보통 폭.
  ["최근 결석", "0", "명", "10/13~10/19 · 결석 0회 · 연락 필요 0명"],
  // 보강예정(원장 2026-09-14 "가장 끝으로") — 실제 마지막 칸과 순서·수가 같아야 로드 끝에 화면이 안 튄다.
  // 보조 줄은 창 끝 날짜로 시작한다(원장 2026-09-16 "오늘 기준으로 1달 이내" — `windowUntilLabel`) · 날짜는 보통 폭.
  ["보강예정", "0", "건", "10/15 (목)까지 · 오늘 0"],
] as const;

type PanelShape = { title: string; note: string; body: number; wide?: boolean; className?: string };

const SECTIONS: { title: string; note: string; panels: PanelShape[]; followups?: PanelShape[] }[] = [
  {
    title: "학원 운영 한눈에",
    note: "재원 · 출결 · 수납 · 신규생",
    panels: [
      { title: "재원생 구성", note: "현재 · 초·중·고 · 영어·동시수강·수학", body: 150 },
      { title: "출결 현황", note: "오늘 · 학생·반·교시별 출결 칸", body: 205 },
      { title: "9월 수납 현황", note: "이번 달 청구서 · 취소 청구 제외", body: 195 },
      { title: "신규생 단계별 관리", note: "등록 후 90일 · 재원·대기 학생", body: 180 },
      { title: "등록 · 퇴원 추이", note: `최근 6개월 · 당월은 오늘까지 · 퇴원은 ${EXIT_BASIS_TAG}`, body: 245, wide: true },
      { title: "6개월 청구 · 수납", note: "최근 6개월 · 청구월 기준 실청구액(청구 − 할인)", body: 245, wide: true },
      // 한 줄 전체 추이 둘(실제 화면의 재원생 추이 · 강좌수 추이 — `s.fullRow`).
      { title: "재원생 추이", note: `최근 12개월 · 달마다 말일 기준(이번 달은 오늘) · 휴원 제외 · 퇴원은 ${EXIT_BASIS_TAG}`, body: 245, className: s.fullRow },
      { title: "강좌수 추이", note: "최근 12개월 · 달마다 말일 기준(이번 달은 오늘) · 학생마다 같은 과목은 1개", body: 245, className: s.fullRow },
    ],
  },
  {
    title: "학생 · 학습 · 상담",
    note: "학생 구성과 학습·상담 신호",
    panels: [
      { title: "과목별 수강", note: "현재 재원생 · 과목별 수강과 동시 수강", body: 300 },
      { title: "학년별 재원생", note: "현재 재원생 · 학원설정 학년 순 · 영어·수학 수강 구성", body: 300 },
      { title: "학교별 학생", note: "현재 재원생 · 초등·중등·고등", body: 520, className: s.schoolPanel },
      { title: "신규 콜&상담 전환", note: "지난달 · 이번 달 · 접수일 기준", body: 170 },
      { title: "반복 결석 학생", note: "최근 14일 · 사전 통보 제외", body: 180 },
      { title: "최근 14일 등원율", note: "오늘 포함 14일 · (출석 + 지각) / 유효 출결 칸", body: 200 },
      { title: "상담 진행", note: "접수일 기준 최근 30일 · 접수 → 수업 시작", body: 230 },
    ],
    followups: [
      { title: "학습 · 학부모 보고", note: "수업보고서 기준", body: 200 },
      { title: "학생 상담", note: "최근 7일 · 전체 기록 · 후속조치", body: 180 },
    ],
  },
  {
    title: "수업과 학원 운영",
    note: "신규생 체크 · 강사 시트 · 일정과 행정",
    panels: [
      { title: "신규생 체크 진행", note: "등록 후 90일 · 필수 6항목 · 2개월 콜은 선택", body: 230 },
      { title: "강사 시트 작성 현황", note: "영어 이번 주(보기 필터 기준) · 수학 이번 달", body: 160 },
      { title: "현재 수업 현황", note: "오늘 시간표", body: 250 },
      { title: "레벨테스트 및 첫수업 일정", note: "오늘부터 한 달 · 10/15 (목)까지", body: 250 },
      { title: "직원 구성", note: "현재 재직 중 · 운영 역할 기준", body: 205 },
      { title: "행정 · 자산", note: "현재 · 누적 건수 · 열람 가능한 업무 기준", body: 180 },
      { title: "9월 지출 내역", note: "이번 달 지출결의서 기준", body: 200 },
      { title: "학원 공지", note: "최근 공지 · 대상 권한 반영", body: 200 },
    ],
  },
];

function PanelSkeleton({ title, note, body, wide, className }: PanelShape) {
  return (
    <section className={`${s.panel} ${wide ? s.wide : ""} ${className ?? ""}`}>
      <header className={s.panelHeader}>
        <div>
          <h2>
            <span className={T}>{title}</span>
          </h2>
          <p>
            <span className={T}>{note}</span>
          </p>
        </div>
        <span className={`${s.jump} ${T}`}>상세</span>
      </header>
      <div className={s.panelBody}>
        <div className="bg-bg-soft animate-pulse rounded" style={{ height: body }} />
      </div>
    </section>
  );
}

export default function DashboardLoading() {
  return (
    <div className={s.root} aria-busy="true" aria-label="학원 전체 현황을 불러오는 중">
      <div className={s.board}>
        <header className={s.header}>
          <div className={s.identity}>
            <span className={`${s.eyebrow} ${T}`}>에이와 · ACADEMY OVERVIEW</span>
            <h1>
              <i className={`not-italic ${T}`}>학원 전체 현황</i>
              <span className={T}>2026.09.11</span>
            </h1>
          </div>
          <div className={s.headerTools}>
            <div className={s.freshness}>
              <i className={s.dotLive} />
              <span className={T}>
                자동 갱신
                <small>00:00 확인 · 5분 주기</small>
              </span>
            </div>
            <span className={`${s.refresh} ${T}`} />
          </div>
        </header>
        {/* 열 수 = 칸 수(실제 띠의 `kpiGridVars`와 같은 변수) — 없으면 기본 6열이라 일곱째 칸이 줄을 바꿔 로드 끝에 화면이 튄다. */}
        <div className={s.kpis} style={{ "--kpi-n": KPI.length, "--kpi-mid": 3, "--kpi-last-mid": "auto" } as CSSProperties} data-kpi-n={KPI.length}>
          {KPI.map(([label, value, unit, detail]) => (
            <div key={label} className={s.kpi}>
              <div className={s.kpiBody}>
                <span className={s.kpiLabel}>
                  <span className={s.kpiIcon}>
                    <i className="bg-bg-soft block size-5 animate-pulse rounded" />
                  </span>
                  <span className={T}>{label}</span>
                </span>
                <span className={`${s.kpiValue} text-transparent`}>
                  <i className={`not-italic ${T}`}>{value}</i>
                  <span>{unit}</span>
                </span>
                <span className={s.kpiDetail}>
                  <i className={`not-italic ${T}`}>{detail}</i>
                </span>
              </div>
            </div>
          ))}
        </div>
        {SECTIONS.map((section) => (
          <div key={section.title}>
            <div className={s.sectionLine}>
              <span className={T}>{section.title}</span>
              <p>
                <span className={T}>{section.note}</span>
              </p>
            </div>
            <div className={s.grid}>
              {section.panels.map((panel) => (
                <PanelSkeleton key={panel.title} {...panel} />
              ))}
              {section.followups && (
                <div className={s.followupPanels}>
                  {section.followups.map((panel) => (
                    <PanelSkeleton key={panel.title} {...panel} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        <footer className={s.footer}>
          <span className={T}>에이와 / OVERVIEW</span>
        </footer>
      </div>
    </div>
  );
}
