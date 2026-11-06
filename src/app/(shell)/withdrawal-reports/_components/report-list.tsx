import { Fragment } from "react";
import { EmbedLink as Link } from "@/components/embed-link";
import { WindowLink } from "@/components/workspace/window-link";
import { tipProps } from "@/components/hover-tip/tip";
import { reportProgress, type ListItem, type ProgressCell, type ProgressNote } from "@/features/withdrawal-reports/list-items";
import { CancelNote } from "./cancel-note";

const LINK_TEXT = {
  auto: { text: "자동 연결", cls: "text-att-present-ink" },
  manual: { text: "직접 연결", cls: "text-att-present-ink" },
} as const;
/** 막대 칸 — 끝남 = primary 채움 · 지금 = primary 빗금 · 반려·재검토 = 빨강 · 아직 = 회색 · 요청 취소 = 옅은 회색(원장 2026-11-06 시안 A). */
const CELL: Record<ProgressCell, string> = {
  done: "bg-primary",
  now: "bg-[image:repeating-linear-gradient(-45deg,var(--primary)_0_4px,color-mix(in_srgb,var(--primary)_45%,transparent)_4px_8px)]",
  alert: "bg-destructive",
  todo: "bg-line",
  off: "bg-muted",
};
/** 단계 이름 — 지금은 굵게 · 끝남은 진한 글자 · 아직은 흐린 글자 · 요청 취소는 흐리게 + 취소선. */
const NAME: Record<ProgressCell, string> = {
  done: "",
  now: "text-primary font-bold",
  alert: "text-destructive font-bold",
  todo: "text-foreground/50",
  off: "text-text-placeholder line-through",
};
const NOTE: Record<ProgressNote["tone"], string> = {
  plain: "",
  alert: "text-destructive font-semibold",
  done: "text-att-present-ink font-semibold",
};

/** 내 할 일 꼬리 링크 — primary 굵게 · 손가락·밑줄 · 키보드 초점 밑줄 · 한 덩어리(두 줄로 쪼개지지 않게). */
const TAIL_LINK = "text-primary font-bold whitespace-nowrap hover:underline focus-visible:underline";
/** 조각 사이 '·' — 앞은 붙는 공백(nbsp)이라 줄은 '·' 뒤에서만 끊기고 '·'는 앞 줄 끝에 남는다. */
const SEP = "\u00a0· ";
/** ' · '로 이은 글(예: '수강 변경 · 재검토 필요 — 취소 후 다시 요청')을 조각마다 줄바꿈 없이 — 접힐 땐 '·' 뒤에서. */
function Pieces({ text }: { text: string }) {
  return text.split(" · ").map((piece, i) => (
    <Fragment key={i}>
      {i > 0 && SEP}
      <span className="whitespace-nowrap">{piece}</span>
    </Fragment>
  ));
}

/**
 * 상태 칸 — 웹 보고서는 3단계 막대 + 단계 이름 + 아래 한 줄([추가 정보, 꼬리]), 기존 기록은 '스프레드시트 기록'과 학생 연결.
 * 판정은 전부 `reportProgress` — 여기선 그리기만 한다.
 */
