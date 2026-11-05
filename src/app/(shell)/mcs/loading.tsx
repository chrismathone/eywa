import { ToolbarSkeletonItem } from "@/components/toolbar";
import styles from "./landing.module.css";

/**
 * MCS 랜딩 스켈레톤(B7) — 09-18 재설계(page.tsx · landing.module.css)와 **같은 CSS 모듈 클래스**로 빈 막대를 채운다:
 * 한 장 테두리 카드 → 머리(h2·설명 + 보기 전환·달 이동) → 요약 띠 3칸 → 단(정규) → 담임 상자 + 반 행.
 * 치수(여백·글자 크기·행 최소 높이 76px)는 모듈 CSS가 정하고, 막대는 투명 글자로 줄 높이를 잡는다(손 px 없음).
 *
 * 작성률 막대(2026-09-01)가 붙으면서 이 화면은 그 달 **전 반의 보고서·출결**을 집계한다(실측 dev ~0.9s) —
 * 첫 페인트를 그 조회에 매달면 창(iframe)으로 열 때 빈 화면이 그만큼 남는다.
 * PageHeader 없음(자체 머리 h2) — 최대화 가드의 예외 목록(NOT_PAGE_HEADER)에 이 파일이 있다.
 *
 * 🔴 **강사 경로에 맞춘다** — 이 화면은 수학 강사 전원의 매일 첫 화면이다(progress-map/server/access.ts 주석). 강사는 자기 반만
 *    보므로 담임 상자가 하나고, 특강 반이 없으면 `splitLandingByTrack`이 null이라 **폭 전체 한 단**이다(page.tsx — 72반 중 특강
 *    7반이라 이 경우가 흔하다. `styles.singlePanel`은 CSS에 없어 맨 div다). 관리자 전용 '진도맵(시안) ↗' 링크도 그리지 않는다.
 *    원장·사무실(전 반 · 정규/특강 2단)은 본문 길이가 다르다 — loading.tsx는 역할을 못 읽어 감수한다.
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";
// 요약 띠는 바탕이 bg-soft라 막대를 카드색으로(같은 색이면 안 보인다).
const onSoft = "bg-card text-transparent animate-pulse rounded";
// 담임 상자 하나(강사 본인) × 반 수 — 실데이터 근사.
const GROUPS = [5];

function Panel({ label }: { label: string }) {
  return (
    <section className={styles.panel}>
      <header className={styles.panelHeading}>
        {/* 실물 = 글자 + `h3 > span` 배지 — 글자 막대를 span으로 두면 배지 규칙을 입으므로 다른 요소로. */}
        <h3>
          <i className={`not-italic ${bar}`}>{label}</i>
          <span><span className="text-transparent">00반</span></span>
        </h3>
        <span className={styles.panelSummary}>
          <span className={bar}>00/00건 00%</span>
        </span>
      </header>
      <div className={styles.teacherGroups}>
        {GROUPS.map((rows, g) => (
          <section key={g} className={styles.teacherGroup}>
            <header className={styles.teacherHeading}>
              <h4><span className={bar}>담임 이름</span></h4>
              <span><span className={bar}>0개 반</span></span>
            </header>
            <div className={styles.rows}>
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className={styles.row}>
                  <span className={styles.classInfo}>
                    <strong><span className={bar}>반 이름 자리</span></strong>
                    <span><span className={bar}>수업 0일 · 학생 0명 · 정규 진도</span></span>
                  </span>
                  <span className={styles.writing}>
                    <span className={styles.writingLabel}>
                      <span className={bar}>0/0 작성</span>
                      <b><span className={bar}>00%</span></b>
                    </span>
                    <span className={`${styles.progress} animate-pulse`} />
                  </span>
                  <span className={styles.arrow}><span className="text-transparent">›</span></span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  );
}

export default function McsLandingLoading() {
  return (
    <div aria-hidden className={styles.surface}>
      <header className={styles.heading}>
        <div>
          <h2><span className={bar}>수학 강사 시트</span></h2>
          <p><span className={bar}>반별 수업 기록과 학생 진도를 한곳에서 확인하세요.</span></p>
        </div>
        {/* 보기 전환(반별/선생님별) · 달 이동 — 컨트롤 높이 변수(ToolbarSkeletonItem). */}
        <div className={styles.headingTools}>
          <ToolbarSkeletonItem className="w-36" />
          <ToolbarSkeletonItem className="w-56" />
        </div>
      </header>
      <div className={styles.summary}>
        <div className={styles.summaryCount}>
          <span><span className={onSoft}>이번 달 수업</span></span>
          <strong><span className={onSoft}>00개 반</span></strong>
        </div>
        <div className={styles.summaryProgress}>
          <div>
            <span><span className={onSoft}>전체 기록 작성률</span></span>
            <strong><span className={onSoft}>00%</span></strong>
          </div>
          <span className={styles.progress} />
          <small><span className={onSoft}>000 / 000건 작성</span></small>
        </div>
        <div className={styles.summaryAction}>
          <p>
            <span className={onSoft}>반을 선택하면</span>
            <br />
            <span className={onSoft}>학생별 진도와 목표가 열립니다.</span>
          </p>
        </div>
      </div>
      {/* 한 단 = 실물 `styles.singlePanel`(정의 없음 → 맨 div). */}
      <div>
        <Panel label="정규" />
      </div>
    </div>
  );
}
