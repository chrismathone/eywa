"use client";

import { tipProps } from "@/components/hover-tip/tip";
import { TONE_TEXT } from "@/lib/design/semantic-color";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { cnLabelState, cnTipCard, type CnLabel } from "../classnote-match";

/**
 * ClassNote 반 보드 매칭 **노트 아이콘**(원장 2026-09-29 — *"c.n이 너무 직관적이지가 않네. 노트 아이콘 하나 만들어서
 * 그걸로 붙이자. 활성화되면 컬러풀, 비활성화시 회색빛"*). 그림 = `public/badges/cnNote.png`(codex 생성 → 아이콘 파이프라인
 * `scripts/_icons/` 후처리 — docs/icon-generation.md와 같은 스티커 화풍). 매칭 = 원래 색 · 실패 = 흑백·옅게(CSS 필터, 그림은 한 장).
 * ⚠️ `public/icons/`에 두지 않는다 — 거긴 메뉴 탭 그림만(가드 `menu-glyph.test.ts`가 쓰이지 않는 그림을 막는다).
 * 마우스를 올리면 반·반 보드·원아·사유 카드(`data-tip` — 문서마다 한 장인 HoverTipLayer가 그린다).
 * 카드 모드(student-list)와 표 모드(grid-row)가 **같은 부품**을 쓴다. 판정은 `cnLabelFor`(classnote-match.ts) — 여기선 그리기만.
 *
 * 그림은 셋이다(원장 2026-10-06 *"활성화는 체크, 반배정 오류는 ? …"*):
 *  · 체크(원래 색 노트 그림) = 이 반 보드에 배정이 확인됐다.
 *  · **물음표 하나** = ClassNote 연결은 돼 있는데 반 배정이 지금 반과 다르다(그날 안 다니는 반 보드에 있거나, 원아는 찾았는데
 *    이 반 배정이 보류). 원장 2026-11-04 *"? 아이콘이 배경없애고 그냥 ? 만 선명하게 새로 만들것"* — 노트 그림 위 작은 주황 원은
 *    18px에서 안 읽혔다. 그림도 원 배경도 없이 주의 색(caution) 굵은 글자 하나다(글자 글리프 — 인라인 SVG 금지 가드).
 *  · 회색 노트 그림 = 연결 자체가 확인되지 않았다(종전 그대로).
 */
export function CnBadge({
  label,
  className,
}: {
  label: CnLabel | null;
  className?: string | null;
}) {
  const t = useSheetT();
  if (!label) return null;
  const state = cnLabelState(label);
  const L = {
    title: t("os.cnMatch.title"),
    ok: t("os.cnMatch.ok"),
    fail: t("os.cnMatch.fail"),
    cls: t("os.cnMatch.class"),
    board: t("os.cnMatch.board"),
    child: t("os.cnMatch.child"),
    none: t("os.cnMatch.none"),
    mismatch: t("os.cnMatch.mismatch"),
    elsewhere: t("os.cnMatch.elsewhere"),
  };
  const stateText = state === "ok" ? L.ok : state === "mismatch" ? L.mismatch : L.fail;
  return (
    <span
      {...tipProps(cnTipCard(label, className, L))}
      role="img"
      aria-label={`${L.title} · ${stateText}`}
      data-cn-state={state}
      className="inline-flex size-4.5 shrink-0 items-center justify-center"
    >
      {state === "mismatch" ? (
        // 뜻은 바깥 이름표가 읽어 준다 — 글자는 꾸밈(aria-hidden). 18px 상자에 맞춘 굵은 물음표.
        <span aria-hidden data-cn-glyph="" className={`${TONE_TEXT.caution} text-base leading-none font-black`}>
          ?
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 18px 정적 스티커(메뉴 탭 그림과 같은 방식)
        <img
          src="/badges/cnNote.png"
          alt=""
          width={18}
          height={18}
          draggable={false}
          className={`size-4.5 ${state === "none" ? "opacity-45 grayscale" : ""}`}
        />
      )}
    </span>
  );
}
