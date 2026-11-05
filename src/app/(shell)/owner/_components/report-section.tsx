"use client";

import { useId, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ReportSettings } from "@/features/owner/settings-types";
import { useSubjectMaps } from "@/features/owner/operations-context";
import { CLASSNOTE_SENDABLE_SUBJECTS } from "@/features/onescreen/classnote-guard";
import { SectionForm, SettingsCard } from "./section-form";
import { StringListEditor } from "./list-editors";
import { TextField, ToggleField } from "./fields";
import { BrandingField } from "./profile-section";
import { ClassnoteRouteField } from "./classnote-route-field";
import { ClassnoteReplyModeField } from "./classnote-reply-mode-field";
import { EyIcon } from "@/components/icons/aywa-icons";
import type { VideoHomeworkClassOption } from "@/features/video-homework/server/queries";
import { VideoHomeworkSettings } from "./video-homework-settings";

/**
 * '표시 항목' 토글 중 부연이 필요한 것만. showAttachments는 사진과 파일(pdf·엑셀·hwp·오디오)을 **한 스위치로
 * 함께** 켜고 끈다 — 별개로 보이지만 토글은 하나뿐이라, 사진만 끌 생각으로 내리면 파일까지 막힌다. 끄면 발송
 * 워커가 ClassNote 파일첨부 경로를 아예 안 타서 "발송은 성공인데 파일만 없음"이 된다(2026-07-21 실사례 —
 * 엑셀을 첨부했는데 게시글에 안 실림). 라벨만으론 그 범위가 안 보여 한 줄 부연.
 */
const SHOW_ITEM_HINTS: Partial<Record<string, string>> = {
  showAttachments: "사진과 파일을 함께 켜고 끕니다 · 끄면 첨부해도 학부모 보고서·ClassNote에 안 실립니다",
};
/** ClassNote 기능이 꺼진 학원의 같은 부연 — ClassNote를 말하지 않는다(2026-09-30 "꺼지면 흔적 없이"). */
const SHOW_ITEM_HINTS_NO_CN: Partial<Record<string, string>> = {
  showAttachments: "사진과 파일을 함께 켜고 끕니다 · 끄면 첨부해도 학부모 보고서에 안 실립니다",
};

const REPORT_TABS = [
  { key: "send", label: "발송" },
  { key: "video", label: "영상 제출" },
  { key: "display", label: "보고서 표시" },
  { key: "writing", label: "작성·집계" },
  { key: "exceptions", label: "발송 예외" },
] as const;
type ReportTab = (typeof REPORT_TABS)[number]["key"];
/** ClassNote 발송 전용 탭 — ClassNote 기능이 꺼진 학원엔 탭째 없다(2026-09-30 "꺼지면 흔적 없이"). */
const CLASSNOTE_REPORT_TABS: ReadonlySet<ReportTab> = new Set<ReportTab>(["send", "exceptions"]);

function ReportSettingsPanel({ tab, activeTab, id, children }: {
  tab: ReportTab; activeTab: ReportTab; id: string; children: ReactNode;
}) {
  // 입력 중인 새 보드명·반 검색어도 탭을 오가며 유지한다.
  return <div role="tabpanel" id={`${id}-panel-${tab}`} aria-labelledby={`${id}-tab-${tab}`}
    hidden={tab !== activeTab} tabIndex={0} className="focus-visible:outline-primary">
    {children}
  </div>;
}

/**
 * 학원 운영 > 보고서 — 학부모 보고서(/r)·ClassNote 게시 이미지의 표시 설정.
 * notifications-section 패턴(로컬 state + SectionForm이 저장 배관 담당). /r 페이지가 이 값을 읽어 렌더.
 */
