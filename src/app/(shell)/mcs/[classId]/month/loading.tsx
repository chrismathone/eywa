import { PageHeaderSkeleton } from "@/components/page-header";
import { PeriodNavSkeleton } from "@/components/period-nav-skeleton";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { SHEET_BAR } from "@/features/class-sheets/chrome";
import { SheetBarDivider } from "@/features/class-sheets/components/sheet-chrome";
import { SheetClassPickerSkeleton } from "@/features/class-sheets/components/sheet-chrome-skeleton";
import styles from "@/features/math-sheets/components/learning-overview.module.css";
import book from "@/features/math-sheets/components/math-textbook.module.css";
import card from "@/features/math-sheets/components/plan-card.module.css";

/**
 * MCS 월간 스켈레톤(B7) — 09-17부터 본문은 `LearningOverview`(learning-overview.tsx)다. 같은 순서·**같은 CSS 모듈 클래스**로 빈 막대를 채운다:
 * 상단 바(SHEET_BAR) → 카드 한 장(머리 · 전체 목표 요약 띠 · 반 교재 줄 · 상태 필터 + 검색 · 학생 계획 카드 · 꼬리 띠).
 * 여백·글자 크기·컨트롤 높이는 모듈 CSS가 정하고 막대는 투명 글자로 줄 높이를 잡는다(손 px 없음). 옛 74px 행 6줄은 09-17 이전 표 모양이었다.
 * 학생 카드 본문(목표 레일·교재 3개월)은 데이터 따라 높이가 달라 근사다. 편집 권한이 없으면 머리 오른쪽 버튼이 없다(가장 흔한 경로 = 편집 가능).
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";
// 요약 띠·카드 왼쪽 칸은 바탕이 bg-soft라 막대를 카드색으로(같은 색이면 안 보인다).
const onSoft = "bg-card text-transparent animate-pulse rounded";
const FILTERS = ["계획보다 느림", "계획대로", "계획보다 빠름", "목표·진도 확인"]; // '전체'는 켜진 칸이라 따로

function PlanCard() {
  return (
    <article className={card.card}>
      <header className={card.top}>
        <div className={card.who}>
          <span className={card.name}><span className={bar}>학생 이름</span></span>
          <span className={card.meta}><span className={bar}>학교 학년</span></span>
        </div>
        <span className={card.badge}><span className="text-transparent">계획대로</span></span>
      </header>
      {["전체 목표", "교재 3개월"].map((title) => (
        <section key={title} className={card.sec}>
          <div className={card.lab}>
            {/* `.lab span`이 칸 안 모든 span을 블록·작은 글자로 만든다 — 막대는 i로(바깥 span은 실물과 같은 설명 줄). */}
            <b><i className={`not-italic ${onSoft}`}>{title}</i></b>
            <span><i className={`not-italic ${onSoft}`}>설명 자리 설명 자리</i></span>
          </div>
          <div className={card.body}>
            <div className={card.row}>
              <h4><span className={bar}>과정 범위 · 00블록</span></h4>
            </div>
            <div className="bg-bg-soft mt-3 h-2 animate-pulse rounded-full" />
            <p className="mt-2 text-sm"><span className={bar}>현재 위치 · 다음 목표</span></p>
          </div>
        </section>
      ))}
    </article>
  );
}

export default function McsMonthLoading() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* 실물도 머리글을 compact-chrome:hidden 래퍼로 감싼다(창에선 머리 줄 통째 숨김). */}
      <PageHeaderSkeleton hideCompact />
      <div className="min-h-0 flex-1">
        <div aria-hidden className={styles.root}>
          {/* 상단 바 — 실물 SheetClassPicker 세 덩어리('목록' 칩 · 노란 반 선택 `MARKER_TRIGGER` h-10 × `MARKER_WIDTH` 380px ·
              '반 정보 보기' 칩) · 달 이동 · (오른쪽) 글씨 크기. 반·달을 옮길 때마다 뜨는 스켈레톤이라 줄 높이(h-10)가 중요하다. */}
          <div className={SHEET_BAR}>
            <SheetClassPickerSkeleton />
            <SheetBarDivider />
            {/* 달 이동 = PeriodNav 기본 라벨 폭(labelWidth 안 줌 — 실물 learning-overview.tsx와 같다) */}
            <PeriodNavSkeleton />
            <span className="flex-1" />
            {/* 글씨 = 실물 HrefSelect 트리거(`TOOLBAR_SELECT` + 16px 쉐브론) */}
            <span className={`${TOOLBAR_SELECT} shrink-0 animate-pulse gap-2`}>
              <span className="text-transparent">글씨: 작음</span>
              <span className="block size-4 shrink-0" />
            </span>
          </div>
          <div className={styles.surface}>
            <header className={styles.heading}>
              <div>
                <div className={styles.headingTitle}>
                  <h2><span className={bar}>수학 진도 관리</span></h2>
                  <span className={styles.trackBadge}><span className="text-transparent">정규 진도</span></span>
                  <span className={styles.trackCaption}><span className={bar}>월 0블록</span></span>
                </div>
              </div>
              {/* 학교별 내신기간 · 수업 유형 설정 · 전체 목표 설정 — 실물과 같은 `.button` 상자(높이 = 컨트롤 변수)에 투명 글자. */}
              <div className={styles.headingActions}>
                {["학교별 내신기간", "수업 유형 설정"].map((b) => (
                  <span key={b} className={`${styles.button} animate-pulse`}><span className="text-transparent">{b}</span></span>
                ))}
                <span className={`${styles.primaryButton} animate-pulse`}><span className="text-transparent">전체 목표 설정</span></span>
              </div>
            </header>
            <div className={styles.goalSummary}>
              <div>
                <small><span className={onSoft}>전체 학습 목표</span></small>
                <strong><span className={onSoft}>과정 범위 · 00블록</span></strong>
              </div>
              {/* `p > span`은 블록 규칙(목표 기간 줄)이라 막대는 i로. */}
              <p><i className={`not-italic ${onSoft}`}>전체 목표를 정하면 월간·주간·일간 계획이 자동으로 나뉩니다.</i></p>
              <span className={styles.autoBadge}><span className="text-transparent">월·주·일 자동 배분</span></span>
            </div>
            <div className={book.bar}>
              <span className={book.label}><span className={bar}>반 교재</span></span>
              <strong className={book.title}><span className={bar}>교재 이름 자리</span></strong>
              <span className={book.hint}><span className={bar}>학생에게 따로 배정한 교재가 반 교재보다 우선합니다.</span></span>
              {/* 편집 가능 경로 — '반 교재 변경/배정'(실물 `.button`). */}
              <span className={`${styles.button} animate-pulse`}><span className="text-transparent">반 교재 변경</span></span>
            </div>
            <div className={styles.filters}>
              <div>
                <span className={`${styles.activeFilter} animate-pulse`}><span className="text-transparent">전체 0</span></span>
                {FILTERS.map((f) => (
                  <span key={f} className={styles.filter}><span className={bar}>{f} 0</span></span>
                ))}
              </div>
              <span className={styles.search}><span className={bar}>학생 검색 자리</span></span>
            </div>
            <div className={styles.cardList}>
              <PlanCard />
              <PlanCard />
            </div>
            <footer className={styles.footer}>
              <span><span className={onSoft}>현재 진도 · 단계별 목표</span></span>
              <span><span className={onSoft}>0000-00-00 기준</span></span>
            </footer>
          </div>
        </div>
      </div>
    </div>
  );
}
