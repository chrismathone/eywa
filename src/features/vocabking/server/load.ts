import "server-only";

/**
 * 보카킹 종합평가 리포트 **재료 모으기** — 응시 한 건(설명서 3번) + 그 학생의 최근 30학습일(4번) + 같은 시험 응시자(6번)
 * + aywa 짝(이름·학년).
 *
 * 🔴 게이트는 결과지 창과 **같은 함수**(`getJjAttempt`) — 강사는 자기 학생 응시만, 남의 학생·없는 응시는 missing(#77).
 * 🔑 학습·응시자 조회는 **부가 재료**다 — 실패해도 리포트는 선다(그 블록만 빠진다). 결과지(필수)만 실패하면 오류.
 * 🔑 세 조회는 서로 기다리지 않는다(B4).
 */
import { getJjAttempt } from "@/features/ijw/server/sheet-queries";
import { IJW_SCHEMAS } from "@/features/ijw/contract";
import { IJW_PATHS, ijwGet, type IjwFailure } from "@/features/ijw/server/client";
import { loadLinkIndex, type AywaLink } from "@/features/ijw/server/links";
import type { JjViewer } from "@/features/ijw/server/viewer";
import { buildVocabkingReport, kstDate, type VocabkingPeer, type VocabkingReport } from "../model";

export type VocabkingPage =
  | { state: "ok"; report: VocabkingReport; aywa: AywaLink | null; attemptId: string }
  | { state: "missing" }
  | { state: "error"; failure: IjwFailure };

/** 학습 기록 범위 — 시험 날까지 30학습일. */
const STUDY_DAYS = 30;

function shiftYmd(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

export async function getVocabkingReport(viewer: JjViewer, attemptId: string): Promise<VocabkingPage> {
  const att = await getJjAttempt(viewer, attemptId);
  if (att.state !== "ok") return att;
  const { exam, aywa } = att;
  const to = kstDate(exam.submittedAt);
  const [study, deck, links] = await Promise.all([
    to ? ijwGet(viewer.tenantId, IJW_PATHS.study(exam.student.id, shiftYmd(to, -(STUDY_DAYS - 1)), to), IJW_SCHEMAS.study) : null,
    ijwGet(viewer.tenantId, IJW_PATHS.deckResults(exam.deck.id), IJW_SCHEMAS.deckResults),
    loadLinkIndex(viewer.tenantId),
  ]);

  // 응시자 — 학생마다 가장 최근 응시 한 건(같은 시험을 두 번 본 학생이 평균을 두 번 끌지 않게).
  let peers: VocabkingPeer[] | null = null;
  if (deck.ok) {
    const latest = new Map<string, (typeof deck.data.results)[number]>();
    for (const r of deck.data.results) {
      const cur = latest.get(r.ijwId);
      if (!cur || r.submittedAt > cur.submittedAt) latest.set(r.ijwId, r);
    }
    peers = [...latest.values()].map((r) => ({
      ijwId: r.ijwId,
      score: r.score,
      elapsedMs: r.elapsedMs,
      grade: links.byIjw.get(r.ijwId)?.grade ?? null,
    }));
  }

  const report = buildVocabkingReport({
    exam,
    study: study && study.ok ? study.data : null,
    student: { name: aywa?.name ?? (exam.student.name || exam.student.id), grade: aywa?.grade ?? null },
    peers,
  });
  return { state: "ok", report, aywa, attemptId };
}
