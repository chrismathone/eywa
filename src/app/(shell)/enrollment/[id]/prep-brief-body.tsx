/**
 * 상담 준비 브리프 **본문 한 벌** — 오프닝 · 확인할 질문 · 대응 화법 · 반 제안 · 반론 · 클로징 · 주의 · 사실 표.
 *
 * 상세 화면의 카드와 수정 화면의 고정 패널(`PrepBriefSection pinned`)이 **같은 이 부품**을 그린다 —
 * 두 화면이 각자 본문을 적으면 한쪽만 고쳐져 같은 브리프가 화면마다 다르게 읽힌다.
 * ⚠️ 반·잔여석·금액은 생성 시점 스냅샷(`record.facts`) 그대로다 — 여기서 DB를 다시 읽지 않는다
 *    (prep-brief-section 머리 주석 · 인쇄물 동결과 같은 정책).
 */
import { AlertTriangle, ClipboardCheck, HelpCircle, MessageSquare, ShieldCheck } from "@/components/icons/aywa-icon-compat";
import { classLine, type PrepBriefRecord } from "@/features/enrollment/prep-brief";

export function PrepBriefBody({ record }: { record: PrepBriefRecord }) {
  const b = record.brief;
  const f = record.facts;
  return (
    <>
      <Block icon={MessageSquare} title="오프닝 멘트">
        <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-line">{b.opening}</p>
      </Block>

      {b.questions.length > 0 ? (
        <Block icon={HelpCircle} title="반드시 확인할 질문">
          <ul className="space-y-1">
            {b.questions.map((q) => (
              <li key={q} className="text-foreground text-sm leading-relaxed break-keep">
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
                <p className="text-foreground text-sm font-semibold break-keep">{p.concern}</p>
                <p className="text-text-dim mt-0.5 text-xs break-keep">근거: {p.evidence}</p>
                <p className="text-foreground mt-1.5 text-sm leading-relaxed break-keep">{p.response}</p>
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
            <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-line">{b.proposal}</p>
          ) : null}
          {f.classes.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {f.classes.map((c) => (
                <li key={c.id} className="text-text-dim text-xs break-keep">
                  · {classLine(c)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-text-dim text-xs">조건에 맞는 개설 반이 없습니다 — 시간표를 먼저 확인하세요.</p>
          )}
        </Block>
      ) : null}

      {b.objections.length > 0 ? (
        <Block icon={MessageSquare} title="예상 반론과 답변">
          <div className="space-y-2">
            {b.objections.map((o) => (
              <div key={o.objection}>
                <p className="text-foreground text-sm font-semibold break-keep">“{o.objection}”</p>
                <p className="text-foreground text-sm leading-relaxed break-keep">→ {o.answer}</p>
              </div>
            ))}
          </div>
        </Block>
      ) : null}

      <Block icon={MessageSquare} title="클로징">
        <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-line">{b.closing}</p>
      </Block>

      {b.cautions.length > 0 ? (
        <div className="border-amber/30 bg-amber-soft/30 rounded-lg border p-3">
          <p className="text-foreground inline-flex items-center gap-1.5 text-xs font-bold">
            <AlertTriangle className="text-amber size-3.5" />
            주의
          </p>
          <ul className="mt-1.5 space-y-1">
            {b.cautions.map((c) => (
              <li key={c} className="text-foreground text-sm leading-relaxed break-keep">
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
    </>
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
      <h3 className="text-text-dim inline-flex items-center gap-1.5 text-xs font-bold tracking-wide">
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
      <dt className="text-text-dim text-xs">{label}</dt>
      <dd className="text-foreground num text-sm font-semibold break-keep">{value}</dd>
    </div>
  );
}
