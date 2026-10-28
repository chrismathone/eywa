import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/ai/generate";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import { parsePilotSections } from "../pilot-merge";
import { applyRestyle, RESTYLE_TITLES, restyleTargets } from "../pilot-restyle-guard";
import { MENT_AI_TUNING } from "../prompt-defaults";
import { mentStyleDirective } from "../ment-style-prompt";
import type { MentStyleProfile } from "../ment-style";
import { isMentDraftTableMissingError } from "./ment-draft-db";

/**
 * 새 수학 보고서 — 사실 항목(일일·확인 테스트 · 수업 태도 · 숙제 완성도 · 오늘의 숙제)을 **그 선생님 말투로** 다시 쓴다
 * (원장 2026-10-28 *"오늘의 진도를 떠나서 다른 영역도 수정한 사람들 있자나 그에 맞게 다 말투 언어 모두 학습"*).
 *
 * 🔑 2026-10-26 결정(사실 항목은 코드가 값에서 만든다)을 **넓힌 것**이다 — 사실은 그대로 코드가 만들고, AI는 그 글의 표현만 바꾼다.
 *    받기 전 항목마다 검사(pilot-restyle-guard.ts — 숫자·날짜·쪽수·부정·선생님 원문)를 지나야 하고, 어기면 그 항목은 코드 글 그대로.
 * 🔑 배우는 재료 = 그 선생님이 **자동작성 글을 고쳐 보낸** 기록(0370a 원문 ↔ 보낸 글)의 항목별 차이. 고친 적이 없으면 AI를 부르지 않는다
 *    (말투 프로파일만으로는 사실 문장을 손댈 근거가 없다 — 응답 시간도 그대로).
 * 🔴 던지지 않는다 — 실패하면 코드 글 그대로 돌려준다(보고서 작성이 멈추면 안 된다).
 */

export type SectionEditExample = { title: string; before: string; after: string };

/** 읽을 최근 원문 수 · 항목당/전체 예시 상한 — 프롬프트가 커지지 않게. */
const RECENT_DRAFTS = 40;
const PER_SECTION = 4;
const TOTAL = 16;
const EXAMPLE_MAX_CHARS = 400;

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** 학생 이름(성 포함 · 이름만) → ○○. 짧은 이름(두 글자 이하)은 이름만 가리면 다른 낱말을 지울 수 있어 전체 이름만. */
function maskNames(text: string, names: readonly string[]): string {
  let out = text;
  for (const raw of names) {
    const full = raw.replace(/[A-Z]$/, "").trim(); // 동명이인 구분 알파벳(이다윤A)
    if (!full) continue;
    out = out.split(full).join("○○");
    if (full.length >= 3) out = out.split(full.slice(1)).join("○○");
  }
  return out;
}

/**
 * 그 선생님이 고쳐 보낸 새 수학 보고서에서 **사실 항목을 어떻게 고쳤는지**(AI 원문 → 보낸 글) 예시를 모은다. 최신 순.
 * 표가 없거나(0370a 미적용) 조회가 실패하면 [] — 다시 쓰기 없이 종전대로.
 */
