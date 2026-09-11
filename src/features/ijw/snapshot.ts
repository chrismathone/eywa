/**
 * 보고서에 실린 **인재원 자료 동결본** — 모양·읽기·그림 자리 가용성. 순수 모듈(Vitest로 잠금).
 *
 * 인재원 설명서 ⑤: *"보내는 순간 받은 JSON을 보고서와 함께 저장할 것 — 나중에 /r을 열어도 같은 내용이 보이고
 * 인재원 상태와 무관해진다."* 그 저장본의 모양이 여기 한 곳이다(표 = 0261a `report_jj_snapshots.payload`).
 * 🔑 인재원 데이터를 eywa에 복제·동기화하는 것이 **아니다**(결정 로그가 금지) — 보고서 한 장에 묶인 동결본이다.
 * 🔴 다시 읽을 때도 받을 때와 같은 엄격 검사를 지난다(contract.ts) — 모양이 어긋난 저장본은 **그림을 안 그린다**
 *    (0으로 채운 그럴듯한 그림이 학부모에게 나가는 것보다 빈 자리가 낫다).
 */
import { z } from "zod";
import type { ImageSlotKey } from "@/features/report-templates/image-slots";
import { IJW_SHAPES, type IjwDay, type IjwExamResult, type IjwStudy } from "./contract";

export type JjReportSnapshot = {
  v: 1;
  /** 보고서 날짜(YYYY-MM-DD) — 시험은 이 KST 달력 날짜의 응시 전부, 학습은 이 날까지 30학습일. */
  date: string;
  ijwId: string;
  /** 인재원에서 받은 시각(ISO). */
  fetchedAt: string;
  study: IjwStudy | null;
  exams: IjwExamResult[];
};

const SnapshotSchema = z.object({
  v: z.literal(1),
  date: z.string(),
  ijwId: z.string(),
  fetchedAt: z.string(),
  study: IJW_SHAPES.study.nullable(),
  exams: z.array(IJW_SHAPES.examResult),
});

/** 저장본 → 동결본. 모양이 어긋나면 null(그림을 안 그린다). */
export function parseJjSnapshot(raw: unknown): JjReportSnapshot | null {
  const parsed = SnapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** 5번 하루치 응답 → 저장할 동결본. */
export function snapshotFromDay(day: IjwDay, fetchedAt: string): JjReportSnapshot {
  return { v: 1, date: day.date, ijwId: day.ijwId, fetchedAt, study: day.study ?? null, exams: day.exams };
}

/**
 * 그림 자리마다 **그릴 게 있는가** — 없으면 템플릿의 그 줄이 빠진다(빈 그림·0으로 가득한 그림 대신).
 * - 시험결과지: 그날 낸 응시가 한 건이라도 있을 때.
 * - 학습분석지: 30학습일 동안 푼 문제나 본 시험이 하나라도 있을 때.
 */
export function slotAvailability(snap: JjReportSnapshot | null | undefined): Record<ImageSlotKey, boolean> {
  return {
    시험결과지: !!snap && snap.exams.length > 0,
    학습분석지: !!snap?.study && (snap.study.totals.answers > 0 || snap.study.exams.length > 0),
  };
}
