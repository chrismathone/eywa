"use client";

import { useState, useTransition } from "react";
import { EyIcon } from "@/components/icons/aywa-icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOwnTeacherViewSwitch } from "@/components/view-mode-toggle";
import {
  listTeacherViewTargets,
  switchToAdminView,
  switchToOtherTeacherView,
  type TeacherViewTarget,
} from "@/features/shell/view-actions";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { sheetT, type SheetLang } from "@/features/teacher-view/i18n";

// 사이드바 레일과 동일 톤의 모핑 이징.
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

/** 다른 강사 목록 드롭다운 항목들 — 클릭 시 그 강사 뷰로 전환(풀 문서 네비, view-actions 규약). */
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
 * 사이드바 하단 **'강사뷰 전환'** 하나(원장 2026-09-29 *"강사뷰 전환을 내 학생이 있는거랑 없는거랑 전부 통일.
 * 내가 전환 가능한경우 내가 가장 상단에. 이름도 '강사뷰 전환'으로"*). 예전엔 겸직의 '강사뷰로 전환'(본인·쓰기 가능)과
 * '다른 강사 뷰'(열람 전용)가 두 줄로 따로 섰다.
 *  · `canSelf`(canUseTeacherView — 담당 반 또는 오늘 위임) → 맨 위 **나** 항목 = 내 강사뷰(쓰기 가능).
 *  · `canOthers`(canUseOtherTeacherView — master·super_admin·'강사뷰 접근' 토글) → 그 아래 다른 강사(열람 전용).
 * 둘 중 하나라도 있으면 부모가 렌더한다. 각 전환 액션은 서버에서 같은 자격을 다시 판정한다(#77).
 */
export function TeacherViewSwitcher({
  expanded,
  motion,
  selfName,
  canSelf,
  canOthers,
}: {
  expanded: boolean;
  motion: boolean;
  selfName: string;
  canSelf: boolean;
  canOthers: boolean;
}) {
  const { targets, loading, load } = useTeacherTargets();
  const own = useOwnTeacherViewSwitch();
  const btn = (
    <button
      type="button"
      aria-label="강사뷰 전환"
      // 접힘 레일에선 라벨이 안 보인다 — title로 보강(사이드바는 데스크톱 전용이라 title 툴팁이 유효).
      title={expanded ? undefined : "강사뷰 전환"}
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
        강사뷰 전환
      </span>
    </button>
  );
  return (
    <DropdownMenu modal={false} onOpenChange={(open) => open && canOthers && load()}>
      <DropdownMenuTrigger render={btn} />
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="text-text-faint">강사뷰 전환</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {canSelf ? (
          <DropdownMenuItem closeOnClick={false} className="cursor-pointer font-medium" disabled={own.pending} onClick={own.go}>
            <EyIcon name="user" size={16} strokeWidth={1.8} />
            <span className="min-w-0 truncate">{selfName || "나"}</span>
            <span className="text-text-faint ml-auto shrink-0 text-xs">나</span>
          </DropdownMenuItem>
        ) : null}
        {canOthers ? (
          <>
            {canSelf ? <DropdownMenuSeparator /> : null}
            <DropdownMenuLabel className="text-text-faint text-xs">다른 강사 · 열람 전용</DropdownMenuLabel>
            {/* 목록만 스크롤(머리글·나 항목은 고정) — 강사가 많아도 위가 밀려 나가지 않는다. */}
            <div className="max-h-64 overflow-y-auto">
              <TargetItems targets={targets} loading={loading} />
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * '다른 강사 뷰' 열람 중 배지 — 강사 미니셸 헤더에서 **누구의 화면인지**를 항상 보여주고, 누르면 **바로** 관리자뷰로
 * 돌아간다(원장 2026-09-29 *"강사뷰 열람 종료로 변경. 전환 없애고 그냥 버튼 누르면 바로 관리자뷰로"* — 예전엔 드롭다운에서
 * 다른 강사로 갈아타기 + 열람 종료를 골랐다. 갈아타기는 관리자뷰 사이드바 '강사뷰 전환'에서 한다).
 * '내 메뉴'의 '관리자뷰로 전환'도 열람 중엔 세우지 않는다 — 나가는 문은 이 버튼 하나(원장 같은 날).
 * 대상 강사 화면엔 아무것도 안 뜬다(presence track 차단 — 열람 사실은 감사로그에만 남는다).
 */
export function ViewAsChip({ name, lang }: { name: string; lang: SheetLang }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const dest = await switchToAdminView();
          window.location.assign(dest);
        })
      }
      title={sheetT(lang, "chrome.viewAs.endTitle")}
      className={`${TONE_SOFT.special} flex h-7 cursor-pointer items-center gap-1 rounded-full px-2.5 text-xs font-semibold disabled:opacity-60`}
    >
      <EyIcon name="users" size={13} strokeWidth={2} />
      {/* 임포트 계정 등 이름이 빈 강사 — 빈 칩("강사뷰"만)이 되지 않게 폴백.
          폰에선 이름 칸을 좁힌다 — 이 칩이 유일한 출구라 '열람 종료'는 숨기지 않고, 헤더 오른쪽 묶음은 줄어들 여지가 없다. */}
      <span className="max-w-[4.5rem] truncate sm:max-w-[9rem]">
        {name || sheetT(lang, "chrome.viewAs.noName")}
        {sheetT(lang, "chrome.viewAs.suffix").startsWith("'") ? "" : " "}
        {sheetT(lang, "chrome.viewAs.suffix")}
      </span>
      <span className="shrink-0 font-medium opacity-80">· {sheetT(lang, "chrome.viewAs.end")}</span>
      <EyIcon name="logOut" size={12} strokeWidth={2.2} className="shrink-0" />
    </button>
  );
}