export function ReportSection({
  initial,
  teachers = {},
  staffNames = [],
  videoClasses = [],
  classnoteOn = true,
  canEdit = true,
}: {
  initial: ReportSettings;
  /** 과목별 강사 라벨(작성률 예외 강사 칩 선택지) — 활성 직원으로 이미 필터됨(getReportTeacherCandidates). */
  teachers?: Record<string, string[]>;
  /** 활성 직원(users status≠inactive) 표시 이름 — orphan·집계 카운트를 실재 직원으로 좁히는 데 사용. */
  staffNames?: string[];
  videoClasses?: VideoHomeworkClassOption[];
  /** ClassNote 기능(모듈) 켜짐 — 꺼지면 '발송'·'발송 예외' 탭을 세우지 않는다(저장값은 그대로, 서버·워커가 모듈로 막는다). */
  classnoteOn?: boolean;
  canEdit?: boolean;
}) {
  const [r, setR] = useState<ReportSettings>(initial);
  const tabs = classnoteOn ? REPORT_TABS : REPORT_TABS.filter((t) => !CLASSNOTE_REPORT_TABS.has(t.key));
  const [activeTab, setActiveTab] = useState<ReportTab>(tabs[0].key);
  const tabsId = useId();
  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = tabs.findIndex((tab) => tab.key === activeTab);
    const next = event.key === "ArrowRight" ? (current + 1) % tabs.length
      : event.key === "ArrowLeft" ? (current + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setActiveTab(tabs[next].key);
    event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const set = (patch: Partial<ReportSettings>) => setR((prev) => ({ ...prev, ...patch }));
  // 작성률 예외 강사 토글 — 표시 이름 배열(강사별 작성률 표의 키와 동일).
  const toggleExempt = (name: string) =>
    set({
      writingExemptTeachers: r.writingExemptTeachers.includes(name)
        ? r.writingExemptTeachers.filter((n) => n !== name)
        : [...r.writingExemptTeachers, name],
    });
  // 발송 허용 과목 체크박스 — 학원 운영 과목(클라 단일 소스, 하드코딩 금지) 중 **발송 가능 과목만** 노출.
  // ClassNote 실보드 관례가 (수학)/(영어) 학생모드뿐이라, 매핑 없는 과목을 켜면 (수학) 보드 오게시로
  // 직결됐음(P0-3) — 화이트리스트(CLASSNOTE_SENDABLE_SUBJECTS) 밖 과목은 칩 자체를 안 보여준다.
  const subjects = useSubjectMaps();
  const sendableOptions = subjects.options.filter((o) =>
    (CLASSNOTE_SENDABLE_SUBJECTS as readonly string[]).includes(o.value),
  );
  const toggleSubject = (key: string) =>
    set({
      classnoteSubjects: r.classnoteSubjects.includes(key)
        ? r.classnoteSubjects.filter((k) => k !== key)
        : [...r.classnoteSubjects, key],
    });
  // 작성률 예외 강사 후보 — 과목 운영 순서(승인 과목 먼저), 승인 밖 키(레거시)는 뒤에(labelOf 폴백 표시).
  const exemptGroupKeys = [
    ...subjects.options.map((o) => o.value).filter((k) => (teachers[k] ?? []).length > 0),
    ...Object.keys(teachers).filter(
      (k) => !subjects.options.some((o) => o.value === k) && (teachers[k] ?? []).length > 0,
    ),
  ];
  // 저장돼 있지만 현재 반 담당 목록에 없는 이름 — 해제할 수 있게 별도 노출. 단 **활성 직원만**(staffSet):
  // 비직원 라벨(영어 닉네임·보조T 등)·퇴사자가 예외로 남아 있어도 orphan에 몰리지 않게 숨긴다(직원 목록 기준).
  // staffNames 미전달(빈 배열)이면 필터 안 함(하위호환) — 실사용 소비처(lesson-reports)는 항상 전달.
  const staffSet = staffNames.length > 0 ? new Set(staffNames) : null;
  const inStaff = (n: string) => staffSet === null || staffSet.has(n);
  const knownNames = new Set(Object.values(teachers).flat());
  const orphanExempt = r.writingExemptTeachers.filter((n) => !knownNames.has(n) && inStaff(n));
  // 집계 카운트도 화면에 보이는(직원) 예외만 — 숨긴 비직원 이름까지 세면 "N명" 과 칩 수가 안 맞아 혼란.
  const visibleExemptCount = r.writingExemptTeachers.filter(inStaff).length;

  return (
    <SectionForm section="report" payload={r} readOnly={!canEdit} header={
        <div role="tablist" aria-label="보고서 설정 분류" onKeyDown={onTabKeyDown}
          className="border-line bg-bg-soft/40 flex w-fit max-w-full flex-wrap gap-1 rounded-lg border p-1">
          {tabs.map((tab) => <button key={tab.key} type="button" role="tab"
            id={`${tabsId}-tab-${tab.key}`} aria-controls={`${tabsId}-panel-${tab.key}`}
            aria-selected={activeTab === tab.key} tabIndex={activeTab === tab.key ? 0 : -1}
            onClick={() => setActiveTab(tab.key)}
            className={`min-h-(--control-h) rounded-md px-3 py-1.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-primary ${
              activeTab === tab.key ? "bg-primary-soft text-primary" : "text-text-dim hover:bg-bg-soft hover:text-foreground"
            }`}>
            {tab.label}
          </button>)}
        </div>
    }>
      <div className="space-y-4">
        {classnoteOn ? (
        <ReportSettingsPanel tab="send" activeTab={activeTab} id={tabsId}>
          {/* ClassNote 실제 발송 스위치 — 오발송 안전장치. 기본 OFF(dry-run): 발송 버튼이 저장만 함.
              원장이 켜야 학부모에게 실제 전송(공유 DB+라이브 워커·이관분 오발송 방지). */}
          <div
            className={`mb-4 rounded-md border px-4 py-3 ${
              r.classnoteSendEnabled ? "border-primary bg-primary/5" : "border-danger bg-danger/5"
            }`}
          >
            <ToggleField
              label="ClassNote 실제 발송 사용"
              hint={
                r.classnoteSendEnabled
                  ? "켜짐 — 발송 버튼이 실제로 학부모에게 전송합니다"
                  : "지금은 dry-run — 발송 버튼을 눌러도 저장만 하고 실제 전송하지 않습니다"
              }
              value={r.classnoteSendEnabled}
              onChange={(v) => set({ classnoteSendEnabled: v })}
            />
            {!r.classnoteSendEnabled ? (
              <p className="text-danger mt-1.5 text-xs">
                안전을 위해 기본 꺼짐입니다. 실제 발송을 시작하려면 위 스위치를 켜세요(이관된 과거 보고서 오발송 방지).
              </p>
            ) : null}

            {/* 발송 허용 과목 — 체크한 과목만 학부모에게 발송(현 운영=수학만). 빈 목록이면 아무것도 발송 안 함. */}
            <div className="border-line mt-3 border-t pt-3">
              <p className="text-foreground text-sm font-bold">발송 과목</p>
              <p className="text-text-dim mt-0.5 text-xs">
                체크한 과목만 학부모에게 발송됩니다. 아무것도 고르지 않으면 발송되지 않습니다.
              </p>
              {sendableOptions.length === 0 ? (
                <p className="text-text-faint mt-2 text-xs">
                  발송 가능한 과목이 없습니다 — ClassNote 학생모드 보드가 있는 과목(수학·영어)만 발송할 수 있습니다.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  {sendableOptions.map((o) => {
                    const on = r.classnoteSubjects.includes(o.value);
                    return (
                      <button
                        key={o.value}
                        type="button"
                        onClick={() => toggleSubject(o.value)}
                        aria-pressed={on}
                        className={`rounded-full border px-3 py-1 text-sm transition ${
                          on
                            ? "border-primary bg-primary/10 text-primary font-bold"
                            : "border-line text-text-dim hover:bg-bg-soft"
                        }`}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              )}
              {r.classnoteSendEnabled && r.classnoteSubjects.length === 0 ? (
                <p className="text-danger mt-2 flex items-start gap-1.5 text-xs">
                  <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>발송이 켜져 있지만 선택된 과목이 없어 실제로는 아무것도 발송되지 않습니다. 발송할 과목을 선택하세요.</span>
                </p>
              ) : null}
            </div>

            {/* 발송 허용 시간대 — 밤 수업 보고서가 밤에 학부모 폰을 울리지 않게. 창 밖 발송분은 큐에 대기했다가
                창 진입 시 워커가 자동 발송(강사는 평소처럼 발송 버튼만). 둘 다 채워야 활성, 비우면 무제한. */}
            <div className="border-line mt-3 border-t pt-3">
              <p className="text-foreground text-sm font-bold">발송 허용 시간대</p>
              {/* ⚠️ "수업 보고서" 한정 명시 — 반 공지(classnote_notices)는 이 창을 안 탄다(발신자 명시 발송 = 즉시
                  게시가 의도). 무한정 "발송"이라 쓰면 같은 박스의 킬스위치·발송 과목이 공지에도 적용되는 것과 섞여
                  공지까지 미뤄진다고 오독됨(리뷰 확정 — 과약속 금지). */}
              <p className="text-text-dim mt-0.5 text-xs">
                <b>수업 보고서</b>는 이 시간대에만 학부모에게 발송됩니다. 시간대 밖에 발송한 보고서는 대기했다가 자동
                발송됩니다. 비우면 제한 없이 즉시 발송합니다. (반 공지는 이 설정과 무관하게 즉시 게시됩니다.)
              </p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="time"
                  className="border-line focus:border-primary rounded-md border bg-white px-2 py-1.5 text-sm outline-none"
                  value={r.classnoteSendWindowStart}
                  onChange={(e) => set({ classnoteSendWindowStart: e.target.value })}
                />
                <span className="text-text-faint text-xs">~</span>
                <input
                  type="time"
                  className="border-line focus:border-primary rounded-md border bg-white px-2 py-1.5 text-sm outline-none"
                  value={r.classnoteSendWindowEnd}
                  onChange={(e) => set({ classnoteSendWindowEnd: e.target.value })}
                />
                {(r.classnoteSendWindowStart || r.classnoteSendWindowEnd) && canEdit ? (
                  <button
                    type="button"
                    className="text-text-dim hover:text-foreground text-xs underline underline-offset-2"
                    onClick={() => set({ classnoteSendWindowStart: "", classnoteSendWindowEnd: "" })}
                  >
                    제한 없음으로
                  </button>
                ) : null}
              </div>
              {(r.classnoteSendWindowStart === "") !== (r.classnoteSendWindowEnd === "") ? (
                <p className="text-danger mt-2 flex items-start gap-1.5 text-xs">
                  <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>시작·종료를 둘 다 채워야 시간대 제한이 켜집니다. 하나만 채우면 제한 없이 동작합니다.</span>
                </p>
              ) : null}
              {/* 시작=종료도 조용히 무제한(fail-open) — 한쪽만 채움과 동일 계열인데 이 케이스만 침묵하면
                  원장이 "제한 켜짐"으로 오신뢰(리뷰 확정: 폼 도달 가능한 무경고 무제한은 이것뿐). */}
              {r.classnoteSendWindowStart &&
              r.classnoteSendWindowEnd &&
              r.classnoteSendWindowStart === r.classnoteSendWindowEnd ? (
                <p className="text-danger mt-2 flex items-start gap-1.5 text-xs">
                  <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
                  <span>시작과 종료가 같으면 제한 없이 동작합니다(즉시 발송). 시간대를 쓰려면 서로 다른 시각을 지정하세요.</span>
                </p>
              ) : null}
              {r.classnoteSendWindowStart &&
              r.classnoteSendWindowEnd &&
              r.classnoteSendWindowStart > r.classnoteSendWindowEnd ? (
                <p className="text-text-dim mt-2 text-xs">
                  종료가 시작보다 이르면 자정을 넘는 창으로 동작합니다(예 21:00~08:00 = 밤~다음날 아침에만 발송).
                </p>
              ) : null}
            </div>

            {/* 수학 발송 경로(원장 2026-09-29) — 소비처 = 발송 워커(getClassnoteMathRoute). */}
            <ClassnoteRouteField
              route={r.classnoteMathRoute}
              pilot={r.classnoteMathRoutePilot}
              mathTeachers={[...new Set([...(teachers.math ?? []), ...(teachers.subject_1 ?? [])])].filter(inStaff)}
              onChange={set}
            />

            {/* 학부모 글 답글·공감(원장 2026-10-01) — 소비처 = 앱 classnoteReplyMode + 워커 loadReplyMode. 기본 끔. */}
            <ClassnoteReplyModeField mode={r.classnoteParentReplyMode} onChange={set} />
          </div>
        </ReportSettingsPanel>
        ) : null}
        <ReportSettingsPanel tab="video" activeTab={activeTab} id={tabsId}>
          <VideoHomeworkSettings policy={r.videoHomeworkPolicy} classes={videoClasses}
            onChange={(videoHomeworkPolicy) => set({ videoHomeworkPolicy })} />
        </ReportSettingsPanel>
        <ReportSettingsPanel tab="display" activeTab={activeTab} id={tabsId}>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              <SettingsCard
                title="머리글"
                description="보고서 상단 로고·학원명·제목. 로고 이미지에 학원명이 이미 있으면 '학원명 표시'를 꺼서 중복을 없앨 수 있습니다."
              >
                <div className="space-y-1">
                  <ToggleField label="로고 표시" value={r.showLogo} onChange={(v) => set({ showLogo: v })} />
                  {r.showLogo ? (
                    <div className="py-2">
                      {/* 보고서 전용 로고(원장 2026-10-26) — 비우면 학원 기본 정보의 로고. 소비처 = reportLogoPath. */}
                      <BrandingField
                        label="보고서 로고"
                        hint="비우면 학원 로고"
                        slot="reportLogo"
                        value={r.logoUrl ?? ""}
                        onChange={(v) => set({ logoUrl: v })}
                      />
                    </div>
                  ) : null}
                  <ToggleField
                    label="학원명(텍스트) 표시"
                    hint="로고에 이름이 있으면 끄기"
                    value={r.showAcademyName}
                    onChange={(v) => set({ showAcademyName: v })}
                  />
                  <div className="pt-2">
                    <TextField
                      label="보고서 제목"
                      hint="비우거나 '수업 보고서'로 두면 과목 이름(수학 보고서)"
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
                    ["오늘 과제(숙제 내용)", "showHomeworkToday"],
                    ["수업 태도", "showAttitude"],
                    ["학부모 전달 내용", "showParentNote"],
                    ["학습 추세(종합분석)", "showTrendNote"],
                    ["학습 추이 그래프", "showTrendGraph"],
                    // ⚠️ 이 토글은 사진뿐 아니라 pdf·엑셀·hwp 등 **파일 첨부 전체**의 게이트다. 끄면 발송 워커가
                    // ClassNote 파일첨부 경로를 아예 안 타서 "발송은 성공인데 파일만 없음"이 된다(2026-07-21 실사례).
                    ["사진/파일 첨부", "showAttachments"],
                  ] as const
                ).map(([label, key]) => (
                  <div key={key} className="px-3">
                    <ToggleField
                      label={label}
                      hint={(classnoteOn ? SHOW_ITEM_HINTS : SHOW_ITEM_HINTS_NO_CN)[key]}
                      value={r[key]}
                      onChange={(v) => set({ [key]: v } as Partial<ReportSettings>)}
                    />
                  </div>
                ))}
              </div>
            </SettingsCard>
          </div>
        </ReportSettingsPanel>
        <ReportSettingsPanel tab="writing" activeTab={activeTab} id={tabsId}>
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <div className="space-y-4">
              <SettingsCard
                title="테스트 문항수"
                description="일일·확인테스트 만점(/N)은 과목별로 설정합니다(설정 > 과목 운영). 아래를 켜면 강사가 원스크린에서 직접 바꿀 수 있습니다."
              >
                <ToggleField
                  label="강사가 문항수 직접 변경 허용"
                  hint="끄면 과목 설정값 고정"
                  value={r.allowTeacherTestMax}
                  onChange={(v) => set({ allowTeacherTestMax: v })}
                />
              </SettingsCard>

              <SettingsCard
                title="AI 멘트 공지 모드"
                description="자동작성 학부모 멘트의 문단 구성입니다. 프롬프트 세부는 이 화면의 ‘AI 멘트’ 탭에서 편집합니다."
              >
                <div className="flex flex-col gap-2">
                  {(
                    [
                      ["A", "단일 문단", "진도·점수·태도·과제·특이사항을 종합한 한 문단"],
                      ["B", "2문단 분리", "① 수업 내용(교재·진도·과제) ② 태도·특이사항"],
                    ] as const
                  ).map(([mode, title, desc]) => {
                    const on = (r.noticeMode ?? "A") === mode;
                    return (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => set({ noticeMode: mode })}
                        aria-pressed={on}
                        className={`rounded-md border px-3 py-2 text-left transition ${
                          on ? "border-primary bg-primary/5" : "border-line hover:bg-bg-soft"
                        }`}
                      >
                        <p className="text-foreground text-sm font-bold">
                          {title} <span className="text-text-faint font-normal">({mode})</span>
                        </p>
                        <p className="text-text-dim mt-0.5 text-xs">{desc}</p>
                      </button>
                    );
                  })}
                </div>
              </SettingsCard>
            </div>
            <SettingsCard
              title="작성률 예외 강사"
              description="체크한 강사는 수업보고서의 '강사별 작성률' 표에서 빠집니다(보고서 작성 대상이 아닌 보조·데스크 강사 등). 퇴사(비활성) 처리된 강사는 자동으로 제외되니 여기에 추가할 필요가 없습니다."
            >
              {exemptGroupKeys.length === 0 ? (
                <p className="text-text-faint text-xs">반을 담당 중인 강사가 없습니다.</p>
              ) : (
                <div className="space-y-3">
                  {exemptGroupKeys.map((key) => (
                    <div key={key}>
                      <p className="text-text-dim text-xs">{subjects.labelOf(key)}</p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {(teachers[key] ?? []).map((name) => {
                          const on = r.writingExemptTeachers.includes(name);
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() => toggleExempt(name)}
                              aria-pressed={on}
                              className={`rounded-full border px-3 py-1 text-sm transition ${
                                on
                                  ? "border-danger bg-danger/10 text-danger font-bold line-through"
                                  : "border-line text-text-dim hover:bg-bg-soft"
                              }`}
                            >
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {orphanExempt.length > 0 ? (
                <div className="mt-3">
                  <p className="text-text-dim text-xs">{canEdit ? "현재 담당 반 없음(설정만 남음) — 클릭해 해제" : "현재 담당 반 없음(설정만 남음)"}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {orphanExempt.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => toggleExempt(name)}
                        aria-pressed
                        className="border-danger bg-danger/10 text-danger rounded-full border px-3 py-1 text-sm font-bold line-through"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {visibleExemptCount > 0 ? (
                <p className="text-text-faint mt-3 text-xs">작성률 집계 제외 중: {visibleExemptCount}명</p>
              ) : null}
            </SettingsCard>
          </div>
        </ReportSettingsPanel>
        {classnoteOn ? (
        <ReportSettingsPanel tab="exceptions" activeTab={activeTab} id={tabsId}>
          <SettingsCard
            title="발송 보류 예외 (동명이인 확인 완료)"
            description="이름이 같은 학생이 있으면(예: 홍길동 · 홍길동C) 클래스노트 보드는 둘 다 '홍길동'이라 어느 집인지 구분이 안 됩니다. 학부모가 가입할 때 이름 뒤 알파벳을 붙이지 않기 때문입니다. 그래서 그런 이름은 원아 생년월일이 그 학생 학년과 맞는지 대조해 보고, 안 맞으면 발송을 보류합니다. 클래스노트 운영관리에서 직접 확인해 맞는 집이 확실한 보드만 아래에 등록하면 그 보드는 검증 없이 발송됩니다."
          >
            <StringListEditor
              value={r.classnoteSharedBoardAllowlist}
              onChange={(v) => set({ classnoteSharedBoardAllowlist: v })}
              addLabel="보드 추가"
              placeholder="예: (수학)홍길동"
            />
            <p className="text-danger mt-2 flex items-start gap-1.5 text-xs">
              <EyIcon name="alert" size={14} className="mt-0.5 shrink-0" />
              <span>
                확인 없이 등록하면 실제로 다른 집에 보고서가 발송됩니다. 반드시 클래스노트 운영관리에서 연락처를
                대조한 뒤 등록하세요. (테스트 학생 &apos;학원이&apos;는 원아 생일이 실제와 달라 보류되므로 등록이 필요합니다.)
              </span>
            </p>
          </SettingsCard>
        </ReportSettingsPanel>
        ) : null}
      </div>
    </SectionForm>
  );
}
