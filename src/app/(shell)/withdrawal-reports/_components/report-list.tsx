import { EmbedLink as Link } from "@/components/embed-link";
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
            {["학생·처리 구분", "퇴원·종료일", "작성 강사", "승인 진행", "상태"].map((label) => (
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
                <div className="text-muted-foreground mt-1 text-xs">{r.detail}</div>
              </td>
              <td className="px-4 py-4 whitespace-nowrap">{r.dateText}</td>
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
