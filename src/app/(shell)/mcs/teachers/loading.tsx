import { ToolbarSkeletonItem } from "@/components/toolbar";
import styles from "./teachers.module.css";

/**
 * MCS 선생님별 보기 스켈레톤(B7) — 전 반 학생의 주문·보고서를 모아 계산하는 화면이라 첫 페인트를 그 조회에 매달지 않는다.
 * 실물(page.tsx)과 **같은 CSS 모듈 클래스**로 그린다: 머리(h2·설명 + 보기 전환) → '전체 평균' 줄 → 선생님 묶음 격자
 * (`auto-fill minmax(420px, 1fr)`). 🔴 묶음은 **접힌 채** 뜬다(10/20 — 머리 줄만) → 스켈레톤도 머리 줄만 그린다
 * (옛 스켈레톤은 묶음마다 학생 5행을 펼쳐 데이터가 오면 화면이 통째로 줄어들었다). 선생님 수는 데이터라 근사(6명).
 * `inert` — 실물과 같은 details/summary라 누르면 열리므로 스켈레톤에선 막는다.
 */
const bar = "bg-bg-soft text-transparent animate-pulse rounded";

function Average() {
  return (
    <span className={styles.avg}>
      <b><span className={bar}>00%</span></b>
      <small><span className={bar}>0명 기준</span></small>
      <span className={styles.bar} />
    </span>
  );
}

export default function McsTeachersLoading() {
  return (
    <div aria-hidden inert className={styles.surface}>
      <header className={styles.heading}>
        <div>
          <h2><span className={bar}>수학 강사 시트 · 선생님별</span></h2>
          <p><span className={bar}>선생님이 맡은 학생과 교재 3개월 진행입니다. 학생을 누르면 상세가 열립니다.</span></p>
        </div>
        {/* 보기 전환(반별/선생님별) — 컨트롤 높이 변수(ToolbarSkeletonItem). */}
        <ToolbarSkeletonItem className="w-36" />
      </header>
      <span className={styles.total}>
        <small><span className={bar}>전체 평균</span></small>
        <b><span className={bar}>00%</span></b>
        <small><span className={bar}>00명 기준</span></small>
        <span className={styles.bar} />
      </span>
      <div className={styles.groups}>
        {Array.from({ length: 6 }, (_, g) => (
          <details key={g} className={styles.group}>
            <summary>
              <h3><span className={bar}>선생님 이름</span></h3>
              <span><span className={bar}>학생 00명</span></span>
              <Average />
              <i>›</i>
            </summary>
          </details>
        ))}
      </div>
    </div>
  );
}
