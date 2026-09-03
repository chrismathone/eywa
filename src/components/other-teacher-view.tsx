"use client";

import { useState, useTransition } from "react";
import { EyIcon } from "@/components/icons/eywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listTeacherViewTargets,
  switchToAdminView,
  switchToOtherTeacherView,
  type TeacherViewTarget,
} from "@/features/shell/view-actions";
import { TONE_SOFT } from "@/lib/design/semantic-color";

// 사이드바 레일과 동일 톤의 모핑 이징(view-mode-toggle과 동일).
const EASE = "ease-[cubic-bezier(0.22,0.61,0.36,1)]";

/** 대상 목록은 드롭다운을 **열 때만** 서버에서 가져온다(지연 로드 — 레이아웃 상시 비용 0). */
function useTeacherTargets() {
  const [targets, setTargets] = useState<TeacherViewTarget[] | null>(null);
  const [loading, startLoad] = useTransition();
  const load = () => {
    if (targets !== null || loading) return;
    startLoad(async () => setTargets(await listTeacherViewTargets()));
  };
  return { targets, loading, load };
}

/** 강사 목록 드롭다운 항목들 — 클릭 시 그 강사 뷰로 전환(풀 문서 네비, view-actions 규약). */
function TargetItems({ targets, loading }: { targets: TeacherViewTarget[] | null; loading: boolean }) {
  const [pending, start] = useTransition();
  const go = (id: string) =>
    start(async () => {
      // 착지 경로 반환 → window.location 풀 문서 네비(라우터 캐시 오염 방지 — switchToTeacherView와 동일).
      const dest = await switchToOtherTeacherView(id);
      if (dest) window.location.assign(dest);
    });
  if (loading || targets === null)
    return <div className="text-text-faint px-2 py-1.5 text-sm">불러오는 중…</div>;
  if (targets.length === 0)
    return <div className="text-text-faint px-2 py-1.5 text-sm">전환할 강사가 없습니다</div>;
  return (
    <>
      {targets.map((t) => (
        <DropdownMenuItem
          key={t.id}
          closeOnClick={false}
          className="cursor-pointer"
          disabled={pending}
          onClick={() => go(t.id)}
        >
          <EyIcon name="user" size={16} strokeWidth={1.8} /> {t.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * 사이드바 하단 '다른 강사 뷰'(열람 전용) 진입 — master·super_admin·직원관리 '강사뷰 접근' 토글 사용자만
 * 노출(부모가 canUseOtherTeacherView로 판정해 렌더). 겸직의 '강사뷰로 전환'(본인·쓰기 가능)과 별개 항목.
 */
export function OtherTeacherViewPicker({ expanded, motion }: { expanded: boolean; motion: boolean }) {
  const { targets, loading, load } = useTeacherTargets();
  const btn = (
    <button
      type="button"
      aria-label="다른 강사 뷰 보기"
      // 접힘 레일에선 라벨이 안 보인다 — title로 보강(사이드바는 데스크톱 전용이라 title 툴팁이 유효).
      title={expanded ? undefined : "다른 강사 뷰 보기"}
      className="group relative flex h-9 w-full items-center gap-2.5 pl-[17px] focus:outline-none"
    >
      <span
        aria-hidden="true"
        style={{ left: expanded ? 4 : 8, right: expanded ? 4 : 8 }}
        className={`bg-sidebar-accent pointer-events-none absolute inset-y-0 z-0 rounded-lg opacity-0 group-hover:opacity-100 ${
          motion ? `transition-[left,right,opacity] duration-200 ${EASE}` : ""
        }`}
      />
      <EyIcon
        name="users"
        size={18}
        strokeWidth={1.8}
        className={`text-text-dim group-hover:text-foreground relative z-10 shrink-0 ${
          motion ? "transition-colors duration-200" : ""
        }`}
      />
      <span
        className={`text-text-dim group-hover:text-foreground relative z-10 overflow-hidden text-sm font-medium whitespace-nowrap ${
          expanded ? "max-w-[160px] opacity-100" : "max-w-0 opacity-0"
        } ${motion ? `transition-[max-width,opacity,color] duration-200 ${EASE}` : ""}`}
      >
        다른 강사 뷰
      </span>
    </button>
  );
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger render={btn} />
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-text-faint">다른 강사 뷰 (열람 전용)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* 목록만 스크롤(라벨은 고정) — 강사가 많아도 머리글이 밀려 나가지 않는다. */}
        <div className="max-h-64 overflow-y-auto">
          <TargetItems targets={targets} loading={loading} />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * '다른 강사 뷰' 열람 중 배지 — 강사 미니셸 헤더에서 **누구의 화면인지**를 항상 보여준다(의미색 special:
 * 예외·대체 상태). 누르면 다른 강사로 갈아타거나 관리자뷰로 돌아간다. 대상 강사 화면엔 아무것도 안 뜬다
 * (presence track 차단 — 열람 사실은 감사로그에만 남는다).
 */
export function ViewAsChip({ name }: { name: string }) {
  const { targets, loading, load } = useTeacherTargets();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && load()}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`${TONE_SOFT.special} flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold`}
          />
        }
      >
        <EyIcon name="users" size={13} strokeWidth={2} />
        {/* 임포트 계정 등 이름이 빈 강사 — 빈 칩("강사뷰"만)이 되지 않게 폴백. */}
        <span className="max-w-[9rem] truncate">{name || "이름 없음"} 강사뷰</span>
        <span className="hidden font-medium opacity-80 sm:inline">· 열람 전용</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="text-text-faint">다른 강사로 전환 (열람 전용)</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {/* 🔴 스크롤은 **목록만** — 강사가 스무 명이면 아래 종료행이 목록 끝까지 내려야 보였다
            (원장 2026-08-19: "종료 버튼 따로, 강사 목록 아래에 고정행으로"). */}
        <div className="max-h-64 overflow-y-auto">
          <TargetItems targets={targets} loading={loading} />
        </div>
        <DropdownMenuSeparator />
        {/* 열람 종료 — 항상 보이는 고정행(스크롤 밖). */}
        <DropdownMenuItem
          closeOnClick={false}
          className="cursor-pointer font-medium"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const dest = await switchToAdminView();
              window.location.assign(dest);
            })
          }
        >
          <EyIcon name="building" size={16} strokeWidth={1.8} /> 열람 종료 — 관리자뷰로 돌아가기
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
