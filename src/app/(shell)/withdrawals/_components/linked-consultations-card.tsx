import { MessageCircle } from "@/components/icons/aywa-icon-compat";
import { Pill } from "@/components/atoms/pill";
import { WindowLink } from "@/components/workspace/window-link";
import type { LinkedConsultations } from "@/features/withdrawals/server/linked-consultations";
import { DetailCard } from "./detail-card";

const kstDate = (v: string) => new Date(v).toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });

/**
 * 퇴원 상세 '콜&상담' 카드 — 이 학생에 이어진 신규 콜&상담 전부(최신순). 상태는 칸반과 같은 4칸 라벨.
 * 과목 칸은 자유 글자라(옛 이관분은 '수학'·'EIE') 학원설정 라벨을 지나고, 못 읽으면 글자 그대로 둔다(`labelOf`).
 */
export function LinkedConsultationsCard({
  consults,
  labelOf,
}: {
  consults: Exclude<LinkedConsultations, { status: "hidden" }>;
  labelOf: (key: string) => string;
}) {
  return (
    <DetailCard title="콜&상담" icon={<MessageCircle className="size-3.5" />}>
      {consults.status === "not_ready" ? (
        <p className="text-muted-foreground text-sm">콜&상담을 지금은 불러올 수 없습니다. 잠시 후 다시 확인해 주세요.</p>
      ) : consults.status === "error" ? (
        <p role="alert" className="text-muted-foreground text-sm">콜&상담을 불러오지 못했습니다 — 새로고침해 주세요.</p>
      ) : consults.rows.length === 0 ? (
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">이어진 콜&상담이 없습니다.</p>
          <p className="text-muted-foreground text-xs">옛 이관 상담은 원생과 이어지지 않은 것이 많습니다.</p>
        </div>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {consults.rows.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 first:pt-0 last:pb-0">
              <WindowLink href={`/enrollment/${c.id}`} className="text-primary font-medium hover:underline">
                <span className="num">{c.date ? kstDate(c.date) : "날짜 미기재"}</span>
                {c.subject ? ` · ${labelOf(c.subject)}` : ""}
              </WindowLink>
              <Pill color={c.stage.color}>{c.stage.label}</Pill>
            </li>
          ))}
        </ul>
      )}
    </DetailCard>
  );
}