export async function loadSectionEditExamples(admin: SupabaseClient, tenantId: string, teacherId: string): Promise<SectionEditExample[]> {
  try {
    const { data: drafts, error } = await admin
      .from("ment_ai_drafts")
      .select("report_id, ai_draft, created_at")
      .eq("tenant_id", tenantId)
      .eq("teacher_id", teacherId)
      .like("ai_draft", "%■%")
      .order("created_at", { ascending: false })
      .limit(RECENT_DRAFTS);
    if (error) {
      if (!isMentDraftTableMissingError(error)) reportWarning("말투 예시(원문) 조회 실패", { scope: "loadSectionEditExamples", message: error.message });
      return [];
    }
    if (!drafts?.length) return [];
    const reports = await fetchInChunks<{ id: string; notes: string | null; student_id: string | null }>(
      drafts.map((d) => d.report_id as string),
      (chunk) =>
        admin
          .from("lesson_reports")
          .select("id, notes, student_id")
          .eq("tenant_id", tenantId)
          .eq("ment_source", "auto_edited")
          .in("id", chunk),
    );
    const reportBy = new Map(reports.map((r) => [r.id, r]));
    const studentIds = [...new Set(reports.map((r) => r.student_id).filter((v): v is string => !!v))];
    const students = await fetchInChunks<{ id: string; name: string | null }>(studentIds, (chunk) =>
      admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk),
    );
    const nameBy = new Map(students.map((s) => [s.id, s.name ?? ""]));

    const out: SectionEditExample[] = [];
    const perTitle = new Map<string, number>();
    for (const d of drafts) {
      if (out.length >= TOTAL) break;
      const rep = reportBy.get(d.report_id as string);
      if (!rep?.notes) continue;
      const names = rep.student_id ? [nameBy.get(rep.student_id) ?? ""] : [];
      const before = new Map(parsePilotSections(d.ai_draft as string).sections.map((s) => [s.title, s.body]));
      for (const s of parsePilotSections(rep.notes).sections) {
        if (!RESTYLE_TITLES.includes(s.title)) continue;
        const was = before.get(s.title);
        if (!was || !s.body || norm(was) === norm(s.body)) continue;
        const n = perTitle.get(s.title) ?? 0;
        if (n >= PER_SECTION || out.length >= TOTAL) continue;
        perTitle.set(s.title, n + 1);
        out.push({
          title: s.title,
          before: maskNames(was, names).slice(0, EXAMPLE_MAX_CHARS),
          after: maskNames(s.body, names).slice(0, EXAMPLE_MAX_CHARS),
        });
      }
    }
    return out;
  } catch (e) {
    reportWarning("말투 예시 조회 실패", { scope: "loadSectionEditExamples", message: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

function buildPrompt(args: {
  targets: { title: string; text: string }[];
  examples: SectionEditExample[];
  style: MentStyleProfile | null;
  studentName: string;
  mustKeep: string[];
}): string {
  const ex = args.examples
    .map((e, i) => `예시 ${i + 1} [${e.title}]\n자동작성: ${e.before.replace(/\n/g, " / ")}\n선생님이 고친 글: ${e.after.replace(/\n/g, " / ")}`)
    .join("\n\n");
  const input = Object.fromEntries(args.targets.map((t) => [t.title, t.text]));
  return [
    "학원 수학 수업보고서의 항목 글을 이 선생님이 평소 고쳐 쓰는 말투로 다시 써 주세요. JSON으로만 답합니다.",
    "",
    "[규칙]",
    "- [입력]의 항목마다 같은 사실을 이 선생님의 말투·어순·어휘로 다시 씁니다. 사실은 하나도 빼거나 더하지 않습니다.",
    "- 숫자·날짜·쪽수·퍼센트·점수·따옴표 안 단원 이름은 글자 그대로 둡니다. 없던 숫자를 쓰지 않습니다.",
    "- '하지 않았다·못했다·없었다' 같은 부정은 그대로 두고, 없던 부정을 만들지 않습니다.",
    "- [입력]에 없는 칭찬·평가·계획·약속(\"다음 시간에 ~하겠습니다\" 등)·인사말을 더하지 않습니다.",
    "- 예시는 이 선생님이 **어떻게 고치는지**만 보여 줍니다. 예시에 나온 사실(점수·단원·학생 모습)을 옮겨 쓰지 않습니다.",
    `- 학생 이름은 [입력]에 있는 그대로(${args.studentName || "이름"})만 씁니다. '○○'를 쓰지 않습니다.`,
    args.mustKeep.length ? `- 다음 말은 선생님이 직접 적은 말이라 글자 그대로 둡니다: ${args.mustKeep.map((k) => `"${k}"`).join(", ")}` : "",
    "- 이 선생님이 그 항목을 고친 예시가 없거나 고칠 데가 없으면 [입력] 글을 그대로 돌려줍니다.",
    "- 맞춤법·띄어쓰기는 표준으로(예시의 오탈자는 따라 쓰지 않습니다).",
    args.style ? `\n${mentStyleDirective(args.style)}` : "",
    "",
    "[이 선생님이 고친 예시]",
    ex,
    "",
    "[입력]",
    JSON.stringify(input, null, 1),
    "",
    '[출력] {"sections": {"항목 제목": "다시 쓴 글", ...}} — [입력]의 항목 제목 그대로, 그 항목들만.',
  ]
    .filter((l) => l !== "")
    .join("\n");
}

/**
 * 조립된 새 수학 보고서 글 → 사실 항목을 선생님 말투로 다시 쓴 글. 예시가 없거나, 다시 쓸 항목이 없거나, 실패하면 **받은 글 그대로**.
 * `mustKeep` = 선생님이 직접 적어 글에 그대로 들어간 말(태도 의견·미제출 사유·시험 안 친 사유) — 글자 그대로 남아야 받는다.
 */
export async function restylePilotSections(args: {
  composed: string;
  examples: SectionEditExample[];
  style: MentStyleProfile | null;
  studentName: string;
  tenantId: string;
  mustKeep?: string[];
}): Promise<string> {
  if (!args.examples.length) return args.composed;
  const parsed = parsePilotSections(args.composed);
  const mustKeep = (args.mustKeep ?? []).map((k) => k.trim()).filter(Boolean);
  // 항목 글이 통째로 선생님 원문이면(낮은 태도의 의견 등) 다시 쓰지 않는다 — 선생님 말을 AI가 고쳐 쓸 이유가 없다.
  const targets = restyleTargets(parsed.sections).filter((t) => !mustKeep.includes(t.text.trim()));
  if (!targets.length) return args.composed;
  try {
    const { data } = await generateJSON<Record<string, unknown>>({
      prompt: buildPrompt({ targets, examples: args.examples, style: args.style, studentName: args.studentName, mustKeep }),
      maxTokens: 1500,
      keyName: "default",
      tier: "fast",
      meta: { feature: "classnote_ment", tenantId: args.tenantId },
      ...MENT_AI_TUNING,
    });
    const rewrites = data && typeof data.sections === "object" && data.sections ? (data.sections as Record<string, unknown>) : {};
    const next = applyRestyle(parsed.sections, targets, rewrites, mustKeep);
    // 바뀐 항목만 원래 글에서 **그 자리 글자 그대로** 갈아끼운다 — 글 전체를 다시 그리면 손대지 않은 항목(표의 전각 공백 등)의 모양이 흔들릴 수 있다.
    let out = args.composed;
    next.forEach((s, i) => {
      const old = parsed.sections[i];
      if (s.body === old.body) return;
      const from = `■ ${old.title}\n${old.body}`;
      if (out.split(from).length !== 2) return; // 그 항목 글이 정확히 한 번 있을 때만
      out = out.replace(from, () => `■ ${s.title}\n${s.body}`);
    });
    return out;
  } catch (e) {
    reportWarning("보고서 항목 말투 다시 쓰기 실패 — 코드 글 그대로", { scope: "restylePilotSections", message: e instanceof Error ? e.message : String(e) });
    return args.composed;
  }
}
