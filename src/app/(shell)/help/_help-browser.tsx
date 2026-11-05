"use client";

import { EyIcon, MENU_ICON } from "@/components/icons/aywa-icons";
import { WindowLink } from "@/components/workspace/window-link";
import { HELP_POST_STATUS_LABEL, type HelpBoardList } from "@/features/help/board/types";
import { HELP_BOARD_NOT_READY } from "@/features/help/board/missing";
import { helpAttr } from "@/features/help/help-attr";
import type { HelpGroup, HelpManual } from "@/features/help/types";
import { HelpText } from "./_components/help-text";
import { OpenScreenArrow } from "./_components/open-screen";
import { HelpPostForm } from "./_components/post-form";
import { writeLockedNote } from "@/lib/write-lock";

type FaqItem = { q: string; a: string };

const GROUP_ORDER: HelpGroup[] = ["창", "홈", "수업", "원생", "운영", "지원"];

/**
 * 화면별 설명서 목록 — 원장 2026-09-15 *"현재 도움말 탭을 고도화하는게 좋을듯"*(설명서 목록 + Q&A + 게시판).
 *
 * 🔴 F1 겹침이 생겼다고 이 목록을 걷지 말 것 — 둘은 **다른 자리**다. F1은 그 화면을 보고 있을 때의 도움말이고,
 * 이 목록은 **화면을 열기 전에** 훑어보는 목차다(키보드 없는 기기에서 F1이 없는 것과도 무관하게).
 * 09-15에 한 번 걷었다가 같은 날 되살렸다.
 */
export function HelpManuals({ manuals }: { manuals: HelpManual[] }) {
  if (manuals.length === 0) return null;
  return (
    <section id="help-guides" className="scroll-mt-3" {...helpAttr("help-guides")}>
      <header className="mb-3">
        <p className="micro">{manuals.length}개 화면</p>
        <h2 className="text-foreground mt-0.5 text-lg font-bold">화면 설명서 — 버튼마다 번호</h2>
        <p className="text-text-dim mt-1 text-sm break-keep">
          제목을 누르면 그 화면의 번호 설명서입니다. 글 속의 <HelpText text="시간표" /> 같은 말은 다른 설명서로
          바로 갑니다. ↗는 실제 화면 창입니다. 화면을 보는 중이라면 <strong>F1</strong>이 같은 설명을 그 위에 겹칩니다.
        </p>
      </header>
      <div className="space-y-4">
        {/* 🔴 `GROUP_ORDER`에 없는 업무군이 생기면 그 설명서가 **조용히 안 그려진다**(머리글의 개수만 남아
            화면에 보이는 수와 적힌 수가 어긋난다 — 에러 0). 순서를 모르는 그룹은 맨 뒤에라도 세운다. */}
        {[...GROUP_ORDER, ...new Set(manuals.map((m) => m.group).filter((g) => !GROUP_ORDER.includes(g)))].map((group) => {
          const items = manuals.filter((m) => m.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              <h3 className="text-text-dim mb-1 px-1 text-xs font-bold">{group}</h3>
              <div className="bg-card shadow-card grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-1 rounded-2xl p-2">
                {items.map((m) => (
                  <div key={m.slug} className="hover:bg-bg-soft/60 flex items-start gap-2.5 rounded-lg px-3 py-2.5">
                    <span className="bg-primary-soft text-primary inline-flex size-7 shrink-0 items-center justify-center rounded-md">
                      <EyIcon name={m.menuKey ? MENU_ICON[m.menuKey] : "help"} size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-1">
                        <h4 className="text-foreground min-w-0 text-sm font-bold break-keep">
                          <WindowLink href={`/help/${m.slug}`} className="hover:text-primary hover:underline">
                            {m.title}
                          </WindowLink>
                        </h4>
                        {m.href !== "/help" ? <OpenScreenArrow href={m.href} label={m.title} /> : null}
                      </div>
                      <p className="text-text-dim mt-1 text-xs leading-relaxed break-keep">
                        <HelpText text={m.summary} />
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function HelpFaq({ items }: { items: FaqItem[] }) {
  // 🔴 여기서 "검색 결과가 없습니다"를 그리지 말 것 — 설명서·게시판이 걸렸는데 Q&A만 0건이면
  // 결과가 있는 화면에 "없습니다" 카드가 함께 선다. 빈 결과 안내는 page.tsx가 셋을 함께 보고 한 번만 그린다.
  if (items.length === 0) return null;
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
  query = "",
}: {
  board: HelpBoardList;
  canAsk: boolean;
  /** 검색 중인 말 — 빈 목록의 문장이 "질문이 없다"와 "이 검색어에 안 걸렸다"로 갈린다. */
  query?: string;
}) {
  return (
    <section id="help-board" className="scroll-mt-3" {...helpAttr("help-board")}>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="micro">게시판</p>
          <h2 className="text-foreground mt-0.5 text-lg font-bold">질문 게시판</h2>
        </div>
        {/* '질문하기'는 도움말 쓰기 권한(canAskHelpBoard — 작성 액션과 같은 함수)일 때만. 읽기 권한이면 단추 대신 안내 한 줄. */}
        {canAsk && board.ready ? <HelpPostForm /> : board.ready ? <p className="text-text-faint text-xs">{writeLockedNote("help")}</p> : null}
      </header>
      {!board.ready ? (
        <div className="bg-card shadow-card rounded-2xl p-5">
          <p className="text-foreground text-sm font-bold" title={board.error?.raw}>
            {board.error?.summary ?? HELP_BOARD_NOT_READY}
          </p>
          <p className="text-text-dim mt-1 text-xs">자주 묻는 질문은 위에서 볼 수 있습니다.</p>
        </div>
      ) : board.rows.length === 0 ? (
        // 🔴 검색 중이면 "질문이 없다"는 **거짓**이다 — 질문은 있고 이 말에 안 걸렸을 뿐이다.
        <p className="bg-card shadow-card rounded-2xl p-5 text-sm">
          {query ? `‘${query}’에 걸리는 질문이 없습니다.` : "아직 질문이 없습니다."}
        </p>
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