function StatusCell({ item }: { item: ListItem }) {
  const p = reportProgress(item);
  if (!p) {
    return (
      <>
        <span className="bg-muted inline-block rounded-full px-2.5 py-1 text-xs">{item.statusLabel}</span>
        {/* 미연결은 표시하지 않는다(원장 2026-10-30 "지난 기록이라") — 연결은 기록 상세에서 할 수 있다. */}
        {item.link && item.link !== "unmapped" && <div className={`mt-1 text-xs ${LINK_TEXT[item.link].cls}`}>{LINK_TEXT[item.link].text}</div>}
      </>
    );
  }
  const parts = [...p.notes.map((note) => ({ note })), ...(p.tail ? [{ tail: p.tail }] : [])];
  // 칸 폭 = 막대 폭(w-64) — 아래 한 줄도 이 폭 안에서 '·' 뒤로만 접힌다(긴 재검토 글이 상태 칸을 넓히지 않게 · 리뷰 2026-11-06).
  return (
    <div className="w-64">
      <div role="img" aria-label={p.label} className="grid grid-cols-3 gap-1">
        {p.cells.map((cell, i) => (
          <span key={i} data-cell={cell} className={`h-1.5 rounded-full ${CELL[cell]}`} />
        ))}
      </div>
      {/* 단계 이름은 막대 이름(aria-label)과 같은 말이라 읽기 도구엔 숨긴다 — 눈으로는 굵기·색과 글이 함께 뜻을 나른다. */}
      <div aria-hidden className="mt-1 grid grid-cols-3 gap-1 text-center text-xs whitespace-nowrap">
        {p.names.map((name) => (
          <span key={name.text} data-state={name.state} className={NAME[name.state]}>
            {name.text}
          </span>
        ))}
      </div>
      {parts.length > 0 && (
        <div data-line className="mt-1.5 text-xs break-keep">
          {parts.map((part, i) => (
            <Fragment key={i}>
              {i > 0 && SEP}
              {"note" in part ? (
                <span data-note={part.note.tone} className={NOTE[part.note.tone]}>
                  {part.note.cancel ? (
                    <CancelNote {...part.note.cancel}>
                      <Pieces text={part.note.text} />
                    </CancelNote>
                  ) : (
                    <Pieces text={part.note.text} />
                  )}
                </span>
              ) : part.tail.href && part.tail.newWindow ? (
                // 환불 요청서는 수납 메뉴 화면이라 새 창으로(보고서 상세의 '요청서' 링크와 같은 방식).
                <WindowLink href={part.tail.href} title="환불 요청서" className={TAIL_LINK}>
                  {part.tail.text}
                </WindowLink>
              ) : part.tail.href ? (
                <Link className={TAIL_LINK} href={part.tail.href}>
                  {part.tail.text}
                </Link>
              ) : (
                <span className="whitespace-nowrap">{part.tail.text}</span>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 퇴원보고서 목록 표 — 웹 보고서와 기존 스프레드시트 기록이 한 표에 선다([`buildListItems`]).
 * 거르기·쪽 나누기는 화면(page.tsx)이 주소 값으로 끝내고 여기엔 보일 줄만 온다.
 */
export function ReportList({ items }: { items: ListItem[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted/50">
          <tr>
            {/* 원장 2026-11-03 — '요청일' → '퇴원요청일', '퇴원·종료일' → '마지막 수업일'(같은 값의 다른 화면 이름도 함께). */}
            {["과목", "학생", "학교학년", "구분", "퇴원요청일", "마지막 수업일", "퇴원 사유", "작성 강사", "승인 진행", "상태"].map((label) => (
              <th key={label} className="px-4 py-3 font-medium whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.key} className="hover:bg-muted/20 border-t">
              {/* 과목 / 학생 / 학교학년 / 구분 — 한 칸에 몰았던 것을 나눴다(원장 2026-10-30). */}
              <td className="px-4 py-4 whitespace-nowrap">{r.subjectText}</td>
              <td className="px-4 py-4 whitespace-nowrap">
                <Link className="text-primary font-semibold hover:underline" href={r.href}>
                  {r.name}
                </Link>
                {r.classText && <div className="text-muted-foreground mt-1 text-xs">{r.classText}</div>}
              </td>
              <td className="text-muted-foreground px-4 py-4 whitespace-nowrap">{r.schoolGrade || "—"}</td>
              <td className={`px-4 py-4 whitespace-nowrap ${r.kindText === "—" ? "text-muted-foreground" : ""}`}>{r.kindText}</td>
              <td className="text-muted-foreground px-4 py-4 whitespace-nowrap">{r.requestedText}</td>
              <td className="px-4 py-4 whitespace-nowrap">{r.dateText}</td>
              {/* 사유 = 우리 사유 · 맞는 것이 없으면 '기타' + 아래 설명(원장 2026-10-16) — 설명은 두 줄까지, 전체는 메모 카드(`data-tip`). */}
              <td className="px-4 py-4">
                <div className={`max-w-xs ${r.reason.muted ? "text-muted-foreground" : ""}`}>{r.reason.text}</div>
                {r.reason.note && (
                  <div className="text-muted-foreground mt-1 line-clamp-2 max-w-xs text-xs" {...tipProps(r.reason.note)}>
                    {r.reason.note}
                  </div>
                )}
              </td>
              <td className="px-4 py-4 whitespace-nowrap">{r.teacher}</td>
              <td className="px-4 py-4 text-xs">
                {r.approval.map((a, i) => (
                  <div key={i} className={`${i ? "mt-1" : ""} ${a.muted ? "text-muted-foreground" : ""}`}>
                    {a.text}
                  </div>
                ))}
              </td>
              <td className="px-4 py-4">
                {/* 상태 칸 — 칩·버튼 없이 3단계 막대 + 아래 한 줄(원장 2026-11-06 시안 A · 내 할 일은 그 줄 끝의 링크). */}
                <StatusCell item={r} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="text-muted-foreground p-10 text-center text-sm">해당하는 퇴원보고서가 없습니다.</p>}
    </div>
  );
}
