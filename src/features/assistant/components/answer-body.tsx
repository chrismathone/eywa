"use client";

import { Fragment } from "react";
import { WindowLink } from "@/components/workspace/window-link";
import { parseInlineSegments, type AnswerBlock } from "../rich-answer";
import { assistantLinkHref, LINK_KIND_LABEL, type AssistantLink } from "../links";

/**
 * 비서 답변 렌더러 — 표·목록·강조를 **React 엘리먼트로만** 조립한다.
 *
 * 🔴 `dangerouslySetInnerHTML` 금지 — LLM 출력이라 HTML로 넘기면 그대로 XSS 표면이 된다.
 *    파싱은 순수 모듈([rich-answer.ts](src/features/assistant/rich-answer.ts))이 문자열만 다루고,
 *    여기서는 그 결과를 <p>/<ul>/<table>로 옮겨 담기만 한다(텍스트는 항상 자식 노드).
 * 🔴 링크 버튼도 여기서 만들지 않는다 — 서버가 툴 결과에서 수집해 넘겨준 것만 그린다(환각 차단).
 */
export function AnswerBody({
  blocks,
  links,
  omittedLinks = 0,
}: {
  blocks: AnswerBlock[];
  links?: AssistantLink[];
  omittedLinks?: number;
}) {
  return (
    <div className="space-y-2">
      {blocks.map((block, i) => (
        <Fragment key={i}>{renderBlock(block)}</Fragment>
      ))}
      {links && links.length > 0 ? <LinkButtons links={links} omitted={omittedLinks} /> : null}
    </div>
  );
}

function renderBlock(block: AnswerBlock) {
  switch (block.kind) {
    case "heading":
      return <p className="text-foreground font-bold break-keep">{inline(block.text)}</p>;
    case "paragraph":
      return <p className="break-keep">{inline(block.text)}</p>;
    case "list":
      return block.ordered ? (
        <ol className="list-inside list-decimal space-y-0.5">
          {block.items.map((item, i) => (
            <li key={i} className="break-keep">
              {inline(item)}
            </li>
          ))}
        </ol>
      ) : (
        <ul className="space-y-0.5">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-primary/60 mt-[2px] shrink-0 text-xs" aria-hidden="true">
                ●
              </span>
              <span className="min-w-0 break-keep">{inline(item)}</span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return <AnswerTable head={block.head} rows={block.rows} />;
  }
}

function inline(text: string) {
  return parseInlineSegments(text).map((seg, i) =>
    seg.bold ? (
      <strong key={i} className="text-foreground font-bold">
        {seg.text}
      </strong>
    ) : (
      <Fragment key={i}>{seg.text}</Fragment>
    ),
  );
}

/**
 * 표 — 좁은 화면에서 **본문이 가로로 밀리지 않게** 자기 컨테이너 안에서만 스크롤한다.
 * 머리행은 sticky(긴 표를 세로로 훑어도 열 이름이 남는다) + **불투명 배경**([[#74]] — 반투명이면
 * 본문이 비친다). 열 제목 가운데·세로선은 `--line-faint` 한 단계 옅게(표 규약, 2026-08-05).
 */
function AnswerTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="border-line bg-card max-h-80 overflow-auto rounded-xl border">
      <table className="w-full border-collapse text-[12.5px] [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-l-line-faint">
        <thead>
          <tr className="border-line bg-card border-b">
            {head.map((cell, i) => (
              <th
                key={i}
                scope="col"
                className="text-text-dim bg-card sticky top-0 z-10 px-2.5 py-1.5 text-center font-bold whitespace-nowrap"
              >
                {inline(cell)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-line/60 border-b last:border-b-0">
              {row.map((cell, c) => (
                <td key={c} className="px-2.5 py-1.5 align-top break-keep">
                  {inline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 바로가기 버튼 — 창(iframe) 시스템이라 **WindowLink**로 연다. 평범한 이동은 배경 프레임이
 * 움직여 창에 가려 "아무 일도 안 일어난 것처럼" 보인다([[#86]]).
 */
function LinkButtons({ links, omitted }: { links: AssistantLink[]; omitted: number }) {
  return (
    <div className="border-line/70 mt-2.5 flex flex-wrap items-center gap-1.5 border-t pt-2.5">
      {links.map((link) => (
        <WindowLink
          key={`${link.kind}:${link.id}`}
          href={assistantLinkHref(link)}
          title={link.label}
          className="border-line bg-card text-foreground hover:border-primary/40 hover:text-primary rounded-pill inline-flex items-center gap-1 border px-2.5 py-1 text-[12px] font-medium transition"
        >
          <span className="text-text-faint">{LINK_KIND_LABEL[link.kind]}</span>
          <span>{link.label}</span>
        </WindowLink>
      ))}
      {omitted > 0 ? (
        <span className="text-text-faint text-[12px]">외 {omitted}건은 목록에서 확인하세요</span>
      ) : null}
    </div>
  );
}
