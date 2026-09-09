import { WindowLink } from "@/components/workspace/window-link";
import { PanelEmpty } from "./tiles";
import type { TodayActionItem } from "@/features/dashboard/today-actions";
import type { WatchItem } from "@/features/dashboard/onescreen/watchlist";

/**
 * 한 화면 대시보드의 **본문 세 칸** — 오늘 할 일 / 살펴볼 학생 / 브리핑·공지.
 *
 * 🔴 **안쪽 스크롤을 만들지 않는다**(설계서 §4) — 줄 수를 서버가 이미 잘라 넘기고, 잘린 나머지는
 *    "외 N"으로 **사실만 적은 뒤** 원본 화면에 맡긴다.
 * 🔴 **0건과 조회 실패를 같은 말로 적지 않는다**(§8-4) — 0건은 "없습니다", 실패는 "불러오지 못했습니다".
 */

const TONE_BAR: Record<string, string> = {
  danger: "bg-danger",
  critical: "bg-danger",
  amber: "bg-amber",
  caution: "bg-amber",
  info: "bg-blue",
  inert: "bg-line-strong",
};

/** 목록 한 줄 — 왼쪽 2px 톤 막대 + 본문 + (선택) 오른쪽 수치. */
function Row({
  tone,
  href,
  title,
  left,
  right,
}: {
  tone: string;
  href?: string;
  title?: string;
  left: React.ReactNode;
  right?: React.ReactNode;
}) {
  const body = (
    <span className="flex min-w-0 items-center gap-2 py-[3px]">
      <span aria-hidden className={`h-3.5 w-[2px] shrink-0 rounded-full ${TONE_BAR[tone] ?? TONE_BAR.inert}`} />
      <span className="min-w-0 flex-1 truncate text-xs">{left}</span>
      {right ? <span className="num text-text-dim shrink-0 text-xs font-bold">{right}</span> : null}
    </span>
  );
  if (!href) return <li title={title}>{body}</li>;
  return (
    <li>
      <WindowLink href={href} title={title} className="hover:bg-bg-soft/60 -mx-1 block rounded px-1">
        {body}
      </WindowLink>
    </li>
  );
}

/**
 * 오늘 할 일 — 결정론 신호를 급한 순으로. 🔴 **권한을 통과한 것만** 넘어온다(페이지가 이미 걸렀다):
 * 못 여는 화면 링크를 그리면 눌러도 튕기는 죽은 줄이 된다([[#77]]).
 */
export function TodoList({ items, max = 10 }: { items: TodayActionItem[]; max?: number }) {
  if (items.length === 0) return <PanelEmpty>지금 처리할 일이 없습니다</PanelEmpty>;
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  return (
    <>
      <ul className="min-w-0">
        {shown.map((item) => (
          <Row
            key={item.key}
            tone={item.severity}
            href={item.href}
            // 🔴 숫자를 해석할 범위(`note`)는 툴팁에 남긴다 — 한 줄에 다 적으면 목록이 못 읽는 물건이 된다.
            title={[item.label, item.note].filter(Boolean).join(" · ")}
            left={item.label}
            right={item.count === null ? null : `${item.count}${item.unit ?? ""}`}
          />
        ))}
      </ul>
      {rest > 0 ? <p className="text-text-faint mt-1 text-xs">외 {rest}건</p> : null}
    </>
  );
}

/**
 * 살펴볼 학생 — 결석 위험 ∪ 상담 후속(합치는 규칙은 `onescreen/watchlist`).
 * 🔴 결석 **사유 원문은 안 올린다** — 그 값엔 병원·가정사가 그대로 적혀 있다.
 */
export function Watchlist({ items, overflow }: { items: WatchItem[]; overflow: number }) {
  if (items.length === 0) return <PanelEmpty>지금 살펴볼 학생이 없습니다</PanelEmpty>;
  return (
    <>
      <ul className="min-w-0">
        {items.map((item) => (
          <Row
            key={item.key}
            tone={item.tone}
            href={`/students/${item.studentId}`}
            title={`${item.studentName} — ${item.reason}`}
            left={
              <>
                <span className="text-foreground font-bold">{item.studentName}</span>
                <span className="text-text-dim ml-1.5">{item.reason}</span>
              </>
            }
          />
        ))}
      </ul>
      {/* 🔴 잘렸다는 사실을 숨기지 않는다 — 목록 길이를 건수로 쓰면 영원히 같은 숫자다([[#89]]). */}
      {overflow > 0 ? <p className="text-text-faint mt-1 text-xs">외 {overflow}명</p> : null}
    </>
  );
}

/**
 * 브리핑 · 공지 — 숫자 옆의 **서술**이다(히어로가 아니다, 설계서 §4).
 * 🔴 새 AI 호출은 **0**이다 — 저장된 판만 읽는다. 넘치면 원본 창에서 전문을 본다.
 */
export function BriefingNote({
  summary,
  tone,
  announcements,
}: {
  summary: string;
  tone: "normal" | "danger";
  /** 최근 공지 몇 줄 — 한 화면에서 밀려난 공지 카드를 여기 한 줄씩만 남긴다. */
  announcements: { id: string; title: string }[];
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 넘치면 접고 전문은 마우스 오버 — 🔴 '전문 보기' 링크를 달지 않는다(브리핑 전용 라우트가 없다.
          없는 주소를 가리키면 눌러도 아무 일도 안 일어나는 죽은 링크가 된다). */}
      <p
        title={summary}
        className={`line-clamp-4 text-xs leading-relaxed break-keep ${tone === "danger" ? "text-danger" : "text-text-dim"}`}
      >
        {summary}
      </p>
      {announcements.length > 0 ? (
        <div className="border-line-faint min-w-0 border-t pt-1.5">
          <p className="text-text-faint mb-0.5 text-xs font-bold">공지</p>
          <ul className="min-w-0">
            {announcements.slice(0, 3).map((a) => (
              <li key={a.id} className="text-text-dim truncate text-xs" title={a.title}>
                {a.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 미납 상위 — **좁은 권한(수납만)일 때만** 서는 칸이다(설계서 §7). 전권한 화면에선 수납 타일 하나로
 * 충분하고 본문 세 칸이 이미 꽉 찬다.
 */
export function OutstandingList({
  rows,
}: {
  rows: { studentId: string; studentName: string; amount: number }[];
}) {
  if (rows.length === 0) return <PanelEmpty>미납이 없습니다</PanelEmpty>;
  return (
    <ul className="min-w-0">
      {rows.slice(0, 10).map((r) => (
        <Row
          key={r.studentId}
          tone="danger"
          href={`/students/${r.studentId}`}
          left={<span className="text-foreground font-bold">{r.studentName}</span>}
          right={`${Math.round(r.amount / 10_000)}만`}
        />
      ))}
    </ul>
  );
}
