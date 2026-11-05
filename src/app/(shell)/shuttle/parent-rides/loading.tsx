/**
 * 학부모 등하원 스켈레톤 — 오늘 등하원과 같은 조회를 받으므로 첫 페인트를 막지 않게 흘려보낸다(B7).
 * 모양 = 실 일별 화면(page.tsx · 주소 `?v=`를 못 읽어 기본인 일별): 툴바 줄(면 탭 · 날짜 이동 · 시즌) → 설명 줄 + [일별][월별]
 * → 검색칸 + 보기 칩 줄 → 카드 격자(xl 2열). [학부모 관리 현황]은 원장·관리자에게만 서므로 그리지 않는다.
 */
import { FaceTabsSkeleton } from "@/components/face-tabs-skeleton";
import { SkeletonLine } from "@/components/skeleton-text";
import { ToolbarSkeletonItem } from "@/components/toolbar";
import { SHUTTLE_CHIP, SHUTTLE_INPUT, SHUTTLE_PHONE_CONTROLS } from "@/features/shuttle/control-size";

/** 글자 막대 — 실물 문구를 투명하게 깔아 줄 수(데스크톱 2줄 · 폰 약 4줄)를 실물 글자가 정하게 한다. */
const TEXT_BAR = "bg-bg-soft text-transparent animate-pulse rounded";
/**
 * 실물 툴바 줄(page.tsx `TOOLBAR`) — 레일 아닌 감김(10-19). 면 탭이 `basis-full lg:basis-auto`라 1024px 미만은
 * 탭 한 줄 + 날짜·시즌 한 줄(2줄)이다. 🔴 실물 상수를 고치면 같이 고칠 것(page.tsx가 export하지 않는다).
 */
const TOOLBAR = `flex flex-wrap items-center gap-2 ${SHUTTLE_PHONE_CONTROLS}`;
/** 실물 설명 줄(page.tsx `INTRO_ROW`·`INTRO_TEXT`). */
const INTRO_ROW = "flex flex-wrap items-center justify-between gap-x-3 gap-y-2";
const INTRO_TEXT = "text-text-dim min-w-0 flex-1 basis-full text-sm break-keep md:basis-0";
/** 칩 자리 — 실물 칩 상수(폰 44px · 데스크톱 `--control-h` · 알약)에 막대 색만 얹는다. */
const CHIP = `${SHUTTLE_CHIP} bg-bg-soft animate-pulse`;
/** 면 탭 칸 — 관리자 전용 셋(탑승 학생 시간표 · 실시간 위치 · 가까운 노선 찾기)을 뺀 기본 다섯(faces.ts). */
const FACES = 5;

export default function Loading() {
  return (
    <div className="flex min-h-full w-full flex-col gap-3 p-3 md:px-5 md:py-4">
      {/* 툴바 줄 — 면 탭 + 날짜 이동(PeriodNav) + 시즌 드롭다운(ShuttleDayNav). */}
      <div className={TOOLBAR}>
        <span className="min-w-0 flex-1 basis-full lg:basis-auto">
          <FaceTabsSkeleton count={FACES} />
        </span>
        <ToolbarSkeletonItem className="w-64" />
        <ToolbarSkeletonItem className="w-32" />
      </div>
      <div className={INTRO_ROW}>
        {/* 설명 문장 — 실물 문구(일별) 그대로 투명 글자로. */}
        <p className={INTRO_TEXT}>
          <span className={TEXT_BAR}>
            2026년 11월 5일 (수) · 오늘 셔틀 00명 · 학부모 계정 연결 00명 — 굵은 문장과 노선이 학부모 화면에 그대로 보이는 것이고, 맨 아래
            줄(차량·기록·메모)은 직원에게만 보입니다.
          </span>
        </p>
        {/* [일별][월별] */}
        <span className="flex shrink-0 items-center gap-1">
          <span className={`${CHIP} w-14`} />
          <span className={`${CHIP} w-14`} />
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {/* 검색칸(폰 h-11 한 줄 다 · sm부터 w-64) + 보기 칩(전체 · 호차별 · 호차마다). */}
        <div className="flex flex-wrap items-center gap-2">
          <div className={`${SHUTTLE_INPUT} bg-bg-soft w-full animate-pulse sm:w-64`} />
          <div className="flex flex-wrap gap-1.5">
            {["w-16", "w-16", "w-20", "w-20"].map((w, i) => (
              <span key={i} className={`${CHIP} ${w}`} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            // 실물 카드 표면(ParentRideCard `bg-card rounded-2xl p-4`).
            <div key={i} className="bg-card h-40 rounded-2xl p-4 shadow-[var(--shadow-card)]">
              <SkeletonLine className="w-32 text-base font-bold" />
              <SkeletonLine className="mt-3 w-3/4 text-sm" />
              <SkeletonLine className="mt-2 w-1/2 text-sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
