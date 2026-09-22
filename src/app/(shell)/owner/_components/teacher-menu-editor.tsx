"use client";

import { sheetT } from "@/features/teacher-view/i18n";
import type { TeacherMenuLink } from "@/lib/teacher-menu-links";
import type { MenuKey } from "@/lib/permissions";
import { SettingsCard } from "./section-form";
import { MenuOrderRow } from "./menu-order-row";

/**
 * '탭 및 메뉴 구성 → 강사뷰' — 강사 화면 오른쪽 위 **'내 메뉴'** 목록(`navigation.teacherMenus`, 원장 2026-09-22).
 * 이름은 선생님 화면에 실제로 뜨는 글자(사전의 한국어)를 그대로 보인다 — 관리자뷰 이름(원생목록 등)과 다를 수 있다.
 *
 * 🔴 권한이 아니다 — 여기서 켜도 강사 권한이 없으면 안 보이고(안내 줄로 알린다), 꺼도 주소를 치면 열린다.
 * 🔴 각 선생님의 **홈**(영어 전담 = 영어 강사 시트, 그 외 = 원스크린)은 그 선생님 메뉴에서 늘 맨 위이고 꺼도 남는다
 *    (`applyTeacherMenuLayout`) — 설정이 학원 전체에 한 벌이라 선생님마다 다른 홈을 여기서 표현할 수 없다.
 */
export function TeacherMenuEditor({
  links,
  order,
  hidden,
  teacherOpen,
  onToggle,
  onMove,
}: {
  /** 편집 대상(입구 정책으로 거른 항목 표 — 메뉴에서 뺀 캘린더 등은 없다). */
  links: readonly TeacherMenuLink[];
  order: readonly string[];
  hidden: ReadonlySet<string>;
  /** 지금 강사 역할로 열리는 메뉴 키 — 없으면 "권한이 꺼져 있어 안 보인다"를 알린다. */
  teacherOpen: readonly MenuKey[];
  onToggle: (href: string) => void;
  onMove: (index: number, delta: number) => void;
}) {
  const byHref = new Map(links.map((l) => [l.href, l]));
  const shown = order.filter((h) => byHref.has(h) && !hidden.has(h)).length;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <SettingsCard title="강사 '내 메뉴'" description={`${order.filter((h) => byHref.has(h)).length}개 중 ${shown}개 표시`}>
        <ul className="space-y-1">
          {order.map((href, i) => {
            const l = byHref.get(href);
            if (!l) return null; // 코드에서 사라진 항목(옛 저장분) — 조용히 건너뛴다
            return (
              <MenuOrderRow
                key={href}
                label={sheetT("ko", l.labelKey)}
                icon={l.icon}
                on={!hidden.has(href)}
                first={i === 0}
                last={i === order.length - 1}
                onToggle={() => onToggle(href)}
                onMove={(delta) => onMove(i, delta)}
                hints={[
                  l.menu === "teacher_onescreen" ? "영어 전담이 아닌 선생님의 홈 — 그 선생님에겐 늘 맨 위, 꺼도 남습니다" : null,
                  l.menu === "ecs" ? "영어 반 담당·부담임에게만 표시 · 영어 전담 선생님의 홈(늘 맨 위, 꺼도 남습니다)" : null,
                  l.menu === "mcs" ? "수학 반 담당에게만 표시" : null,
                  teacherOpen.includes(l.menu) ? null : "강사 권한이 꺼져 있어 지금은 안 보입니다 — 역할·권한 면에서 엽니다",
                ]}
              />
            );
          })}
        </ul>
      </SettingsCard>
    </div>
  );
}
