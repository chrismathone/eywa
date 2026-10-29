import { EmbedLink as Link } from "@/components/embed-link";
import { tipProps } from "@/components/hover-tip/tip";
import type { ListItem } from "@/features/withdrawal-reports/list-items";

const TONE: Record<ListItem["tone"], string> = {
  done: "bg-att-present text-att-present-ink",
  alert: "bg-destructive/10 text-destructive",
  muted: "bg-muted",
};
const LINK_TEXT = {
  auto: { text: "자동 연결", cls: "text-att-present-ink" },
  manual: { text: "직접 연결", cls: "text-att-present-ink" },
  unmapped: { text: "학생 연결 필요", cls: "text-att-late-ink" },
} as const;

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
            {["학생·처리 구분", "요청일", "퇴원·종료일", "퇴원 사유", "작성 강사", "승인 진행", "상태"].map((label) => (
              <th key={label} className="px-4 py-3 font-medium whitespace-nowrap">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.key} className="hover:bg-muted/20 border-t">
              <td className="px-4 py-4">
                <Link className="text-primary font-semibold hover:underline" href={r.href}>
                  {r.name}
                </Link>
                {r.schoolGrade && <span className="text-muted-foreground ml-1.5 text-xs">{r.schoolGrade}</span>}
                <div className="text-muted-foreground mt-1 text-xs">{r.detail}</div>
              </td>
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
                <span className={`inline-block rounded-full px-2.5 py-1 text-xs ${TONE[r.tone]}`}>{r.statusLabel}</span>
                {r.myTurn && <div className="text-primary mt-1 text-xs">내 작성 대기</div>}
                {r.link && <div className={`mt-1 text-xs ${LINK_TEXT[r.link].cls}`}>{LINK_TEXT[r.link].text}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="text-muted-foreground p-10 text-center text-sm">해당하는 퇴원보고서가 없습니다.</p>}
    </div>
  );
}
