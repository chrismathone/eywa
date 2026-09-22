"use client";

import type { HubDest, HubGroup } from "@/lib/menu-hub";
import { isLayoutHideLocked } from "@/features/owner/menu-layout";
import { SettingsCard } from "./section-form";
import { MenuOrderRow } from "./menu-order-row";

/**
 * '탭 및 메뉴 구성 → 관리자뷰' — 왼쪽 사이드바 · 첫 화면(메뉴) · 휴대폰 상단 메뉴가 그리는 목록(`navigation.menus`).
 * 편집 단위는 **버튼 하나(목적지)** 다 — 수납관리 한 메뉴가 버튼 7개라 메뉴 단위로 끄면 7개가 통째로 사라진다.
 * 상태·저장 페이로드는 부모(navigation-section)가 들고 있다 — 두 면을 오가도 고친 값이 남고, 한 번에 저장된다.
 */
export function AdminMenuEditor({
  groups,
  order,
  hidden,
  destByHref,
  onToggle,
  onMove,
}: {
  groups: readonly HubGroup[];
  order: Readonly<Record<string, string[]>>;
  hidden: ReadonlySet<string>;
  destByHref: ReadonlyMap<string, HubDest>;
  onToggle: (href: string) => void;
  onMove: (groupId: string, index: number, delta: number) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {groups.map((g) => {
        const hrefs = order[g.id] ?? g.items.map((d) => d.href);
        const shown = hrefs.filter((h) => !hidden.has(h)).length;
        return (
          <SettingsCard
            key={g.id}
            title={g.label}
            description={`${hrefs.length}개 중 ${shown}개 표시${g.kind === "direct" ? " · 누르면 바로 열리는 업무군" : ""}`}
          >
            <ul className="space-y-1">
              {hrefs.map((href, i) => {
                const d = destByHref.get(href);
                if (!d) return null; // 코드에서 사라진 목적지(이름이 바뀐 라우트 등) — 조용히 건너뛴다
                const locked = isLayoutHideLocked(href);
                return (
                  <MenuOrderRow
                    key={href}
                    label={d.label}
                    icon={d.icon}
                    on={!hidden.has(href)}
                    locked={locked}
                    first={i === 0}
                    last={i === hrefs.length - 1}
                    onToggle={() => onToggle(href)}
                    onMove={(delta) => onMove(g.id, i, delta)}
                    hints={[
                      // ⚠️ `section`은 **설정처럼 범주로 다시 묶어 그리는 업무군**에만 있다 — 화면에선 범주별로 모여 서므로
                      //    여기 순서만 보고 옮기면 왜 안 옮겨졌는지 모른다.
                      d.section ? `${d.section} 범주 — 화면에선 같은 범주끼리 모여 섭니다` : null,
                      locked
                        ? "항상 표시 — 이 설정으로 돌아올 길이라 감출 수 없습니다"
                        : d.teacherOnly
                          ? "담당 반이 있는 계정에만 표시"
                          : d.tool
                            ? "작은 도구 줄에 표시"
                            : null,
                    ]}
                  />
                );
              })}
            </ul>
          </SettingsCard>
        );
      })}
    </div>
  );
}
