import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateJSON } from "@/lib/ai/generate";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { reportWarning } from "@/lib/observability/report-error";
import {
  MENT_STYLE_EXCLUDED_SUBJECTS,
  MENT_STYLE_MAX_EDITED,
  MENT_STYLE_MAX_SAMPLES,
  MENT_STYLE_MIN_SAMPLES,
  MENT_STYLE_WINDOW_DAYS,
  corpusUntil,
  isMentStyleTableMissingError,
  keepRecurringPhrases,
  parseMentStyleProfile,
  pickStyleSamples,
  profileMentionsAny,
  styleCorpusHash,
  type StyleSampleRow,
} from "../ment-style";
import { MENT_STYLE_PROMPT_VERSION, buildMentStylePrompt } from "../ment-style-prompt";

/**
 * 강사별 말투 프로파일(0262a) — **빌드**. cron(주 1회)과 학원설정 [지금 갱신]이 같은 함수를 부른다.
 * 🔴 admin 클라이언트 전용 → 모든 조회·쓰기에 tenant_id 명시 필터. 🔴 표가 없으면 `tableMissing`([[#95]]).
 */

export type RebuildOutcome = "built" | "unchanged" | "insufficient" | "rejected" | "failed";
export type RebuildSummary = {
  tableMissing: boolean;
  /** 강사별 결과 — 감사로그·화면 토스트가 그대로 쓴다. reason은 내부용(감사로그) — 화면은 한글 요약으로 바꿔 보인다. */
  teachers: { teacherId: string; teacherName: string; outcome: RebuildOutcome; samples: number; reason?: string }[];
};

type CorpusRow = { id: string; notes: string | null; created_at: string; student_id: string | null };

/** 코퍼스 밖 과목을 거르는 PostgREST 필터 — subject가 비어 있는 옛 행은 남긴다(`neq`만 걸면 null까지 빠진다). `not.in`이라 키가 둘 이상이어도 AND다. */
const subjectFilter = `subject.not.in.(${MENT_STYLE_EXCLUDED_SUBJECTS.join(",")}),subject.is.null`;

/** 한 강사의 표본을 출처별로 읽는다(창 안·최신 순). 상한은 pickStyleSamples가 다시 자르므로 여기선 넉넉히 받는다. */
async function fetchTeacherCorpus(admin: SupabaseClient, tenantId: string, teacherId: string, since: string): Promise<StyleSampleRow[]> {
  const pull = async (source: "manual" | "auto_edited", limit: number) => {
    const { data, error } = await admin
      .from("lesson_reports")
      .select("id, notes, created_at, student_id")
      .eq("tenant_id", tenantId)
      .eq("created_by", teacherId)
      .eq("ment_source", source)
      .or(subjectFilter)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id")
      .limit(limit);
    if (error) throw new Error(`코퍼스 조회 실패(${source}): ${error.message}`);
    return ((data ?? []) as CorpusRow[]).map<StyleSampleRow>((r) => ({ id: r.id, notes: r.notes, source, createdAt: r.created_at, studentId: r.student_id }));
  };
  // 두 출처는 서로 독립 — 직렬 금지(B4). 중복·짧은 조각이 걸러진 뒤에도 상한이 차게 여유를 둔다.
  const [manual, edited] = await Promise.all([pull("manual", MENT_STYLE_MAX_SAMPLES + 20), pull("auto_edited", MENT_STYLE_MAX_EDITED * 2)]);
  return [...manual, ...edited];
}

/**
 * 테넌트의 강사 전원 프로파일을 다시 접는다.
 *
 * 흐름: 창 안에서 라벨 있는 멘트를 쓴 계정 집합(컬럼 하나만 페이징) → 강사마다 표본 읽기 → 지문(표본 + 프롬프트 버전)이 저장값과
 * 같으면 건너뜀(AI 0회) → AI → 검증(모양 · 되풀이 표현만 · 이름 유출) → upsert. 강사 한 명의 실패가 다음 강사를 막지 않는다.
 * 🔴 **동시성 3 + 시간 예산** — 직렬로 돌리면 AI가 느린 주(폴백 provider·[[#118]])에 cron 상한을 넘겨 뒤 강사는 미처리·감사로그도
 *    안 남는다. 예산이 다하면 남은 강사를 '시간 초과'로 적고 **돌아와서 로그를 남긴다**(다음 갱신이 이어 받는다).
 * 🔴 표본 부족(MIN 미만)이면 **기존 행을 지우지 않는다** — 창이 굴러 표본이 줄어도 마지막 프로파일은 남는다.
 * ⚠️ 역할을 가리지 않는다 — 원스크린에서 직접 쓴 사람이면 관리자 계정도 제 코퍼스로 프로파일이 생긴다(소비는 강사 스코프가 있을 때만).
 */
