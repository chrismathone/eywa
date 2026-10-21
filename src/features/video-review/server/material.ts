import "server-only";
import { formatMaterial, speechStats, type SpeechStats } from "../harness/transcript";
import { REVIEW_BUCKET } from "../storage-paths";
import { db, type ReviewRow } from "./rows";

export type Material = {
  text: string;
  labels: string[];
  images: { mediaType: "image/jpeg"; dataBase64: string; label: string }[];
  speech: SpeechStats;
};

/** 학년·최근 진도(참고용) — 그 영상의 학생 학년 + 숙제일 이전 마지막 영상 과제 보고서의 진도. 못 읽으면 비워 둔다. */
async function contextOf(row: ReviewRow): Promise<{ grade: string | null; progress: string | null }> {
  const { data: video } = await db().from("homework_video_ledger_videos")
    .select("student_id,route,created_at").eq("tenant_id", row.tenant_id).eq("id", row.video_id).maybeSingle();
  const studentId = (video?.student_id as string | null) ?? null;
  if (!studentId) return { grade: null, progress: null };
  const route = (video?.route ?? {}) as { classId?: unknown; homeworkDate?: unknown };
  const until = typeof route.homeworkDate === "string" ? route.homeworkDate : String(video?.created_at ?? "").slice(0, 10);
  const [student, report] = await Promise.all([
    db().from("students").select("grade").eq("tenant_id", row.tenant_id).eq("id", studentId).maybeSingle(),
    (() => {
      let q = db().from("lesson_reports").select("progress").eq("tenant_id", row.tenant_id).eq("student_id", studentId)
        .eq("video_homework", true).lte("report_date", until);
      if (typeof route.classId === "string") q = q.eq("class_id", route.classId);
      return q.order("report_date", { ascending: false }).limit(1).maybeSingle();
    })(),
  ]);
  return { grade: (student.data?.grade as string | null) ?? null, progress: (report.data?.progress as string | null) ?? null };
}

/** 요청 크기 추정(배치 상한 계산용) — base64 화면 + 글. */
export function materialBytes(m: Material): number {
  return m.text.length * 3 + m.images.reduce((a, i) => a + i.dataBase64.length + i.label.length, 0);
}

/** 판정 자료 — 전사(사전 보정 포함)·말하기 자료 + 화면 이미지(시간 순, 마지막 고해상도 화면은 맨 끝). */
export async function loadMaterial(row: ReviewRow): Promise<Material> {
  if (!row.assets || !row.transcript) throw new Error("소리·화면 또는 전사가 아직 준비되지 않았습니다");
  const ctx = await contextOf(row);
  const frames = [...row.assets.frames].sort((a, b) => a.label.localeCompare(b.label));
  const images = await Promise.all(frames.map(async (f) => {
    const { data, error } = await db().storage.from(REVIEW_BUCKET).download(f.path);
    if (error || !data) throw new Error(`화면 파일을 읽지 못했습니다(${f.label})`);
    return { mediaType: "image/jpeg" as const, dataBase64: Buffer.from(await data.arrayBuffer()).toString("base64"), label: f.label };
  }));
  const words = row.transcript.words;
  return {
    text: formatMaterial({ words, durationSec: row.assets.durationSec, grade: ctx.grade, progress: ctx.progress }),
    labels: frames.map((f) => f.label),
    images,
    speech: speechStats(words),
  };
}
