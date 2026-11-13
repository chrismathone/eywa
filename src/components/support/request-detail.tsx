import type { ReactNode } from "react";
import { MenuMentionText } from "@/components/menu-mention-text";
import { fmtSupportDateTime } from "@/features/support/format";
import { SUPPORT_STATUSES, SUPPORT_STATUS_META, type SupportRequestDetail } from "@/features/support/types";
import { phoneLabel } from "@/lib/format/phone";

/**
 * 개선요청 상세 본문 — makeedu 상세(제목 · 글쓴이 · 작성일시 · 결과수신 연락처/이메일 · 처리상태 4단계 ·
 * 처리완료 예정일 · 내용 · 답변)와 같은 순서. 지점 화면과 슈퍼관리자 화면이 같이 쓴다(상태가 없는 서버 부품).
 */
export function SupportRequestDetailView({ item, showTenant = false }: { item: SupportRequestDetail; showTenant?: boolean }) {
  return (
    <div className="space-y-4">
      <section className="bg-card shadow-card overflow-hidden rounded-2xl" aria-label="요청 정보">
        <dl className="divide-line grid divide-y text-sm">
          {showTenant ? <Row label="지점">{item.tenantName ?? "—"}</Row> : null}
          <Row label="글쓴이">
            {item.authorName}
            {item.authorRole ? <span className="text-text-dim"> · {item.authorRole}</span> : null}
            {item.authorEmail ? <span className="text-text-dim"> · {item.authorEmail}</span> : null}
          </Row>
          <Row label="작성일시">
            <span className="num">{fmtSupportDateTime(item.createdAt)}</span>
          </Row>
          <Row label="결과수신 연락처">{phoneLabel(item.contactPhone) || "—"}</Row>
          <Row label="결과수신 이메일">{item.contactEmail || "—"}</Row>
          <Row label="처리상태">
            <StatusSteps current={item.status} />
          </Row>
          <Row label="처리완료 예정일">
            <span className="num">{item.dueDate ?? "—"}</span>
          </Row>
        </dl>
      </section>

      <section className="bg-card shadow-card rounded-2xl p-5" aria-label="내용">
        <h2 className="text-foreground mb-2 text-base font-bold">내용</h2>
        <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-wrap"><MenuMentionText text={item.body} defaultNames={showTenant} link={!showTenant} /></p>
      </section>

      <section className="bg-card shadow-card rounded-2xl p-5" aria-label="답변">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-foreground text-base font-bold">답변</h2>
          {item.answeredAt ? (
            <span className="num text-text-dim text-sm">에이와 운영팀 · {fmtSupportDateTime(item.answeredAt)}</span>
          ) : null}
        </div>
        {item.answer ? (
          <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-wrap"><MenuMentionText text={item.answer} defaultNames={showTenant} link={!showTenant} /></p>
        ) : (
          <p className="text-text-dim text-sm">아직 답변이 없습니다. 운영팀이 확인하면 여기와 알림으로 알려 드립니다.</p>
        )}
      </section>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] items-center gap-3 px-4 py-2.5 max-sm:grid-cols-1 max-sm:gap-0.5">
      <dt className="text-text-dim font-bold">{label}</dt>
      <dd className="text-foreground min-w-0 break-all">{children}</dd>
    </div>
  );
}

/** 처리상태 네 단계 — 지나온 단계까지 채운다(makeedu 상세의 1·2·3·4 단계 표시). */
function StatusSteps({ current }: { current: SupportRequestDetail["status"] }) {
  const at = SUPPORT_STATUSES.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-1.5" aria-label={`처리상태: ${SUPPORT_STATUS_META[current].label}`}>
      {SUPPORT_STATUSES.map((s, i) => {
        const reached = i <= at;
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span
              aria-current={i === at ? "step" : undefined}
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-bold ${
                reached ? "bg-primary text-primary-foreground" : "bg-bg-soft text-text-dim"
              }`}
            >
              <span className="num">{i + 1}</span>
              {SUPPORT_STATUS_META[s].label}
            </span>
            {i < SUPPORT_STATUSES.length - 1 ? <span className="text-text-dim" aria-hidden>›</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
