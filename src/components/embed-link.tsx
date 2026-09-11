"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { useEmbed, withEmbed } from "@/components/workspace/embed-context";
import { useInFrame } from "@/components/workspace/use-in-frame";

/**
 * 창(iframe) 안에서도 **embed=1을 잃지 않는 `<Link>`** — 서버 컴포넌트가 그리는 같은 창 안 링크용(훅을 못 쓰는 자리).
 *
 * FaceTabs·TabLink와 같은 규칙: 창 안(`useEmbed`)이면 href에 `withEmbed`. 소프트 이동은 셸 레이아웃을 다시 그리지
 * 않아 **당장은 멀쩡하지만**, 주소에서 embed가 빠진 채 `router.refresh()`·서버 액션 재검증이 돌면 공유 레이아웃을
 * embed 없는 주소로 다시 받아 **창 안에 전체 셸**이 뜬다(메뉴·창 이동 전수검사 2026-09-11 `$[6].findings[2]`).
 * ⚠️ 다른 메뉴를 **새 창으로** 여는 건 `WindowLink` 몫이다 — 이건 같은 창 안에서 옮겨 가는 링크용.
 * ⚠️ href는 문자열만 받는다(`withEmbed`가 문자열을 다룬다).
 */
export function EmbedLink({ href, ...rest }: Omit<ComponentProps<typeof Link>, "href"> & { href: string }) {
  const embed = useEmbed();
  return <Link {...rest} href={embed ? withEmbed(href) : href} />;
}

/**
 * 창 안 **하드 이동** `<a>` — 문서를 통째로 다시 여는 링크가 embed=1을 잃지 않게(원생 삭제와 같은 규칙: 물리 프레임이면
 * `withEmbed`). 하드 이동을 지켜야 하는 자리(비제어 입력을 비워야 하는 필터 칩 등)에 쓰고, 그 외엔 `EmbedLink`(소프트).
 * 🔴 창 주소 되붙이기(`EmbedUrlKeeper`)로는 못 덮는다 — 하드 이동은 **새 문서**를 열고, 그 주소는 링크 href가 정한다.
 *    서버가 요청의 embed로 href를 짓는 화면은 embed 없이 들어온 첫 렌더에서 빠지므로 여기서 **클라가** 판정한다.
 */
export function EmbedAnchor({ href, ...rest }: Omit<ComponentProps<"a">, "href"> & { href: string }) {
  const inFrame = useInFrame();
  return <a {...rest} href={inFrame ? withEmbed(href) : href} />;
}

/**
 * 창 안 GET 폼의 embed 동행 — 제출은 새 문서를 연다. 서버가 요청 헤더·주소로 판정하면 embed 없이 들어온 첫 렌더에서
 * 빠지므로(`EmbedAnchor`와 같은 이유) 클라가 물리 프레임으로 판정한다.
 */
export function EmbedHiddenInput() {
  const inFrame = useInFrame();
  return inFrame ? <input type="hidden" name="embed" value="1" /> : null;
}
