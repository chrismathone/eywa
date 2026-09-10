/**
 * 사전 상담 브리프(상담지) 표시 — 상담을 **시작하기 전에** 읽는 카드다.
 *
 * ⚠️ 여기 나오는 반·잔여석·금액은 전부 생성 시점 스냅샷(`record.facts`)이다 — 화면이 지금 DB를
 *    다시 읽지 않는다. "그때 이 자료로 상담했다"가 재현돼야 하기 때문(인쇄물 동결과 같은 정책).
 *    오래된 브리프는 '갱신'으로 다시 만든다.
 *
 * 본문은 **기본 접힘**(`PrepBriefCollapse`) — 길어서 등록상담 상세의 나머지(접수 정보·AI 분석·
 * 수강 이력)를 통째로 밀어냈다. 헤더(제목·헤드라인·모델 라벨·생성시각·인쇄/갱신)와 생성 진행바·
 * 실패 안내는 접혀 있어도 항상 보인다.
 *
 * ── `past`(상담 완료 이후 단계) ────────────────────────────────────────────────
 * 원장 2026-09-10: *"사실 브리프는 상담완료 칸반 이후로는 필요없을듯"* → *"지난 브리프로 이름을
 * 바꿔버리던지 처리해버리고 중요한건 배정된 반이니까"*. 그래서 **지우지 않고 격을 내린다**:
 *  · 제목이 `상담 준비 브리프` → **`지난 상담 브리프`**(끝난 상담을 '준비'라 부르면 거짓말이다)
 *  · 브랜드 틴트(눈에 띄는 자리) → 무채색 카드로. 자리도 페이지 맨 아래로 내려간다(page.tsx)
 *  · **'다시 작성'을 감춘다** — 지난 기록을 새로 만들 이유가 없고 AI 호출은 돈이 든다
 *  · **'인쇄'는 남긴다** — 이미 만들어 둔 문서를 여는 것이라 새 호출이 없고, 상담 뒤에 원본을
 *    다시 뽑아야 하는 일(학부모 재문의·인수인계)이 실제로 있다
 * 🔴 데이터(`prep_brief` 스냅샷)는 **한 줄도 지우지 않는다** — 표시·이름·자리만 바뀐다.
 */
import { AlertCircle, AlertTriangle, ClipboardCheck, HelpCircle, MessageSquare, Printer, ShieldCheck } from "@/components/icons/eywa-icon-compat";
import { PrintWindowButton } from "@/components/workspace/print-window";
import { modelDisplayLabel } from "@/lib/ai/model-label";
import { classLine, type PrepBriefRecord } from "@/features/enrollment/prep-brief";
import { PrepBriefButton } from "./prep-brief-button";
import { PrepBriefCollapse } from "./prep-brief-collapse";
import { PrepBriefProgress } from "./prep-brief-progress";

/** 상담이 끝난 뒤의 제목 — '준비'가 아니라 '지난'. 문구를 두 곳에 적지 않게 상수로. */
const TITLE_NOW = "상담 준비 브리프";
const TITLE_PAST = "지난 상담 브리프";

export function PrepBriefSection({
  consultationId,
  record,
  status,
  errorText,
  canWrite,
  past = false,
}: {
  consultationId: string;
  record: PrepBriefRecord | null;
  /** 0153b 생성 상태 — generating이면 진행바, failed면 실패 안내 + 재시도. */
  status: "generating" | "failed" | null;
  errorText: string | null;
  canWrite: boolean;
  /**
   * 칸반 '상담 전'을 지난 건인가(`stageOfCard(card) !== "before"`).
   * 🔴 판정은 호출부가 **board-stages 단일 소스**로 한다 — 여기서 outcome 문자열을 비교하지 말 것.
   */
  past?: boolean;
}) {
  const generating = status === "generating";
  const title = past ? TITLE_PAST : TITLE_NOW;
  // 🔴 '다시 작성'은 상담 전에만. 안 보이는 것을 다시 만들 수는 없어야 하고, 지난 기록을 새 사실로
  //    덮어쓰면 "그때 이 자료로 상담했다"는 스냅샷 성질이 깨진다(AI 호출은 명시 버튼일 때만 — 감춰도
  //    페이지 로드가 호출을 만들지 않으므로 캐싱 규약은 그대로다).
  const showRegenerate = canWrite && !generating && !past;
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
              {title}
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
          {showRegenerate ? <PrepBriefButton consultationId={consultationId} exists={false} /> : null}
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
    // past = 무채색(격을 내린 자리) / 상담 전 = 브랜드 틴트(지금 읽어야 하는 문서).
    <section
      className={`space-y-4 rounded-2xl border p-5 ${
        past ? "border-line bg-bg-soft/40" : "border-primary/20 bg-primary-soft/20"
      }`}
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="text-foreground inline-flex items-center gap-2 text-sm font-bold">
            <ClipboardCheck className={`size-4 ${past ? "text-text-dim" : "text-primary"}`} />
            {title}
            {record.source === "fallback" ? (
              // 폴백을 AI 결과처럼 보이게 두면 상담사가 "AI가 검토했다"고 오해한다 — 정직하게 구분.
              <span className="border-border text-text-dim rounded-md border px-1.5 py-0.5 text-xs font-medium">
                접수 정보 기반 기본 브리프
              </span>
            ) : modelLabel ? (
              <span className="border-border text-text-dim rounded-md border px-1.5 py-0.5 text-xs font-medium">
                {modelLabel}
              </span>
            ) : null}
          </h2>
          <p className="text-foreground text-lg font-semibold break-keep">{b.headline}</p>
          <p className="text-text-dim text-xs">
            <span className="num">{generated}</span> 기준 학원 데이터로 작성 ·{" "}
            {past ? "상담 전에 만든 문서(기록 보관용)" : "상담 전 확인용"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 🔴 '인쇄'는 past에서도 남긴다 — **이미 만들어 둔 스냅샷을 여는 것**이라 AI 호출이 없고,
              상담이 끝난 뒤에 원본을 다시 뽑아야 하는 일(학부모 재문의·인수인계)이 실제로 있다.
              반대로 '다시 작성'은 호출이 돈이고 지난 기록을 덮으므로 past에선 감춘다(showRegenerate). */}
          {/* ⚠️ 창 제목은 **문서 이름 그대로**다(카드 제목을 따라가지 않는다) — 인쇄물 자체는 언제나
              '상담 준비 브리프'라는 이름의 동결 스냅샷이라, 창만 '지난…'으로 부르면 열어 본 종이와
              어긋난다(`(print)/enrollment/[id]/prep`의 metadata.title과 같은 문자열). */}
          <PrintWindowButton
            id={`print/enrollment-prep/${consultationId}`}
            href={`/enrollment/${consultationId}/prep`}
            title={TITLE_NOW}
            variant="outline"
          >
            <Printer className="size-4" />
            인쇄
          </PrintWindowButton>
          {showRegenerate ? <PrepBriefButton consultationId={consultationId} exists /> : null}
        </div>
      </header>

      {/* 재생성 중 — 직전 브리프는 그대로 두고 위에 진행바만 얹는다(실패해도 직전 브리프 보존). */}
      {generating ? (
        <div className="border-border bg-card rounded-lg border p-3">
          <PrepBriefProgress consultationId={consultationId} />
        </div>
      ) : null}
      {failedLine}

      <PrepBriefCollapse label={past ? TITLE_PAST : "브리프"} muted={past}>
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
              <p className="text-foreground text-sm leading-relaxed break-keep whitespace-pre-line">
                {b.proposal}
              </p>
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
      </PrepBriefCollapse>
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
