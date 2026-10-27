/**
 * 보고서에 실린 **인재원 자료 동결본** — 모양·읽기·그림 자리 가용성. 순수 모듈(Vitest로 잠금).
 *
 * 인재원 설명서 ⑤: *"보내는 순간 받은 JSON을 보고서와 함께 저장할 것 — 나중에 /r을 열어도 같은 내용이 보이고
 * 인재원 상태와 무관해진다."* 그 저장본의 모양이 여기 한 곳이다(표 = 0261a `report_jj_snapshots.payload`).
 * 🔑 인재원 데이터를 aywa에 복제·동기화하는 것이 **아니다**(결정 로그가 금지) — 보고서 한 장에 묶인 동결본이다.
 * 🔴 다시 읽을 때도 받을 때와 같은 엄격 검사를 지난다(contract.ts) — 모양이 어긋난 저장본은 **그림을 안 그린다**
 *    (0으로 채운 그럴듯한 그림이 학부모에게 나가는 것보다 빈 자리가 낫다).
 */
import { z } from "zod";
import type { ImageSlotKey } from "@/features/report-templates/image-slots";
import { IJW_SHAPES, type IjwDay, type IjwExamResult, type IjwStanding, type IjwStudy } from "./contract";

export type JjReportSnapshot = {
  v: 1;
  /** 보고서 날짜(YYYY-MM-DD) — 시험은 이 KST 달력 날짜의 응시 전부, 학습은 이 날까지 30학습일. */
  date: string;
  ijwId: string;
  /** 인재원에서 받은 시각(ISO). */
  fetchedAt: string;
  study: IjwStudy | null;
  exams: IjwExamResult[];
  /**
   * 강사가 고른 결과지(응시 id, 고른 순서) — 2026-09-28 원장 *"어떤 시험인지 선택"*. `null`·없음 = 기본(그날 KST 달력
   * 날짜에 낸 응시 전부 — 종전 동작). 있으면 `exams`는 **고른 응시**다(다른 날 본 시험도 된다 — 보카킹 월례 시험을 며칠 뒤 보고서에).
   */
  pick?: string[] | null;
  /** 단어 순위·학습 배지(2026-10-26, 인재원 선택 필드) — 없으면 그 그림 자리가 빠진다. 옛 저장본엔 없다. */
  standing?: IjwStanding | null;
};

const SnapshotSchema = z.object({
  v: z.literal(1),
  date: z.string(),
  ijwId: z.string(),
  fetchedAt: z.string(),
  study: IJW_SHAPES.study.nullable(),
  exams: z.array(IJW_SHAPES.examResult),
  pick: z.array(z.string()).nullable().optional().catch(null),
  // 어긋난 순위 자료는 그 자리만 비운다(결과지·분석지까지 안 그리게 만들지 않는다).
  standing: IJW_SHAPES.standing.nullable().optional().catch(null),
});

/** 저장본 → 동결본. 모양이 어긋나면 null(그림을 안 그린다). */
export function parseJjSnapshot(raw: unknown): JjReportSnapshot | null {
  const parsed = SnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/**
 * 5번 하루치 응답 → 저장할 동결본. `picked`를 주면(강사가 고른 결과지) 시험은 그것으로 갈아 끼운다 — 학습(study)은
 * 고르기와 무관하게 하루치 그대로다.
 */
export function snapshotFromDay(
  day: IjwDay,
  fetchedAt: string,
  picked?: { pick: string[]; exams: IjwExamResult[] } | null,
): JjReportSnapshot {
  return {
    v: 1,
    date: day.date,
    ijwId: day.ijwId,
    fetchedAt,
    study: day.study ?? null,
    exams: picked ? picked.exams : day.exams,
    // 기본이면 키를 아예 안 싣는다 — 고르기 전과 같은 저장본(읽을 땐 없음 = 기본).
    ...(picked ? { pick: picked.pick } : {}),
    // 인재원이 실어 줬을 때만 — 없으면 키를 안 실어 옛 저장본과 같은 모양.
    ...(day.standing ? { standing: day.standing } : {}),
  };
}

/** 한 번에 고를 수 있는 결과지 수 — 카드가 한없이 길어지지 않게, 인재원 호출도 그만큼만. */
export const JJ_PICK_MAX = 6;

/** 받은 고르기 값을 정리한다 — 문자열만·중복 제거·상한. 빈 배열은 "하나도 안 붙임"이라 그대로 둔다. */
export function normalizeJjPick(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") continue;
    const id = v.trim();
    if (id && id.length <= 64 && !out.includes(id)) out.push(id);
    if (out.length >= JJ_PICK_MAX) break;
  }
  return out;
}

/**
 * 그림 자리마다 **그릴 게 있는가** — 없으면 템플릿의 그 줄이 빠진다(빈 그림·0으로 가득한 그림 대신).
 * - 시험결과지: 그날 낸 응시가 한 건이라도 있을 때.
 * - 학습분석지: 30학습일 동안 푼 문제나 본 시험이 하나라도 있을 때.
 * - 단어백분위: 누적·장기기억 단어 중 하나라도 비교(학년·반)가 실려 있을 때(숫자만 있고 비교가 없으면 '백분위'가 아니다).
 * - 학습배지: 배지가 있을 때(아직 통과한 과정이 없으면 빠진다 — "배지 없음"을 학부모에게 내보내지 않는다).
 */
export function slotAvailability(snap: JjReportSnapshot | null | undefined): Record<ImageSlotKey, boolean> {
  return {
    시험결과지: !!snap && snap.exams.length > 0,
    학습분석지: !!snap?.study && (snap.study.totals.answers > 0 || snap.study.exams.length > 0),
    단어백분위: [snap?.standing?.seenWords, snap?.standing?.longTermWords].some((m) => !!m && (!!m.grade || !!m.class)),
    학습배지: !!snap?.standing?.badge,
  };
}
