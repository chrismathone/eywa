import "server-only";
/**
 * 학원 비서 질문 한 번 — 문(원장·슈퍼관리자) → 지점 AI 라이선스 → 하루 상한·겹침 → 대화 저장('도는 중') →
 * 비서 DB 연결(이 지점으로 묶음) → AI 루프 → 답 저장 · 감사 기록 · 사용량 장부. 진행은 `emit`으로 흘려보낸다.
 * 🔴 화면 연결이 끊겨도 끝까지 돌고 저장한다(화면은 대화를 다시 읽는다) — 그래서 `signal`은 사람이 '멈춤'을 눌렀을 때만 쓴다.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropic } from "@/lib/ai/anthropic";
import { anthropicUsage, isCreditExhaustedError, recordUsage, requireAiLicense } from "@/lib/ai/generate";
import { keyGroupOf, keyLabelOf, resolveKeyEnv } from "@/lib/ai/models";
import { logActionAs } from "@/features/audit/server/log";
import { reportError } from "@/lib/observability/report-error";
import { ROLE_LABEL } from "@/lib/auth/role-hierarchy";
import { displayRoleFor, getSuperAdminIds } from "@/lib/auth/super-admin";
import { ASSISTANT_LEVEL_LABEL, type AssistantLevel } from "../levels";
import { ASSISTANT_HARD_DEADLINE_MS, type AskEvent, type AskStep } from "../protocol";
import type { QueryResult, SettledReport } from "../report";
import type { AdviceCheckResult } from "../advice";
import { ASSISTANT_DOCS } from "../catalog";
import { clipText } from "../text";
import { AssistantError, runAssistantAgent } from "./agent";
import { saveAdvice } from "./advice-store";
import { openAssistantDb } from "./executor";
import { assistantViewer, isGateFailure } from "./gate";
import { ASSISTANT_FEATURE, ASSISTANT_MODEL } from "./models";
import {
  admission,
  BUSY_FULL_MESSAGE,
  BUSY_THREAD_MESSAGE,
  compactReport,
  controlFlags,
  finishMessage,
  markFailed,
  pastTurns,
  startMessage,
  type Usage,
} from "./store";

/** 보고서를 쓸 시간 — 고정 기한에서 이만큼 앞이 마무리 시각이다. */
const REPORT_RESERVE_MS = 200_000;

export type AskInput = { threadId?: string | null; question: string; level: AssistantLevel; clientRef?: string | null; redoOf?: string | null };

/** 사람에게 보일 오류 문장(한국어가 아닌 원문은 내지 않는다). */
export function assistantErrorMessage(error: unknown): string {
  if (error instanceof AssistantError) return error.message;
  if (isCreditExhaustedError(error)) return "AI 사용 한도가 찼습니다. 관리자에게 알려 주세요";
  if (error instanceof Anthropic.RateLimitError) return "AI 요청이 잠시 몰렸습니다. 1분 뒤 다시 물어봐 주세요";
  if (error instanceof Anthropic.APIConnectionError) return "AI에 연결하지 못했습니다. 잠시 뒤 다시 물어봐 주세요";
  if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) return "AI 서버가 잠시 응답하지 않습니다. 잠시 뒤 다시 물어봐 주세요";
  if (error instanceof Error && /[가-힣]/.test(error.message)) return error.message;
  return "답을 만들지 못했습니다. 잠시 뒤 다시 물어봐 주세요";
}

/**
 * 시작 전에 막히면 `{ error, status, code? }`(JSON 응답), 시작하면 흐름 함수.
 * `code: "busy"` = 동시 자리(3개)가 찼거나 같은 대화가 아직 도는 중 — 실패가 아니라 '잠시 뒤'(화면은 보낸 글을 입력칸에 되돌린다).
 */
