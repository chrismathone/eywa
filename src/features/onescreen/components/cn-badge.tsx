"use client";

import { tipProps } from "@/components/hover-tip/tip";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { cnTipCard, type CnMatch } from "../classnote-match";

/**
 * ClassNote 반 보드 매칭 **노트 아이콘**(원장 2026-09-29 — *"c.n이 너무 직관적이지가 않네. 노트 아이콘 하나 만들어서
 * 그걸로 붙이자. 활성화되면 컬러풀, 비활성화시 회색빛"*). 그림 = `public/badges/cnNote.png`(codex 생성 → 아이콘 파이프라인
 * `scripts/_icons/` 후처리 — docs/icon-generation.md와 같은 스티커 화풍). 매칭 = 원래 색 · 실패 = 흑백·옅게(CSS 필터, 그림은 한 장).
 * ⚠️ `public/icons/`에 두지 않는다 — 거긴 메뉴 탭 그림만(가드 `menu-glyph.test.ts`가 쓰이지 않는 그림을 막는다).
 * 마우스를 올리면 반·반 보드·원아·사유 카드(`data-tip` — 문서마다 한 장인 HoverTipLayer가 그린다).
 * 카드 모드(student-list)와 표 모드(grid-row)가 **같은 부품**을 쓴다. 판정은 `cnLabelFor`(classnote-match.ts) — 여기선 그리기만.
 */
export function CnBadge({
  label,
  className,
}: {
  label: { ok: boolean; match: CnMatch | null } | null;
  className?: string | null;
}) {
  const t = useSheetT();
  if (!label) return null;
  const L = {
    title: t("os.cnMatch.title"),
    ok: t("os.cnMatch.ok"),
    fail: t("os.cnMatch.fail"),
    cls: t("os.cnMatch.class"),
    board: t("os.cnMatch.board"),
    child: t("os.cnMatch.child"),
    none: t("os.cnMatch.none"),
  };
  return (
    <span
      {...tipProps(cnTipCard(label, className, L))}
      role="img"
      aria-label={`${L.title} · ${label.ok ? L.ok : L.fail}`}
      className="inline-flex shrink-0 items-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- 18px 정적 스티커(메뉴 탭 그림과 같은 방식) */}
      <img
        src="/badges/cnNote.png"
        alt=""
        width={18}
        height={18}
        draggable={false}
        className={`size-4.5 ${label.ok ? "" : "opacity-45 grayscale"}`}
      />
    </span>
  );
}
