"use client";

import { useMemo, useState } from "react";

import { EyIcon } from "@/components/icons/aywa-icons";
import { MenuGlyph } from "@/components/icons/menu-glyph";
import { HUB_GROUPS, SUPPORT_GROUPS, type HubDest, type HubGroup } from "@/lib/menu-hub";
import {
  isLayoutHideLocked,
  sortByMenuLayout,
  type MenuLayoutRow,
} from "@/features/owner/menu-layout";
import type { NavigationSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";

/** 편집 대상 = 사이드바·메뉴 판이 실제로 그리는 목록 그대로(권한으로 거르지 않은 원본). */
const ALL_GROUPS: HubGroup[] = [...HUB_GROUPS, ...SUPPORT_GROUPS];

/**
 * 왼쪽 탭(사이드바) 설정 — 원장 2026-09-09: *"설정에서 탭 하나 추가해서 왼쪽 탭 설정이 있으면 좋겠네."*
 *
 * 발단은 바로 앞의 말이다 — *"'신입생 관리' 탭을 만들었는데 찾을 수가 없네. 자동 배정이 안되어있네."*
 * 버튼형 전환(2026-09-07) 뒤로 왼쪽 맨 위엔 메뉴가 한 줄도 없고(업무군 + 방문 횟수 순 '자주 방문한 메뉴'뿐),
 * 새로 만든 탭은 업무군 **안**에 묻힌다. 그 자리를 원장이 직접 정하는 화면이 여기다.
 *
 * 🔴 **권한이 아니다** — 여기서 켜도 권한이 없는 계정에겐 안 보이고, 여기서 꺼도 주소를 치면 열린다.
 *    권한은 '역할·권한' 면이 정한다. 이 구분은 화면 안내 문구에도 그대로 적는다(오해하면 보안 사고가 된다).
 * 🔴 편집 단위는 **버튼 하나(목적지)** 다 — 메뉴가 아니다. 수납관리 한 메뉴가 버튼 7개(수납·교재·지출…)라
 *    메뉴 단위로 끄면 7개가 통째로 사라진다([`menu-layout.ts`](@/features/owner/menu-layout) 참조).
 * ⚠️ **권한으로 거르지 않은 원본 목록**을 보여준다 — 이 설정은 학원(테넌트) 전체에 적용되므로,
 *    지금 이 계정이 못 여는 화면(예: 기본값이 전원 차단인 수업 평가·전자결재)도 정할 수 있어야 한다.
 */
export function NavigationSection({ initial }: { initial: NavigationSettings }) {
  // 감춘 목적지(주소 집합) — 잠긴 목적지는 저장값이 뭐라 하든 여기 안 들어온다(적용 단계와 같은 규약).
  const [hidden, setHidden] = useState<Set<string>>(
    () => new Set(initial.menus.filter((r) => r.hidden && !isLayoutHideLocked(r.href)).map((r) => r.href)),
  );
  // 업무군별 현재 순서(주소 배열). 저장값이 없으면 코드 순서 그대로.
  const [order, setOrder] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      ALL_GROUPS.map((g) => [g.id, sortByMenuLayout(g.items, initial.menus).map((d) => d.href)]),
    ),
  );

  const destByHref = useMemo(() => {
    const m = new Map<string, HubDest>();
    for (const g of ALL_GROUPS) for (const d of g.items) m.set(d.href, d);
    return m;
  }, []);

  /**
   * 저장 페이로드 = **바뀐 줄만**(sparse).
   * 🔑 순서는 "한 줄만 옮겼어도 그 업무군 전체"를 적는다 — 일부만 적으면 나머지가 어디에 끼는지가
   *    코드 순서에 따라 흔들려서, 메뉴가 하나 늘어날 때마다 원장이 정한 순서가 조용히 달라진다.
   *    (반대로 순서를 안 바꾼 업무군은 한 줄도 안 적어서, 새 메뉴가 코드 위치 그대로 선다.)
   */
  const payload = useMemo<NavigationSettings>(() => {
    const menus: MenuLayoutRow[] = [];
    for (const g of ALL_GROUPS) {
      const codeOrder = g.items.map((d) => d.href);
      const cur = order[g.id] ?? codeOrder;
      const reordered = cur.join("|") !== codeOrder.join("|");
      cur.forEach((href, i) => {
        const isHidden = hidden.has(href);
        if (!isHidden && !reordered) return;
        menus.push({
          href,
          ...(isHidden ? { hidden: true } : {}),
          ...(reordered ? { order: i } : {}),
        });
      });
    }
    return { menus };
  }, [hidden, order]);

  function toggle(href: string) {
    if (isLayoutHideLocked(href)) return; // 자기잠금 방지 — 화면·스키마·적용 삼중 방어
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(href)) next.delete(href);
      else next.add(href);
      return next;
    });
  }

  function move(groupId: string, index: number, delta: number) {
    setOrder((prev) => {
      const cur = [...(prev[groupId] ?? [])];
      const to = index + delta;
      if (to < 0 || to >= cur.length) return prev;
      [cur[index], cur[to]] = [cur[to]!, cur[index]!];
      return { ...prev, [groupId]: cur };
    });
  }

  // ⚠️ 저장값엔 **지금 코드에 없는 주소**가 남아 있을 수 있다(라우트가 바뀐 뒤의 옛 저장분).
  //    그런 줄은 저장할 때 어차피 떨어져 나가므로, 세는 것도 지금 있는 목적지만 센다
  //    (안 그러면 "3개를 감추고 있습니다"인데 화면엔 2개만 꺼져 있는 거짓 숫자가 된다).
  const hiddenCount = [...hidden].filter((h) => destByHref.has(h)).length;

  return (
    <SectionForm section="navigation" payload={payload}>
      <div className="bg-card shadow-card rounded-2xl p-5">
        <h3 className="text-foreground text-sm font-bold">왼쪽 탭에 무엇을 보일지 정합니다</h3>
        <p className="text-text-dim mt-1 text-xs leading-relaxed">
          왼쪽 사이드바 · 첫 화면(메뉴) · 휴대폰 상단 메뉴가 <b>같은 목록</b>을 그립니다 — 여기서 끈 항목은
          세 곳 모두에서 사라지고, 순서를 바꾸면 함께 바뀝니다. 학원(테넌트) 전체에 적용됩니다.
          <br />
          <b>이 설정은 권한이 아닙니다.</b> 여기서 켜도 그 메뉴에 권한이 없는 직원에게는 보이지 않고, 여기서 꺼도
          주소를 직접 입력하면 화면은 열립니다. 누가 무엇을 <i>할 수 있는지</i>는 <b>역할·권한</b> 면에서 정합니다.
          <br />
          지금 <span className="num">{hiddenCount}</span>개를 감추고 있습니다. 아무것도 안 건드리면 지금까지와
          똑같이(전부 표시·기본 순서) 동작합니다.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {ALL_GROUPS.map((g) => {
          const hrefs = order[g.id] ?? g.items.map((d) => d.href);
          const shown = hrefs.filter((h) => !hidden.has(h)).length;
          return (
            <SettingsCard
              key={g.id}
              title={g.label}
              description={`${hrefs.length}개 중 ${shown}개 표시${
                g.kind === "direct" ? " · 누르면 바로 열리는 업무군" : ""
              }`}
            >
              <ul className="space-y-1">
                {hrefs.map((href, i) => {
                  const d = destByHref.get(href);
                  if (!d) return null; // 코드에서 사라진 목적지(이름이 바뀐 라우트 등) — 조용히 건너뛴다
                  const locked = isLayoutHideLocked(href);
                  const on = !hidden.has(href);
                  return (
                    <li
                      key={href}
                      className="border-line flex items-center gap-2 rounded-lg border px-2 py-1.5"
                    >
                      <input
                        type="checkbox"
                        checked={on || locked}
                        disabled={locked}
                        onChange={() => toggle(href)}
                        aria-label={`${d.label} 표시`}
                        className="border-line accent-primary size-4 shrink-0 rounded disabled:opacity-50"
                      />
                      <MenuGlyph name={d.icon} size={18} className="shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-xs font-bold ${
                            on || locked ? "text-foreground" : "text-text-faint line-through"
                          }`}
                        >
                          {d.label}
                        </span>
                        {/* 안 보이면 왜 그런지 한 줄로 — 체크를 껐는데 여전히 안 보이면 권한 때문이다.
                            ⚠️ `section`은 **설정처럼 범주로 다시 묶어 그리는 업무군**에만 있다. 그 업무군은
                               화면에서 범주별로 모여 서므로, 여기 순서만 보고 옮기면 왜 안 옮겨졌는지 모른다. */}
                        {d.section ? (
                          <span className="text-text-faint block text-xs">
                            {d.section} 범주 — 화면에선 같은 범주끼리 모여 섭니다
                          </span>
                        ) : null}
                        {locked ? (
                          <span className="text-text-faint block text-xs">
                            항상 표시 — 이 설정으로 돌아올 길이라 감출 수 없습니다
                          </span>
                        ) : d.teacherOnly ? (
                          <span className="text-text-faint block text-xs">담당 반이 있는 계정에만 표시</span>
                        ) : d.tool ? (
                          <span className="text-text-faint block text-xs">작은 도구 줄에 표시</span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-0.5">
                        <OrderButton
                          label={`${d.label} 위로`}
                          disabled={i === 0}
                          onClick={() => move(g.id, i, -1)}
                          icon="arrowUp"
                        />
                        <OrderButton
                          label={`${d.label} 아래로`}
                          disabled={i === hrefs.length - 1}
                          onClick={() => move(g.id, i, 1)}
                          icon="arrowDown"
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </SettingsCard>
          );
        })}
      </div>
    </SectionForm>
  );
}

/** 순서 이동 버튼 — 조작 자리라 선화(EyIcon). 문자 화살표(▲▼)는 글리프 가드가 막는다. */
function OrderButton({
  label,
  disabled,
  onClick,
  icon,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  icon: "arrowUp" | "arrowDown";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="text-text-faint hover:text-foreground hover:bg-bg-soft rounded p-1 disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <EyIcon name={icon} size={14} />
    </button>
  );
}