export async function prepareAsk(
  input: AskInput,
): Promise<{ error: string; status: number; code?: "busy" | "day" } | { messageId: string; run: (emit: (e: AskEvent) => void) => Promise<void> }> {
  const begun = Date.now();
  const viewer = await assistantViewer();
  if (isGateFailure(viewer)) return viewer;
  const { owner } = viewer;
  try {
    await requireAiLicense({ tenantId: owner.tenantId, feature: ASSISTANT_FEATURE });
  } catch (error) {
    return { error: assistantErrorMessage(error), status: 403 };
  }
  const blocked = await admission(owner, input.threadId);
  if (blocked) return { error: blocked.error, status: 429, code: blocked.code };
  const started = await startMessage(owner, input);
  if (started === "no_thread") return { error: "대화를 찾지 못했습니다. 새 질문으로 물어봐 주세요", status: 404 };
  if (started === "busy") return { error: BUSY_FULL_MESSAGE, status: 429, code: "busy" };
  if (started === "busy_thread") return { error: BUSY_THREAD_MESSAGE, status: 429, code: "busy" };

  return {
    messageId: started.messageId,
    run: async (emit) => {
      // 멈춤 = 사람이 누른 ‘멈춤’(DB 표시) 또는 고정 기한 — 화면 연결이 끊겨도 끝까지 돈다.
      // 마무리 = 사람이 누른 '여기서 끝내고 결과 보기'(DB 표시 wrap_requested_at · 원장 2026-11-06) — 질문을 버리지 않고 지금까지로 보고서를 쓴다.
      // 🔴 고정 기한: 라우트 기한(800초)에 함수가 죽으면 저장·감사 기록·사용량이 통째로 빠지고 줄이 '도는 중'으로 남는다 →
      //    760초(ASSISTANT_HARD_DEADLINE_MS)에 스스로 끊고 실패로 저장한다(적대 리뷰 2026-11-06). 그보다 200초(REPORT_RESERVE_MS) 앞의 '마무리'(agent.ts)는 부탁일 뿐이라 따로 둔다.
      const stop = new AbortController();
      const signal = stop.signal;
      const wrap = new AbortController();
      let stoppedBy: "user" | "deadline" | null = null;
      const poll = setInterval(() => {
        void controlFlags(owner, started.messageId).then(
          (flags) => {
            if (flags.wrap && !wrap.signal.aborted) wrap.abort();
            if (!flags.cancel || stoppedBy) return;
            stoppedBy = "user";
            stop.abort();
          },
          () => undefined,
        );
      }, 2000);
      const deadline = setTimeout(
        () => {
          if (stoppedBy) return;
          stoppedBy = "deadline";
          stop.abort();
        },
        Math.max(0, ASSISTANT_HARD_DEADLINE_MS - (Date.now() - begun)),
      );
      emit({ type: "started", messageId: started.messageId });
      if (started.created) emit({ type: "thread", threadId: started.threadId, title: started.title });
      const { model, effort } = ASSISTANT_MODEL[input.level];
      const group = keyGroupOf(ASSISTANT_FEATURE);
      const keyName = keyLabelOf("anthropic", resolveKeyEnv("anthropic", "default", group));
      const usage: Usage[] = [];
      const steps = new Map<string, AskStep>();
      let report: SettledReport | null = null;
      let queries: QueryResult[] = [];
      let checks: AdviceCheckResult[] = [];
      let askedOn = "";
      let failure: string | null = null;
      const db = await openAssistantDb(owner.tenantId).catch((error: unknown) => {
        reportError(error, { scope: "assistant.db.open", tenantId: owner.tenantId });
        return null;
      });
      try {
        if (!db) throw new AssistantError("비서 DB에 연결하지 못했습니다. 잠시 뒤 다시 물어봐 주세요");
        // 서로 기다릴 까닭이 없는 두 조회(B4).
        const [history, asker] = await Promise.all([started.created ? [] : pastTurns(owner, started.threadId, input.redoOf ?? null), askerLabel(viewer.user.id, viewer.user.systemRole)]);
        const out = await runAssistantAgent({
          client: getAnthropic("default", group),
          model,
          effort,
          db,
          docs: ASSISTANT_DOCS,
          question: input.question,
          asker,
          history,
          // 마무리 시각 = 고정 기한에서 보고서 쓸 시간(200초 — 15만 토큰을 읽고 긴 보고서를 쓰는 '강함'도 넉넉히 · 적대 리뷰 2026-11-09)을 뺀 것.
          // 이 루프가 시작한 때부터 잰다(앞서 쓴 준비 시간을 뺀다). 마무리 시각이 차례 도중에 오면 agent가 그 응답을 끊고 곧장 보고서를 부탁한다.
          softDeadlineMs: Math.max(60_000, ASSISTANT_HARD_DEADLINE_MS - REPORT_RESERVE_MS - (Date.now() - begun)),
          // '적음'(Haiku)은 입력 10만 토큰을 넘으면 단가가 5배 — 그 앞에서 마무리(적대 리뷰 2026-11-09). 판정은 직전 차례 입력이라
          // 한 차례 조회 결과(각 최대 2만 자)가 더 붙어도 10만을 넘지 않게 3만 여유를 둔다(재리뷰 2026-11-09).
          ...(input.level === "low" ? { contextWrapTokens: 70_000 } : {}),
          emit: (event) => {
            steps.set(event.step.id, event.step);
            emit(event);
          },
          signal,
          wrapSignal: wrap.signal,
          onUsage: async (u) => {
            usage.push({
              model: u.model,
              input: u.usage.input_tokens ?? 0,
              output: u.usage.output_tokens ?? 0,
              cacheRead: u.usage.cache_read_input_tokens ?? 0,
              cacheWrite: u.usage.cache_creation_input_tokens ?? 0,
            });
            await recordUsage({ meta: { tenantId: owner.tenantId, feature: "academy_assistant" }, provider: "anthropic", model: u.model, keyName, usage: anthropicUsage(u.usage), ok: true });
          },
        });
        // 흘려보내는 답과 저장본을 같게 — 긴 글 칸·큰 자료를 줄인다(store.ts compactReport).
        report = compactReport(out.report);
        queries = out.queries;
        checks = out.checks;
        askedOn = out.askedOn;
      } catch (error) {
        failure =
          stoppedBy === "user"
            ? "질문을 멈췄습니다"
            : stoppedBy === "deadline"
              ? "시간이 오래 걸려 멈췄습니다. 질문을 좁히거나 나눠서 다시 물어봐 주세요"
              : assistantErrorMessage(error);
        if (!(error instanceof AssistantError) && !stoppedBy) reportError(error, { scope: "assistant.ask", tenantId: owner.tenantId });
        // 사람이 누른 멈춤은 실패가 아니다 — 장부에 실패로 남기지 않는다(쓴 토큰은 agent가 차례마다 이미 적었다).
        // 고정 기한은 늘 실패로 적는다 — 조회 도중 걸리면 agent가 다음 차례 시작에서 AssistantError로 끝내므로 오류 종류로 가리지 않는다(재리뷰 2026-11-06).
        // ⚠️ 끊긴 차례의 사용량은 message_start 시점 값이라 출력 토큰이 거의 0으로 적힌다(알려진 한계 — agent.ts).
        if (stoppedBy === "deadline" || (!(error instanceof AssistantError) && !stoppedBy)) {
          const reason = stoppedBy === "deadline" ? "hard deadline" : error instanceof Error ? error.message : String(error);
          await recordUsage({ meta: { tenantId: owner.tenantId, feature: "academy_assistant" }, provider: "anthropic", model, keyName, ok: false, error: clipText(reason, 300) });
        }
      } finally {
        clearInterval(poll);
        clearTimeout(deadline);
        await db?.close().catch(() => undefined);
      }
      // 원장이 누른 멈춤 — 보고서 뒤 기준값을 재는 동안 눌러도 화면은 이미 '멈춤'이다. 저장본도 멈춤으로 남긴다
      // (다시 열면 멈춘 질문에 답이 떠 있거나 '다시 묻기'로 같은 답이 두 벌 생기지 않게 · 재리뷰 2026-11-09). 고정 기한은 답을 살린다.
      if (stoppedBy === "user" && report) {
        report = null;
        checks = [];
        failure = "질문을 멈췄습니다";
      }
      // 저장 — 흘려보낸 답과 저장본이 어긋나지 않게(재리뷰 2026-11-06): 실패하면 표·차트 자료를 뺀 보고서로 한 번 더,
      // 그래도 안 되면 상태만 '실패'로 닫고 화면에도 실패로 보낸다(화면에 보인 답이 다시 열면 사라지거나 다음 질문이 맥락을 잃지 않게).
      const save = (r: SettledReport | null) =>
        finishMessage(owner, { threadId: started.threadId, messageId: started.messageId, level: input.level, report: r, error: failure, queries, steps: [...steps.values()], usage });
      try {
        await save(report);
      } catch (error) {
        reportError(error, { scope: "assistant.save", tenantId: owner.tenantId });
        const slim: SettledReport | null = report ? { ...report, datasets: {}, datasetsOmitted: true } : null;
        try {
          if (!slim) throw error;
          await save(slim);
          report = slim;
        } catch {
          if (report) failure = "답을 저장하지 못했습니다. 다시 물어봐 주세요";
          report = null;
          await markFailed(owner, started.messageId, failure ?? "답을 저장하지 못했습니다. 다시 물어봐 주세요").catch((e: unknown) =>
            reportError(e, { scope: "assistant.save.mark_failed", tenantId: owner.tenantId }),
          );
        }
      }
      // 비서 의견 줄(제안 → 결과 → 학습 · s2_0036) — 답이 저장된 뒤에만(의견 줄이 답을 가리킨다). 실패해도 답은 산다(처리 단추만 빠진다).
      let adviceCount = 0;
      if (report && askedOn) {
        try {
          const advice = await saveAdvice(owner, { messageId: started.messageId, threadId: started.threadId, report, checks, askedOn });
          adviceCount = advice.length;
          if (advice.length) report = { ...report, advice };
        } catch (error) {
          reportError(error, { scope: "assistant.advice.save", tenantId: owner.tenantId });
        }
      }
      // 시작할 때 확인한 사람으로 남긴다 — 끝에서 쿠키 세션을 다시 찾으면 긴 질문 사이 토큰 만료로 빠질 수 있다(적대 리뷰 2026-11-06).
      await logActionAs({ tenantId: owner.tenantId, actorId: viewer.user.id, actorName: viewer.user.displayName }, {
        action: "assistant_ask",
        targetType: "assistant",
        targetLabel: started.title,
        metadata: {
          level: input.level,
          levelLabel: ASSISTANT_LEVEL_LABEL[input.level],
          question: clipText(input.question, 80),
          queries: queries.length,
          advice: adviceCount,
          checks: checks.filter((c) => c.baseline).length,
          checksFailed: checks.filter((c) => !c.baseline).length,
          outcome: report ? "ok" : "error",
          ...(report?.cutShort ? { cutShort: report.cutShort } : {}),
          inputTokens: usage.reduce((s, u) => s + u.input + u.cacheRead + u.cacheWrite, 0),
          outputTokens: usage.reduce((s, u) => s + u.output, 0),
        },
      });
      emit(report ? { type: "report", messageId: started.messageId, report } : { type: "error", message: failure ?? "답을 만들지 못했습니다", messageId: started.messageId });
    },
  };
}

/**
 * 묻는 사람의 역할 이름(질문 메시지 '묻는 사람') — 지점 화면과 같은 표시 역할(운영 계정은 '관리자' · `displayRoleFor`).
 * 2026-11-11 멘트 시험: 관리자가 물어도 '원장님'으로 불렀다. 운영 계정 명단을 못 읽으면 실제 역할 이름 그대로.
 */
async function askerLabel(userId: string, role: Parameters<typeof displayRoleFor>[1]): Promise<string> {
  const superAdminIds = await getSuperAdminIds().catch(() => new Set<string>());
  return ROLE_LABEL[displayRoleFor(userId, role, superAdminIds)] ?? ROLE_LABEL[role] ?? "원장";
}