export async function rebuildTenantMentStyles(
  admin: SupabaseClient,
  tenantId: string,
  opts: { builtBy: string; budgetMs: number; force?: boolean; concurrency?: number },
): Promise<RebuildSummary> {
  const startedAt = Date.now();
  const since = new Date(startedAt - MENT_STYLE_WINDOW_DAYS * 86_400_000).toISOString();

  // 저장된 지문 — 표가 없으면 여기서 멈춘다(미적용 = 아직 안 켜짐).
  const existing = await admin.from("teacher_ment_styles").select("teacher_id, corpus_hash").eq("tenant_id", tenantId);
  if (existing.error) {
    if (isMentStyleTableMissingError(existing.error)) return { tableMissing: true, teachers: [] };
    throw new Error(`프로파일 조회 실패: ${existing.error.message}`);
  }
  const storedHash = new Map((existing.data ?? []).map((r) => [r.teacher_id as string, r.corpus_hash as string]));

  // 창 안에서 라벨 있는 멘트를 쓴 계정 — 세려고 전건을 받지 않는다(B2): 컬럼 하나만, 페이징.
  const authors = await fetchAllPaged<{ created_by: string | null }>((from, to) =>
    admin
      .from("lesson_reports")
      .select("created_by")
      .eq("tenant_id", tenantId)
      .in("ment_source", ["manual", "auto_edited"])
      .not("created_by", "is", null)
      .or(subjectFilter)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to),
  );
  const teacherIds = [...new Set(authors.map((a) => a.created_by).filter((v): v is string => !!v))];
  if (teacherIds.length === 0) return { tableMissing: false, teachers: [] };

  const users = await fetchInChunks(teacherIds, (chunk) => admin.from("users").select("id, display_name").eq("tenant_id", tenantId).in("id", chunk));
  const nameOf = new Map(users.map((u) => [u.id as string, (u.display_name as string | null) ?? ""]));

  const teachers: RebuildSummary["teachers"] = [];
  const one = async (teacherId: string) => {
    const teacherName = nameOf.get(teacherId) || "(이름 없음)";
    try {
      const samples = pickStyleSamples(await fetchTeacherCorpus(admin, tenantId, teacherId, since));
      if (samples.length < MENT_STYLE_MIN_SAMPLES) return teachers.push({ teacherId, teacherName, outcome: "insufficient", samples: samples.length });
      const hash = styleCorpusHash(samples, MENT_STYLE_PROMPT_VERSION);
      if (!opts.force && storedHash.get(teacherId) === hash) return teachers.push({ teacherId, teacherName, outcome: "unchanged", samples: samples.length });
      // 이름 유출 검사 재료 — 표본에 나온 학생들의 이름(한 번에).
      const studentIds = [...new Set(samples.map((s) => s.studentId).filter((v): v is string => !!v))];
      const students = await fetchInChunks(studentIds, (chunk) => admin.from("students").select("id, name").eq("tenant_id", tenantId).in("id", chunk));
      const names = students.map((s) => (s.name as string | null) ?? "").filter(Boolean);

      const { data, model } = await generateJSON<Record<string, unknown>>({
        prompt: buildMentStylePrompt(samples),
        maxTokens: 1200,
        meta: { tenantId, feature: "ment_style_profile" },
      });
      const parsed = parseMentStyleProfile(data);
      if (!parsed) return teachers.push({ teacherId, teacherName, outcome: "rejected", samples: samples.length, reason: "응답 모양이 맞지 않음" });
      const profile = keepRecurringPhrases(parsed, samples);
      const leaked = profileMentionsAny(profile, names);
      if (leaked.length) {
        reportWarning("강사 말투 프로파일에 학생 이름이 새어 저장하지 않음", { scope: "rebuildTenantMentStyles", teacherId, leaked });
        return teachers.push({ teacherId, teacherName, outcome: "rejected", samples: samples.length, reason: "학생 이름이 섞임" });
      }
      const manualCount = samples.filter((s) => s.source === "manual").length;
      const now = new Date().toISOString();
      const { error } = await admin.from("teacher_ment_styles").upsert(
        {
          tenant_id: tenantId,
          teacher_id: teacherId,
          profile,
          sample_count: samples.length,
          manual_count: manualCount,
          edited_count: samples.length - manualCount,
          corpus_hash: hash,
          corpus_until: corpusUntil(samples),
          model,
          built_by: opts.builtBy,
          built_at: now,
          updated_at: now,
        },
        { onConflict: "tenant_id,teacher_id" },
      );
      if (error) throw new Error(`저장 실패: ${error.message}`);
      return teachers.push({ teacherId, teacherName, outcome: "built", samples: samples.length });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      reportWarning("강사 말투 프로파일 갱신 실패", { scope: "rebuildTenantMentStyles", teacherId, message: reason });
      return teachers.push({ teacherId, teacherName, outcome: "failed", samples: 0, reason });
    }
  };

  // 작은 풀 — 다음 강사를 집기 전에 예산을 보고, **진행 중인 한 명도 남은 예산에서 끊는다**(AI 호출엔 타임아웃이 없어 폴백 provider가
  // 느린 주엔 한 콜이 1분을 넘긴다 — 예산을 지켰는데 함수가 죽으면 감사로그가 안 남는다). 끊긴 강사는 '시간 예산 초과'로 적고
  // 다음 갱신이 잇는다(뒤늦게 끝난 호출이 upsert해도 같은 표본의 같은 프로파일이라 해롭지 않다).
  const deadlineAt = startedAt + opts.budgetMs;
  const timedOut = (id: string) => teachers.push({ teacherId: id, teacherName: nameOf.get(id) || "(이름 없음)", outcome: "failed", samples: 0, reason: "시간 예산 초과 — 다음 갱신에 이어서" });
  const queue = [...teacherIds];
  const workers = Array.from({ length: Math.min(opts.concurrency ?? 3, queue.length) }, async () => {
    while (queue.length) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        for (const id of queue.splice(0)) timedOut(id);
        return;
      }
      const id = queue.shift()!;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), remaining);
      });
      const result = await Promise.race([one(id).then(() => "done" as const), late]);
      clearTimeout(timer);
      if (result === "timeout") timedOut(id);
    }
  });
  await Promise.all(workers);
  return { tableMissing: false, teachers };
}

/** 감사로그·응답용 집계 — "갱신 2 · 변동 없음 4 · 표본 부족 1". */
export function summarizeRebuild(summary: RebuildSummary): Record<RebuildOutcome, number> {
  const out: Record<RebuildOutcome, number> = { built: 0, unchanged: 0, insufficient: 0, rejected: 0, failed: 0 };
  for (const t of summary.teachers) out[t.outcome]++;
  return out;
}
