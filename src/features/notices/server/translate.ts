import "server-only";
import { sameMenuMentions } from "@/features/owner/menu-mentions";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateJSON } from "@/lib/ai/generate";
import { reportWarning } from "@/lib/observability/report-error";
import {
  hasTranslatableText,
  noticeSourceHash,
  sensitiveSkipReason,
  type NoticeSource,
} from "../translate-rules";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * 팝업 공지 **영문 번역 만들기**(0249a 캐시에 저장) — 원장 2026-09-03 *"공지사항도 영어로 보이도록"*.
 *
 * 🔴🔴 **호출 시점은 둘뿐이다**: ① 공지 저장 직후(`after()` 백그라운드) ② /owner의 [영문 만들기] 버튼.
 *    **페이지 로드에서 부르지 말 것** — CLAUDE.md *"AI 호출은 캐싱 + 명시적 트리거 · 페이지 로드만으로
 *    절대 새 호출 안 함"*. 팝업은 셸 진입마다 뜨고 메뉴가 same-origin iframe이라 **창 수만큼 곱해진다**(B6).
 * 🔴 `generateJSON()` **단일 진입점**을 반드시 경유한다(직접 provider 호출 금지) — FACT_GUARD가 거기서
 *    자동 부착되므로 **호출부 프롬프트 본문에 사실 원칙을 적지 않는다**(적으면 두 벌이 된다).
 * 🔴 민감 패턴(주민번호·계좌·카드)이 보이면 **부르지 않고** 사유만 저장한다 — 못 읽는 불편보다 전송이 나쁘다.
 */

const LANG = "en" as const;

type TranslateOutcome =
  | { ok: true; skipped?: false }
  | { ok: true; skipped: true; reason: string }
  | { ok: false; error: string };

/** 모델이 돌려줄 모양. 원문에 없는 칸은 빈 문자열로 온다(그대로 null 저장). */
type TranslatedJson = { title?: string; body?: string; linkLabel?: string };

function buildPrompt(src: NoticeSource): string {
  // ⚠️ OpenAI JSON mode는 프롬프트에 "JSON" 낱말이 필요하다 — 아래 문구가 그 조건을 충족한다.
  return [
    "학원 관리 시스템의 **팝업 공지**를 한국어에서 영어로 번역한다. 읽는 사람은 이 학원의 원어민 영어 강사다.",
    "",
    "규칙:",
    "- 고유명사는 **그대로 둔다**: 사람 이름·반 이름·학원 이름·`메이크에듀`·`에이와`·`AYWA`·`ClassNote` 등 제품/서비스 이름.",
    "- 화면에 실제로 있는 메뉴 이름(예: '내 메뉴', '내 정보')은 번역하되, 그것이 버튼 이름임을 알 수 있게 자연스럽게 쓴다.",
    "- 원문에 없는 내용을 덧붙이지 않는다. 문장 수와 뜻을 그대로 옮긴다.",
    "- 줄바꿈은 원문 그대로 유지한다.",
    "- @[이름](menu:/주소) 형태의 메뉴 참조는 한 글자도 변경하거나 누락하지 않는다. 표시 이름은 읽는 지점에서 자동 변환된다.",
    "- 원문이 비어 있는 칸은 빈 문자열로 둔다.",
    "",
    "아래 JSON을 영어로 옮겨 같은 키의 JSON으로만 답한다(설명 문장 금지).",
    JSON.stringify({ title: src.title, body: src.body ?? "", linkLabel: src.linkLabel ?? "" }, null, 2),
  ].join("\n");
}

/**
 * 한 공지의 영문 번역을 만들어 캐시에 넣는다(멱등 — 해시가 같으면 건너뛴다).
 *
 * ⚠️ **절대 throw하지 않는다** — 저장 액션의 `after()`와 버튼 양쪽에서 부르는데, 여기서 터지면
 *    공지 저장 자체가 실패한 것처럼 보인다. 실패는 값으로 돌려준다.
 * ⚠️ 0249a 미적용이면 저장에서 error가 오고 그 사실을 그대로 돌려준다(화면이 사유를 적는다).
 */
export async function buildNoticeTranslation(
  noticeId: string,
  src: NoticeSource,
  tenantId: string,
  opts: { force?: boolean } = {},
): Promise<TranslateOutcome> {
  const hash = noticeSourceHash(src);
  const admin = createAdminClient();

  if (!hasTranslatableText(src)) {
    return { ok: true, skipped: true, reason: "번역할 글이 없습니다" };
  }

  // 이미 같은 원문으로 만들어 둔 게 있으면 부르지 않는다(돈). `force`는 버튼이 명시로 다시 만들 때만.
  if (!opts.force) {
    try {
      const { data } = await admin
        .from("notice_popup_translations")
        .select("source_hash")
        .eq("notice_id", noticeId)
        .eq("lang", LANG)
        .maybeSingle();
      if (data?.source_hash === hash) return { ok: true };
    } catch {
      // 표가 없거나 조회 실패 — 아래에서 저장할 때 다시 드러난다.
    }
  }

  // 🔴 민감 패턴이면 **AI를 부르지 않는다**. 사유를 남겨 화면이 "왜 한국어인지" 말할 수 있게 한다.
  const skip = sensitiveSkipReason(src);
  if (skip) {
    const { error } = await admin.from("notice_popup_translations").upsert(
      {
        notice_id: noticeId,
        lang: LANG,
        title: null,
        body: null,
        link_label: null,
        source_hash: hash,
        skip_reason: skip,
        model: null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "notice_id,lang" },
    );
    if (error) return { ok: false, error: explainDbError(error, { scope: "notices.translate.buildNoticeTranslation", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    return { ok: true, skipped: true, reason: skip };
  }

  let out: TranslatedJson;
  let model: string;
  try {
    // 🔴 tier는 `balanced`(= Claude Sonnet 5.5 · 2026-10-26 원장 결정).
    //    저장 시점 백그라운드라 느려도 상관없다. 키가 없으면 사다리로 무중단 폴백.
    const res = await generateJSON<TranslatedJson>({
      prompt: buildPrompt(src),
      maxTokens: 2000,
      tier: "balanced",
      provider: "anthropic", // 2026-10-26 원장 결정 — Sonnet 5.5
      meta: { feature: "notice_translate", tenantId },
    });
    out = res.data;
    model = res.model;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    reportWarning("공지 번역 실패", { scope: "notice.translate", noticeId });
    return { ok: false, error: msg.slice(0, 300) };
  }

  const pick = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s ? s : null;
  };
  if (!sameMenuMentions(src.body ?? "", pick(out.body) ?? "")) {
    return { ok: false, error: "번역 중 메뉴 참조가 변경되어 원문을 유지합니다. 다시 번역해 주세요." };
  }
  const { error } = await admin.from("notice_popup_translations").upsert(
    {
      notice_id: noticeId,
      lang: LANG,
      title: pick(out.title),
      body: pick(out.body),
      link_label: pick(out.linkLabel),
      source_hash: hash,
      skip_reason: null,
      model,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "notice_id,lang" },
  );
  if (error) return { ok: false, error: explainDbError(error, { scope: "notices.translate.buildNoticeTranslation", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
  return { ok: true };
}
