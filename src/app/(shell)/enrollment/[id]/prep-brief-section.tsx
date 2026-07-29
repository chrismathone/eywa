/**
 * 사전 상담 브리프(상담지) 표시 — 등록상담 상세 상단. 상담을 **시작하기 전에** 읽는 카드다.
 *
 * ⚠️ 여기 나오는 반·잔여석·금액은 전부 생성 시점 스냅샷(`record.facts`)이다 — 화면이 지금 DB를
 *    다시 읽지 않는다. "그때 이 자료로 상담했다"가 재현돼야 하기 때문(인쇄물 동결과 같은 정책).
 *    오래된 브리프는 '갱신'으로 다시 만든다.
 */
import { AlertCircle, AlertTriangle, ClipboardCheck, HelpCircle, MessageSquare, Printer, ShieldCheck } from "@/components/icons/eywa-icon-compat";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { classLine, type PrepBriefRecord } from "@/features/enrollment/prep-brief";
import { PrepBriefButton } from "./prep-brief-button";
import { PrepBriefProgress } from "./prep-brief-progress";

export function PrepBriefSection({
  consultationId,
  record,
  status,
  errorText,
  canWrite,
}: {
  consultationId: string;
  record: PrepBriefRecord | null;
  /** 0153b 생성 상태 — generating이면 진행바, failed면 실패 안내 + 재시도. */
  status: "generating" | "failed" | null;
  errorText: string | null;
  canWrite: boolean;
}) {
  const generating = status === "generating";
  const failedLine =
    status === "failed" ? (
      <p className="text-destructive inline-flex items-center gap-1 text-xs">
        <AlertCircle className="size-3" />
        {errorText ?? "브리프 생성에 실패했습니다"} — 다시 시도해 주세요
      </p>
    ) : null;

  if (!record) {
    return (
      <section className="border-border bg-bg-soft/40 rounded-2xl border border-dashed p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1 space-y-1">
            <h2 className="text-foreground inline-flex items-center gap-2 text-sm font-bold">
              <ClipboardCheck className="text-primary size-4" />
              상담 준비 브리프
            </h2>
            {generating ? (
              <div className="pt-1">
                <PrepBriefProgress consultationId={consultationId} />
              </div>
            ) : (
              <p className="text-text-dim text-xs break-keep">
                학부모가 접수 폼에 답한 내용과 학원 데이터(개설 반·잔여석·시간·수강료·형제 재원 여부)를 모아
                상담 직전에 읽을 준비 문서를 만듭니다.
              </p>
            )}
            {failedLine}
          </div>
          {canWrite && !generating ? (
            <PrepBriefButton consultationId={consultationId} exists={false} />
          ) : null}
        </div>
      </section>
    );
  }

  const b = record.brief;
  const f = record.facts;
  const modelLabel = record.source === "ai" ? modelDisplayLabel(record.model) : null;
  const generated = new Date(record.generatedAt).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  });

  return (
    <section className="border-primary/20 bg-primary-soft/20 space-y-4 rounded-2xl border p-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-foreground inline-flex items-center gap-2 text-sm font-bold">
            <ClipboardCheck className="text-primary size-4" />
            상담 준비 브리프
            {record.source === "fallback" ? (
              // 폴백을 AI 결과처럼 보이게 두면 상담사가 "AI가 검토했다"고 오해한다 — 정직하게 구분.
              <span className="border-border text-text-dim rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
                접수 정보 기반 기본 브리프
              </span>
            ) : modelLabel ? (
              <span className="border-border text-text-dim rounded-md border px-1.5 py-0.5 text-[10px] font-medium">
                {modelLabel}
              </span>
            ) : null}
          </h2>
          <p className="text-foreground text-lg font-semibold break-keep">{b.headline}</p>
          <p className="text-text-dim text-[11px]">
            <span className="num">{generated}</span> 기준 학원 데이터로 작성 · 상담 전 확인용
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PrintWindowButton
            id={`print/enrollment-prep/${consultationId}`}
            href={`/enrollment/${consultationId}/prep`}
            title="상담 준비 브리프"
            variant="outline"
          >
            <Printer className="size-4" />
            인쇄
          </PrintWindowButton>
          {canWrite && !generating ? <PrepBriefButton consultationId={consultationId} exists /> : null}
        </div>
      </header>

      {/* 재생성 중 — 직전 브리프는 그대로 두고 위에 진행바만 얹는다(실패해도 직전 브리프 보존). */}
      {generating ? (
        <div className="border-border bg-card rounded-lg border p-3">
          <PrepBriefProgress consultationId={consultationId} />
        </div>
      ) : null}
      {failedLine}

      <Block icon={MessageSquare} title="오프닝 멘트">
        <p className="text-foreground text-[13px] leading-relaxed break-keep whitespace-pre-line">{b.opening}</p>
      </Block>

      {b.questions.length > 0 ? (
        <Block icon={HelpCircle} title="반드시 확인할 질문">
          <ul className="space-y-1">
            {b.questions.map((q) => (
              <li key={q} className="text-foreground text-[13px] leading-relaxed break-keep">
                · {q}
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      {b.playbook.length > 0 ? (
        <Block icon={ShieldCheck} title="걱정 → 대응 화법">
          <div className="space-y-2.5">
            {b.playbook.map((p) => (
              <div key={p.concern} className="border-border bg-card rounded-lg border p-3">
                <p className="text-foreground text-[13px] font-semibold break-keep">{p.concern}</p>
                <p className="text-text-dim mt-0.5 text-[11px] break-keep">근거: {p.evidence}</p>
                <p className="text-foreground mt-1.5 text-[13px] leading-relaxed break-keep">{p.response}</p>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      {/* 반 제안 — LLM 문장 + **스냅샷 사실 표**를 함께 보여준다. 문장만 두면 상담 자리에서
          "그 반 자리 있나요?"에 즉답할 근거가 사라진다(사실은 코드가, 말은 LLM이). */}
      {b.proposal || f.classes.length > 0 ? (
        <Block icon={ClipboardCheck} title="반 제안">
          {b.proposal ? (
            <p className="text-foreground text-[13px] leading-relaxed break-keep whitespace-pre-line">
              {b.proposal}
            </p>
          ) : null}
          {f.classes.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {f.classes.map((c) => (
                <li key={c.id} className="text-text-dim text-[12px] break-keep">
                  · {classLine(c)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-dim text-[12px]">조건에 맞는 개설 반이 없습니다 — 시간표를 먼저 확인하세요.</p>
          )}
        </Block>
      ) : null}

      {b.objections.length > 0 ? (
        <Block icon={MessageSquare} title="예상 반론과 답변">
          <div className="space-y-2">
            {b.objections.map((o) => (
              <div key={o.objection}>
                <p className="text-foreground text-[13px] font-semibold break-keep">“{o.objection}”</p>
                <p className="text-foreground text-[13px] leading-relaxed break-keep">→ {o.answer}</p>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      <Block icon={MessageSquare} title="클로징">
        <p className="text-foreground text-[13px] leading-relaxed break-keep whitespace-pre-line">{b.closing}</p>
      </Block>

      {b.cautions.length > 0 ? (
        <div className="border-amber/30 bg-amber-soft/30 rounded-lg border p-3">
          <p className="text-foreground inline-flex items-center gap-1.5 text-xs font-bold">
            <AlertTriangle className="text-amber size-3.5" />
            주의
          </p>
          <ul className="mt-1.5 space-y-1">
            {b.cautions.map((c) => (
              <li key={c} className="text-foreground text-[13px] leading-relaxed break-keep">
                · {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* 상담 자리에서 자주 묻는 사실 — 스냅샷에서 바로. LLM 문장을 거치지 않는다. */}
      <dl className="border-border grid grid-cols-2 gap-x-4 gap-y-1.5 border-t pt-3 sm:grid-cols-4">
        <Fact label="전체 재원생" value={`${f.peers.total}명`} />
        {f.student.school ? <Fact label={`${f.student.school} 재원`} value={`${f.peers.sameSchool}명`} /> : null}
        {f.student.grade ? <Fact label={`${f.student.grade} 재원`} value={`${f.peers.sameGrade}명`} /> : null}
        {f.siblings.length > 0 ? (
          <Fact label="형제 재원 추정" value={f.siblings.map((s) => s.name).join(", ")} />
        ) : null}
        {f.policy.dueDay != null ? <Fact label="납부일" value={`매월 ${f.policy.dueDay}일`} /> : null}
      </dl>
    </section>
  );
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ClipboardCheck;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-text-dim inline-flex items-center gap-1.5 text-[11px] font-bold tracking-wide">
        <Icon className="size-3.5" />
        {title}
      </h3>
      {children}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-text-dim text-[11px]">{label}</dt>
      <dd className="text-foreground num text-[13px] font-semibold break-keep">{value}</dd>
    </div>
  );
}
