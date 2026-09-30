import "server-only";
import { createClient } from "@/lib/supabase/server";
import { candidateKey, type ClassCandidate } from "../class-mapping";

/**
 * 0318a(원생상담 반 칸 + 반 후보·통계 RPC)가 DB에 있나 — SQL은 원장이 손으로 돌리므로 앱이 먼저 나가도 죽지 않게([[#95]]).
 *
 * 없다는 오류 모양: 칸 = 42703(Postgres)·PGRST204(스키마 캐시) · 임베드 관계 = PGRST200 · 함수 = PGRST202·42883.
 * 판정은 **이름까지** 본다 — 다른 칸이 없다는 오류(남의 마이그레이션)를 이 칸 탓으로 삼키면 진짜 장애가 가려진다.
 */
export function isMissingClassSchema(err: { code?: string; message?: string; details?: string; hint?: string } | null | undefined): boolean {
  if (!err) return false;
  const text = `${err.message ?? ""} ${err.details ?? ""} ${err.hint ?? ""}`;
  const codeHit = ["42703", "PGRST204", "PGRST200", "PGRST202", "42883"].includes(err.code ?? "") || /schema cache|does not exist|Could not find/i.test(text);
  return codeHit && /class_id|class_source|student_consultations_class_id_fkey|consultation_class_candidates|consultation_stats|consultation_gap_students|relationship between/i.test(text);
}

/**
 * 한 번 있다고 확인하면 다시 묻지 않고, 없으면 1분 동안은 새 칸을 안 싣는다 — 적용 전엔 목록을 열 때마다 실패 한 번 + 재시도
 * 한 번으로 왕복이 두 배가 되기 때문이다. 1분 뒤엔 다시 시도해 SQL을 적용한 순간부터 재배포 없이 켜진다.
 * ⚠️ 모듈 상태라 서버 인스턴스마다 따로 논다(각자 한 번씩 확인할 뿐 결과는 같다).
 */
let known = false;
let missingUntil = 0;
export function classSchemaWorthTrying(): boolean {
  return known || Date.now() >= missingUntil;
}
export function noteClassSchema(present: boolean): void {
  if (present) {
    known = true;
    return;
  }
  known = false;
  missingUntil = Date.now() + 60_000;
}

/**
 * 새 상담 폼이 '반' 칸을 그릴지 — 칸을 행 없이 물어본다(limit 0). 한 번 있으면 다시 묻지 않는다.
 * ⚠️ 칸 말고 다른 오류(일시 장애)면 있다고 본다 — 칸을 그려 두면 선택지 조회가 스스로 실패를 알린다.
 */
export async function hasClassSupport(): Promise<boolean> {
  if (known) return true;
  if (!classSchemaWorthTrying()) return false;
  const supabase = await createClient();
  const { error } = await supabase.from("student_consultations").select("class_id, class_source").limit(0);
  if (error && isMissingClassSchema(error)) {
    noteClassSchema(false);
    return false;
  }
  if (!error) noteClassSchema(true);
  return true;
}

/**
 * RPC 한 번에 싣는 (학생, 상담일) 쌍 수. 🔴 PostgREST는 **집합을 돌려주는 RPC에도 max-rows(1,000)를 건다** — 넘으면 에러 없이
 * 잘린다([[#54]]). 실측(2026-09-30): 200쌍 → 392행(쌍당 약 2행, 학생당 열린 수강 최대 4). 120쌍이면 최악 480행이라 한도의 절반이다.
 * 목록 한 쪽(≤120행)은 한 번, 엑셀 가져오기(수백~수천 행)는 여러 번으로 나뉜다.
 */
const CANDIDATE_CHUNK = 120;
/** 한 번의 응답이 이 행 수에 닿으면 잘렸을 수 있다 — 쌍을 반으로 쪼개 다시 묻는다(잘린 꼬리가 "그날 수강 반 없음"으로 굳는 것 방지). */
const MAX_ROWS_SUSPECT = 1000;

type CandidateRow = {
  student_id: string;
  on_date: string;
  class_id: string;
  class_name: string | null;
  subject: string | null;
  teacher_ids: string[] | null;
};

/**
 * (학생, 상담일) 쌍마다 그날의 반 후보 — 0318a RPC(배열은 POST 본문이라 URL 길이 무관, N+1 없음). 쌍이 많으면 120쌍씩 나눠 묻는다.
 * @returns 후보 Map, 또는 RPC가 아직 없으면 `null`(= 반 판정을 못 한다 — 화면은 칸을 숨기거나 '—').
 * ⚠️ RPC가 있는데 실패하면 throw — 조용히 빈 Map을 주면 "전부 미매핑"이라는 거짓 판정이 저장된다.
 */
export async function loadClassCandidatesRpc(
  pairs: readonly { studentId: string; date: string }[],
): Promise<Map<string, ClassCandidate[]> | null> {
  const uniq = [...new Map(pairs.filter((p) => p.studentId && /^\d{4}-\d{2}-\d{2}$/.test(p.date)).map((p) => [candidateKey(p.studentId, p.date), p])).values()];
  const out = new Map<string, ClassCandidate[]>();
  if (!classSchemaWorthTrying()) return null;
  if (uniq.length === 0) return out;
  const supabase = await createClient();
  /** 한 묶음 — 없으면 null(스키마 없음), 잘렸을 수 있으면 반으로 쪼개 다시. */
  const fetchChunk = async (chunk: readonly { studentId: string; date: string }[]): Promise<CandidateRow[] | null> => {
    const { data, error } = await supabase.rpc("consultation_class_candidates", {
      p_student_ids: chunk.map((p) => p.studentId),
      p_dates: chunk.map((p) => p.date),
    });
    if (error) {
      if (isMissingClassSchema(error)) return null;
      throw new Error(`반 후보 조회 실패: ${error.message}`);
    }
    const rows = (data ?? []) as CandidateRow[];
    if (rows.length < MAX_ROWS_SUSPECT || chunk.length === 1) return rows;
    const mid = Math.ceil(chunk.length / 2);
    const [left, right] = await Promise.all([fetchChunk(chunk.slice(0, mid)), fetchChunk(chunk.slice(mid))]);
    return left && right ? [...left, ...right] : null;
  };
  const chunks: (typeof uniq)[] = [];
  for (let i = 0; i < uniq.length; i += CANDIDATE_CHUNK) chunks.push(uniq.slice(i, i + CANDIDATE_CHUNK));
  // 묶음끼리는 서로 독립이라 함께 보낸다(B4) — 목록 한 쪽은 한 묶음이라 왕복 한 번이다.
  const results = await Promise.all(chunks.map(fetchChunk));
  if (results.some((r) => r === null)) {
    noteClassSchema(false);
    return null;
  }
  noteClassSchema(true);
  for (const r of results.flatMap((rows) => rows ?? [])) {
    const key = candidateKey(r.student_id, String(r.on_date).slice(0, 10));
    const list = out.get(key) ?? [];
    list.push({ classId: r.class_id, className: r.class_name, subject: r.subject, teacherIds: r.teacher_ids ?? [] });
    out.set(key, list);
  }
  return out;
}
