"use client";

import { EyIcon } from "@/components/icons/eywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { HELP_POST_STATUS_LABEL, type HelpBoardList } from "@/features/help/board/types";
import { HELP_BOARD_NOT_READY } from "@/features/help/board/missing";
import { helpAttr } from "@/features/help/help-attr";
import { HelpText } from "./_components/help-text";
import { HelpPostForm } from "./_components/post-form";

type FaqItem = { q: string; a: string };

export function HelpFaq({ items }: { items: FaqItem[] }) {
  if (items.length === 0) {
    return (
      <section className="bg-card shadow-card rounded-2xl p-10 text-center">
        <p className="text-foreground text-sm font-bold">검색 결과가 없습니다</p>
      </section>
    );
  }
  return (
    <section id="help-faq" className="scroll-mt-3" {...helpAttr("help-faq")}>
      <header className="mb-3">
        <p className="micro">FAQ</p>
        <h2 className="text-foreground mt-0.5 text-lg font-bold">자주 묻는 질문</h2>
        <p className="text-text-dim mt-1 text-sm break-keep" {...helpAttr("help-f1")}>
          화면의 버튼 설명은 <strong>F1</strong>을 누르면 그 화면 위에 겹칩니다.
        </p>
      </header>
      <div className="bg-card divide-line shadow-card divide-y rounded-2xl">
        {items.map((item) => (
          <details key={item.q} className="group px-5 py-4">
            <summary className="text-foreground flex cursor-pointer items-center justify-between text-sm font-bold">
              <span className="break-keep">{item.q}</span>
              <EyIcon
                name="plus"
                size={16}
                className="text-text-dim ml-2 shrink-0 transition-transform group-open:rotate-45"
                aria-hidden="true"
              />
            </summary>
            <p className="text-text-dim mt-3 text-xs leading-relaxed break-keep">
              <HelpText text={item.a} />
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function HelpBoard({
  board,
  canAsk,
}: {
  board: HelpBoardList;
  canAsk: boolean;
}) {
  return (
    <section id="help-board" className="scroll-mt-3" {...helpAttr("help-board")}>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="micro">게시판</p>
          <h2 className="text-foreground mt-0.5 text-lg font-bold">질문 게시판</h2>
        </div>
        {canAsk && board.ready ? <HelpPostForm /> : null}
      </header>
      {!board.ready ? (
        <div className="bg-card shadow-card rounded-2xl p-5">
          <p className="text-foreground text-sm font-bold" title={board.error?.raw}>
            {board.error?.summary ?? HELP_BOARD_NOT_READY}
          </p>
          <p className="text-text-dim mt-1 text-xs">자주 묻는 질문은 위에서 볼 수 있습니다.</p>
        </div>
      ) : board.rows.length === 0 ? (
        <p className="bg-card shadow-card rounded-2xl p-5 text-sm">아직 질문이 없습니다.</p>
      ) : (
        <ul className="bg-card shadow-card divide-line divide-y rounded-2xl">
          {board.rows.map((row) => (
            <li key={row.id}>
              <WindowLink
                href={`/help/posts/${row.id}`}
                className="hover:bg-bg-soft/60 flex items-center gap-3 px-4 py-3"
              >
                <span className="text-foreground min-w-0 flex-1 truncate text-sm font-bold">{row.title}</span>
                <span className="text-text-dim shrink-0 text-xs">{HELP_POST_STATUS_LABEL[row.status]}</span>
                <span className="text-text-dim shrink-0 text-xs">{row.authorName}</span>
              </WindowLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
