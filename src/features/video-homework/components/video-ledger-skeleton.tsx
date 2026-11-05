import { Toolbar, ToolbarSkeletonItem } from "@/components/toolbar";
import styles from "./video-homework-management.module.css";

/**
 * 영상 숙제 장부 스켈레톤 — 관리자 화면(`/lesson-reports/video-homework`)과 강사뷰(`/onescreen/video-homework`)의 `loading.tsx`가 함께 쓴다
 * (두 화면이 같은 `VideoHomeworkManagement`를 그린다). 줄 순서 = 실물: 툴바(`LedgerToolbar`) → 요약 줄 → 안내 줄 → 반 묶음.
 * 치수는 손으로 적지 않고 실물 CSS 모듈 클래스(`.summary`·`.hint`·`.group`·`.groupHeading`·`.table` …)를 그대로 입힌다 — 장부를 고치면 따라온다.
 * 글자 자리는 투명 글자(줄 높이 = 실물). 🔴 이 파일에 `"use client"`를 붙이지 말 것 — 서버 컴포넌트인 `loading.tsx`가 그린다.
 * ⚠️ 열 폭(class-ledger.tsx `COLUMN_WIDTH`)은 클라이언트 파일 안 상수라 가져오지 않는다 — 표는 폭 전체로 고르게 나누고 높이(48px 행)만 맞춘다.
 */
const BAR = "bg-bg-soft text-transparent animate-pulse rounded";
const CTRL_SM = "bg-bg-soft h-(--control-h-sm) animate-pulse rounded";
// 안내 줄 — 실물과 같은 문장을 투명 글자로 깔아 줄 수(보통 2줄)를 실물과 같게 감는다.
const HINT = "회차 = 영상 과제가 나간 수업·따로 낸 숙제(학생마다 순서) · 칸 위 숙제 날·아래 제출일 · ▶ 영상 · 초록 테두리 = 영상 자동 완료 · 수동 = 영상 없이 완료 · × 미수행 · 점선 = 따로 낸 숙제 · — 회차 없음 · 미확인 칸 클릭 = 오늘 완료 · 우클릭 = 편집(숙제없음 칸은 숙제 출제 · 영상 배정)";

export function VideoLedgerSkeleton({ groups = 2, rows = 3, rounds = 6 }: { groups?: number; rows?: number; rounds?: number }) {
  const cols = 4 + rounds; // 선택·학생·학교·완료 + 회차
  return (
    // 반 머리의 hover 배경 등 실물 상호작용 스타일이 스켈레톤에서 켜지지 않게 포인터를 끈다.
    <div aria-hidden className={`${styles.ledger} pointer-events-none`}>
      {/* 툴바 — 실물(LedgerToolbar)과 같은 `<Toolbar>` 설정(gap-2 · 레일 없음). 날짜 칸 폭 = `.dateFilter input`(164px) · 검색 = `.search`.
          나머지 칸 폭 = 실물 라벨 길이에 가깝게(기간 조회 · 과목 · 학년 · 상태 '영상 배정 필요함' · 정렬 '미수행 많은 순' · 초기화 · 검색 결과 CSV,
          합 약 1,460px) — 좁은 창에서 실물과 같은 폭에서 줄이 감긴다. */}
      <div className={styles.filters}>
        <Toolbar className={styles.filterRow} gap="gap-2" rail={false}>
          <ToolbarSkeletonItem className="w-41" />
          <span className={styles.dateSeparator}>–</span>
          <ToolbarSkeletonItem className="w-41" />
          <ToolbarSkeletonItem className="w-23" />
          <ToolbarSkeletonItem className={styles.search} />
          <ToolbarSkeletonItem className="w-28" />
          <ToolbarSkeletonItem className="w-28" />
          <ToolbarSkeletonItem className="w-40" />
          <ToolbarSkeletonItem className="w-40" />
          <ToolbarSkeletonItem className="w-16" />
          <ToolbarSkeletonItem className="w-33" />
        </Toolbar>
      </div>
      {/* 요약 줄 — 검색 결과·완료·미수행·미확인 + 오른쪽 '모두 펼치기·접기'(작은 컨트롤 높이). */}
      <div className={styles.summary}>
        <span className={BAR}>검색 결과 00명·반 / 00</span>
        <span className={BAR}>완료 00회</span>
        <span className={BAR}>미수행 00회</span>
        <span className={BAR}>미확인 00회</span>
        <div className={styles.expandActions}>
          <span className={`${CTRL_SM} w-16`} />
          <span className={`${CTRL_SM} w-14`} />
        </div>
      </div>
      {/* 공용 SkeletonText를 쓰지 않는 이유 — `.hint`(CSS 모듈 = 레이어 밖)의 글자색이 바깥 `text-transparent`를 이겨 글자가 드러난다. 투명은 안쪽 막대에. */}
      <p className={styles.hint}><span className={`${BAR} box-decoration-clone`}>{HINT}</span></p>
      {Array.from({ length: groups }, (_, g) => (
        <section key={g} className={styles.group}>
          {/* 반 머리(회색) — 접기 화살표 · 반 이름 · 과목·인원 · 오른쪽 합계. */}
          <div className={styles.groupHeading}>
            <span className="size-4.5 shrink-0" />
            <strong className={BAR}>반 이름 자리</strong>
            <span className={`${styles.groupMeta} ${BAR}`}>과목 · 00명</span>
            <span className={styles.groupTotals}>
              <span className={BAR}>완료 00 · 미수행 00 · 미확인 00</span>
            </span>
          </div>
          {/* 반 도구 줄 — 일괄 적용(작은 컨트롤) · 오른쪽 회차 넘기기. */}
          <div className={styles.groupToolbar}>
            <span className={`${CTRL_SM} w-64 max-w-full`} />
            <span className={styles.roundPager}>
              <span className={`${CTRL_SM} w-28`} />
            </span>
          </div>
          <div className={styles.tableScroll}>
            <table className={`${styles.table} w-full`}>
              <thead>
                <tr>
                  {Array.from({ length: cols }, (_, c) => (
                    <th key={c}><span className={BAR}>{c < 4 ? "열" : "0회"}</span></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: rows }, (_, r) => (
                  <tr key={r}>
                    {Array.from({ length: cols }, (_, c) => (
                      <td key={c}>
                        {c < 4 ? <span className={BAR}>이름</span> : <span className={`${styles.mark} bg-bg-soft animate-pulse`} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.groupFooter}>
            <span className={BAR}>00명 중 1–00명</span>
          </div>
        </section>
      ))}
    </div>
  );
}
