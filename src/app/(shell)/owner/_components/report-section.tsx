"use client";

import { useState } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import { SectionForm, SettingsCard } from "./section-form";
import { TextField, ToggleField } from "./fields";

/**
 * 학원 운영 > 보고서 — 학부모 보고서(/r)·ClassNote 게시 이미지의 표시 설정.
 * notifications-section 패턴(로컬 state + SectionForm이 저장 배관 담당). /r 페이지가 이 값을 읽어 렌더.
 */
export function ReportSection({ initial }: { initial: ReportSettings }) {
  const [r, setR] = useState<ReportSettings>(initial);
  const set = (patch: Partial<ReportSettings>) => setR((prev) => ({ ...prev, ...patch }));

  return (
    <SectionForm section="report" payload={r}>
      {/* 좌열: 머리글+바닥글(세로 스택) · 우열: 표시 항목. items-stretch로 우측 카드를 좌측 높이에 맞춰 늘려
          내용이 짧아도 카드가 열을 끝까지 채운다(우측 하단 빈 배경 제거). */}
      <div className="grid items-stretch gap-4 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <SettingsCard
            title="머리글"
            description="보고서 상단 로고·학원명·제목. 로고 이미지에 학원명이 이미 있으면 '학원명 표시'를 꺼서 중복을 없앨 수 있습니다."
          >
            <div className="space-y-1">
              <ToggleField label="로고 표시" value={r.showLogo} onChange={(v) => set({ showLogo: v })} />
              <ToggleField
                label="학원명(텍스트) 표시"
                hint="로고에 이름이 있으면 끄기"
                value={r.showAcademyName}
                onChange={(v) => set({ showAcademyName: v })}
              />
              <div className="pt-2">
                <TextField
                  label="보고서 제목"
                  value={r.title}
                  onChange={(v) => set({ title: v })}
                  placeholder="수업 보고서"
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard title="바닥글" description="보고서 하단 문구. 비우면 '학원명 · 날짜'가 표시됩니다.">
            <div className="space-y-1">
              <ToggleField label="바닥글 표시" value={r.showFooter} onChange={(v) => set({ showFooter: v })} />
              <div className="pt-2">
                <TextField
                  label="바닥글 문구"
                  hint="비우면 학원명·날짜"
                  value={r.footerNote}
                  onChange={(v) => set({ footerNote: v })}
                />
              </div>
            </div>
          </SettingsCard>

          <SettingsCard
            title="테스트 문항수"
            description="일일·확인테스트 만점(/N)은 과목별로 설정합니다(학원 운영 > 과목). 아래를 켜면 강사가 원스크린에서 직접 바꿀 수 있습니다."
          >
            <ToggleField
              label="강사가 문항수 직접 변경 허용"
              hint="끄면 과목 설정값 고정"
              value={r.allowTeacherTestMax}
              onChange={(v) => set({ allowTeacherTestMax: v })}
            />
          </SettingsCard>
        </div>

        <SettingsCard
          title="표시 항목"
          description="학부모 보고서에 표시할 항목을 켜고 끕니다. 끈 항목은 보고서에서 숨겨집니다."
        >
          {/* 세로 목록 + 행 구분선 — 좁은 열에서 라벨↔체크박스 간격을 좁혀 빈 공간 제거. */}
          <div className="border-border divide-border divide-y rounded-md border">
            {(
              [
                ["교재명", "showTextbook"],
                ["진도", "showProgress"],
                ["일일테스트", "showDailyTest"],
                ["확인테스트", "showCheckTest"],
                ["과제", "showHomework"],
                ["수업 태도", "showAttitude"],
                ["학부모 전달 내용", "showParentNote"],
                ["학생 사진 첨부", "showAttachments"],
              ] as const
            ).map(([label, key]) => (
              <div key={key} className="px-3">
                <ToggleField
                  label={label}
                  value={r[key]}
                  onChange={(v) => set({ [key]: v } as Partial<ReportSettings>)}
                />
              </div>
            ))}
          </div>
        </SettingsCard>
      </div>
    </SectionForm>
  );
}
