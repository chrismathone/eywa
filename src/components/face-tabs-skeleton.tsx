import { FACE_TAB_ITEM, FACE_TABS_NAV, FACE_TABS_NAV_LEVEL } from "./face-tabs-classes";

/**
 * 면 탭 스켈레톤 — `loading.tsx`에서 면 탭 줄을 손으로 그리지 말고 이것을 쓴다(실물 `FaceTabs`와 같은 껍데기·같은 치수 상수).
 * - `level` — 실물과 같은 값(1차 = 폭 전체 밑줄 · 2차 = 내용 폭 상자).
 * - `labels` — 실물 탭 이름(흔한 첫 화면 기준). 주면 **실물과 같은 글자 클래스의 투명 글자**로 칸을 채워 칸 폭이 실물과 같다
 *   (줄이 넘치는 폭·옆 배지가 내려가는 폭이 같아진다 — 고정 폭 `w-16`은 18px 라벨보다 한참 좁았다, 2026-11-05 리뷰).
 * - `dividers` — 실물이 묶음 경계에 긋는 세로 구분선 자리(그 칸 **앞**의 0부터 센 번호). 실물 `FaceTabs`의 `group`이 바뀌는 곳.
 * - `count` — `labels`가 없을 때만 쓰는 칸 수(고정 폭 칸 — 높이는 늘 `--control-h` + 밑줄).
 */
export function FaceTabsSkeleton({
  level = "primary",
  labels,
  dividers = [],
  count = 4,
}: {
  level?: "primary" | "secondary";
  labels?: readonly string[];
  dividers?: readonly number[];
  count?: number;
}) {
  return (
    <div aria-hidden className="flex min-w-0 items-stretch">
      <div className="relative min-w-0 flex-1">
        <div className={`${FACE_TABS_NAV} ${FACE_TABS_NAV_LEVEL[level]}`}>
          {labels
            ? labels.map((label, i) => (
                // 실물과 같은 감싸개 — 구분선은 뒤 칸과 한 덩어리(face-tabs.tsx).
                <span key={i} className="flex shrink-0 items-center">
                  {i > 0 && dividers.includes(i) ? <span className="bg-border mx-1 h-4 w-px shrink-0" /> : null}
                  <span
                    className={`${FACE_TAB_ITEM} bg-bg-soft animate-pulse text-(length:--control-label) leading-none font-medium whitespace-nowrap text-transparent`}
                  >
                    {label}
                  </span>
                </span>
              ))
            : Array.from({ length: count }, (_, i) => <span key={i} className={`${FACE_TAB_ITEM} bg-bg-soft w-16 animate-pulse`} />)}
        </div>
      </div>
    </div>
  );
}
