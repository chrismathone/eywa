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
            {["과목", "학생", "학교학년", "구분", "요청일", "퇴원·종료일", "퇴원 사유", "작성 강사", "승인 진행", "상태"].map((label) => (
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
                {/* 상태 칸 — 내 승인 차례는 진하게, 승인자가 아닌 열람은 점선 테두리로(원장 2026-10-30 "상태란을 다르게 표시"). */}
                {r.mine === "approve" ? (
                  <span className="bg-primary text-primary-foreground inline-block rounded-full px-2.5 py-1 text-xs font-bold">내 승인 필요</span>
                ) : (
                  <span className={`inline-block rounded-full px-2.5 py-1 text-xs ${r.mine === "view" ? "border-line text-muted-foreground border border-dashed" : TONE[r.tone]}`}>{r.statusLabel}</span>
                )}
                {r.mine === "approve" && <div className="text-muted-foreground mt-1 text-xs">{r.statusLabel}</div>}
                {r.mine === "view" && <div className="text-muted-foreground mt-1 text-xs">열람 · 승인 대상 아님</div>}
                {r.myTurn && <div className="text-primary mt-1 text-xs">내 작성 대기</div>}
                {/* 미연결은 표시하지 않는다(원장 2026-10-30 "지난 기록이라") — 연결은 기록 상세에서 할 수 있다. */}
                {r.link && r.link !== "unmapped" && <div className={`mt-1 text-xs ${LINK_TEXT[r.link].cls}`}>{LINK_TEXT[r.link].text}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && <p className="text-muted-foreground p-10 text-center text-sm">해당하는 퇴원보고서가 없습니다.</p>}
    </div>
  );
}
