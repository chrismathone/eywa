import type { VocabkingReport } from "../model";
import { VkHeader, VkPosition } from "./vk-position";
import { VkScore } from "./vk-score";
import { VkCompetency } from "./vk-competency";
import { VkAdvice } from "./vk-advice";
import { VkNext } from "./vk-next";

/**
 * **보카킹 종합평가 리포트** — 원장 정리안의 5단(① 현재 학습 위치 → ② 어휘 역량 → ③ 어휘 세부 → ④ 강점·보완 → ⑤ 다음 학습)
 * + 학습 습관. 값은 전부 `buildVocabkingReport`(model.ts)가 만든다 — 여기는 그리기만.
 * ⚠️ 1차 구현(2026-10-07, 시안 확인용) — 수업보고서·학부모 카드엔 아직 안 붙였다. 선생님 코멘트는 붙일 때 보고서에서 받는다.
 * ⚠️ 컨테이너 쿼리(@md/@lg) — 창 폭에 따라 단이 접힌다(창 = iframe이라 화면 폭이 아니라 틀 폭을 본다).
 */
export function VocabkingReportView({ report }: { report: VocabkingReport }) {
  return (
    <article className="bg-card shadow-card @container flex flex-col gap-6 rounded-2xl px-6 py-6">
      <VkHeader report={report} />
      <VkScore report={report} />
      <VkPosition report={report} />
      <VkCompetency report={report} />
      <VkAdvice report={report} />
      <VkNext report={report} />
      <footer className="border-line text-text-faint border-t pt-3 text-center text-xs">VOCABKING · Words Make Your Future</footer>
    </article>
  );
}
