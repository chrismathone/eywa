import { Toolbar } from "@/components/toolbar";
import { SkeletonLine } from "@/components/skeleton-text";
import styles from "./_components/newcomer-board.module.css";

/** 막대 — 실물 글자를 투명하게 두어 줄 높이·폭을 실물 글자가 정하게 한다(BigStatSkeleton과 같은 방식). */
const BAR = "bg-bg-soft text-transparent animate-pulse rounded";
const STATUS_TABS = 4; // 전체 · 기한 경과 · 3일 내 · 미완료(newcomer-board STATUS_TABS)
/**
 * 지표 5칸 — 실물(newcomer-board Metric) 라벨 · 단위 · 보조 설명 문구 그대로(숫자만 자리표시). 같은 폭에서 같은 줄 수로 감긴다.
 * 🔴 실물 문구를 바꾸면 여기도 같이 바꿀 것.
 */
const METRICS = [
  { label: "전체 관리 대상", unit: "명", note: "000개 학생·과목 행 · 최근 90일 등록" },
  { label: "미완료 학생", unit: "명", note: "기한 경과 · 3일 내 기한 업무가 있는 학생" },
  { label: "기한 경과 업무", unit: "건", note: "기한이 지난 필수 업무" },
  { label: "3일 내 기한 업무", unit: "건", note: "오늘부터 3일 뒤까지 기한인 필수 업무" },
  { label: "필수 업무 완료율", unit: "%", note: "000 / 000건 완료" },
];

/**
 * 신규생 관리 스켈레톤 — 실 보드(newcomer-board.tsx)와 **같은 모듈 클래스**로 같은 칸을 그린다(높이를 손으로 적지 않는다).
 * 순서 = 머리 줄(폰트 토글 · 제목+설명(컴팩트에선 숨김) · 오른쪽 기준 날짜) → 지표 5칸 → 우선 처리 줄 → 패널(필터 줄 · 표 위 줄 · 표 · 아래 줄).
 * 경고·실패 띠는 상태에 따라 서므로 그리지 않는다.
 */
export default function Loading() {
  return (
    <div className={`${styles.board} edge-to-edge`} aria-busy="true" aria-label="신규생 관리 불러오는 중">
      <p className="sr-only" role="status">신규생 관리 기록을 불러오고 있습니다…</p>
      <div className={styles.header} aria-hidden>
        {/* 폰트 토글 — 실물 칸(라벨 `0 6px` · 버튼 `5px 8px`)과 같은 여백. `.fontToggle > span` 규칙이 글자색을 덮지 않게 div로 둔다. */}
        <div className={`${styles.fontToggle} animate-pulse`}>
          <div className="px-1.5 text-transparent">폰트</div>
          <div className="px-2 py-1.25 text-transparent">작은 글자</div>
          <div className="px-2 py-1.25 text-transparent">큰 글자</div>
        </div>
        <div className="compact-chrome:hidden">
          {/* 제목 줄(24px 굵게 + 아이콘 28px) · 설명 한 줄 — 실물 `.header h1`·`.header p`와 같은 태그라 같은 치수다. */}
          <h1>
            <span className={BAR}>신규생 90일 관리 제목</span>
          </h1>
          <p>
            <span className={BAR}>첫 수업부터 90일까지, 놓치지 않는 학생 관리.</span>
          </p>
        </div>
        <div className={styles.headerMeta}>
          <span className={BAR}>기준 날짜 2026. 00. 00</span>
        </div>
      </div>

      <div className={styles.metrics} aria-hidden>
        {METRICS.map((m) => (
          <div key={m.label} className={styles.metric}>
            <span className={`${styles.metricIcon} animate-pulse`} />
            <div>
              <span className={styles.metricLabel}>
                <span className={BAR}>{m.label}</span>
              </span>
              <div className={styles.metricValue}>
                <span className={BAR}>000</span>
                <small className="text-transparent">{m.unit}</small>
              </div>
            </div>
            <span className={styles.metricNote}>
              <span className={BAR}>{m.note}</span>
            </span>
          </div>
        ))}
      </div>

      <div className={styles.priority} aria-hidden>
        <span className={BAR}>우선 처리 0건</span>
      </div>

      <div className={styles.panel} aria-hidden>
        {/* 필터 줄 = 실물 Toolbar(레일 없음) + 모듈 컨트롤(31px — `--control-h`가 아니라 `.tools select, .density` 한 규칙이 정한다). */}
        <div className={styles.toolbar}>
          <Toolbar rail={false} gap="" className={styles.toolbarInner}>
            <div className={styles.tabs}>
              {Array.from({ length: STATUS_TABS }, (_, i) => (
                <span key={i} className={`${styles.density} w-20 animate-pulse`} />
              ))}
            </div>
            <div className={styles.tools}>
              <span className={`${styles.search} w-44 animate-pulse`} />
              {/* 등록 경과 구간 · 과목 · 정렬 · 압축 */}
              <span className={`${styles.density} w-36 animate-pulse`} />
              <span className={`${styles.density} w-24 animate-pulse`} />
              <span className={`${styles.density} w-28 animate-pulse`} />
              <span className={`${styles.density} w-16 animate-pulse`} />
            </div>
          </Toolbar>
        </div>
        <div className={styles.tableMeta}>
          <span className={BAR}>집계·구간 숫자는 전체 대상 기준</span>
        </div>
        <div className={styles.tableScroll}>
          {/* 표 머리 36px(`.table th`) · 행 36px(`.table td`). */}
          <div className="bg-bg-soft border-line-faint h-9 animate-pulse border-y" />
          {Array.from({ length: 14 }, (_, i) => (
            <div key={i} className="border-line-faint flex h-9 items-center border-b px-3.5">
              <SkeletonLine className="w-3/4" />
            </div>
          ))}
        </div>
        <div className={styles.footer}>
          <span className={BAR}>0명 · 0행 표시 / 전체 0명</span>
        </div>
      </div>
    </div>
  );
}
