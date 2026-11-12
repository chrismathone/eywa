"use client";

import { useState } from "react";
import type { ConsultationsSettings } from "@/features/owner/settings-types";
import { BRIEF_FACT_MAX, BRIEF_FACT_TOPICS, briefFactText } from "@/features/enrollment/brief-facts";
import { SectionForm, SettingsCard } from "./section-form";
import { TextAreaField } from "./fields";
import { ConsultationTemplateEditor } from "./list-editors";

/**
 * 상담 양식 면 — 원생상담 양식 + 신규 콜&상담 상담 준비 브리프의 학원 운영 안내(2026-11-12).
 * `briefOn` = 이 지점에서 브리프가 도는가(AI 라이선스). 꺼진 지점엔 운영 안내 카드를 세우지 않는다(값은 state에 남아 그대로 저장된다).
 */
export function ConsultationsSection({
  initial,
  readOnly = false,
  briefOn = true,
}: {
  initial: ConsultationsSettings;
  readOnly?: boolean;
  briefOn?: boolean;
}) {
  // 🔴 한 섹션은 통째로 저장된다 — 양식 편집과 운영 안내가 같은 state를 고쳐야 서로를 지우지 않는다.
  const [c, setC] = useState<ConsultationsSettings>(initial);

  return (
    <SectionForm section="consultations" payload={c} readOnly={readOnly}>
      <SettingsCard
        title="상담 양식"
        description="원생상담 등록 화면에서 요약란에 자동으로 채워지는 양식(뼈대)입니다. 기본양식을 지정하면 새 상담이 그 양식으로 시작하고, 상담사가 다른 양식이나 무양식으로 바꿀 수 있습니다. 뼈대에 {{날짜}}·{{담당}} 같은 치환 태그를 넣으면 등록 시 실제 값으로 자동 입력됩니다."
      >
        <ConsultationTemplateEditor
          value={c.templates}
          onChange={(templates) => setC((prev) => ({ ...prev, templates }))}
        />
      </SettingsCard>

      {/* 소비처 = 신규 콜&상담 상담 준비 브리프(사실 수집 prep-facts.ts → 브리프 화면 '학원 운영 안내' · 브리프 인쇄 · 프롬프트). */}
      {briefOn ? (
        <SettingsCard
          title="상담 준비 브리프 — 학원 운영 안내"
          description="학부모가 '학원에 바라는 것'으로 자주 고르는 항목입니다. 적은 글은 신규 콜&상담 상담 준비 브리프에 그대로 실려 상담사가 읽고 안내합니다. 실제로 하는 것만 대상·주기·횟수·조건과 함께 적어 주세요. 빈칸은 안내하지 않습니다. 브리프를 만들 때 이 글도 AI에 함께 보내므로 계좌·연락처 같은 개인정보는 적지 마세요. 바꾼 내용은 브리프를 다시 작성할 때부터 반영됩니다."
          span2
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {BRIEF_FACT_TOPICS.map((t) => {
              const value = briefFactText(c.briefFacts?.[t.key]);
              return (
                <TextAreaField
                  key={t.key}
                  label={t.label}
                  hint={`${value.length}/${BRIEF_FACT_MAX}자 · 전 과목 공통`}
                  rows={3}
                  maxLength={BRIEF_FACT_MAX}
                  value={value}
                  onChange={(v) => setC((prev) => ({ ...prev, briefFacts: { ...prev.briefFacts, [t.key]: v } }))}
                />
              );
            })}
          </div>
        </SettingsCard>
      ) : null}
    </SectionForm>
  );
}
