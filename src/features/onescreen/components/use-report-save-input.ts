"use client";

import { buildReportFields } from "../report-fields";
import { isJjSheetDraft } from "../jj-books";
import { isTrendOptedOut } from "../trend-optout";
import type { OneScreenStudent } from "../types";
import { isMathReportPilot } from "../math-report-pilot";
import { REASON_BLOCKS, pilotSendBlocks } from "../pilot-send-gate";
import { jjDayKey } from "../jj-day";
import { resolveRowFields } from "../row-fields";
import { computeClientMentSource } from "../ment-source";
import { submitLinkChoosable } from "@/features/video-submit/link-choice";
import { isVideoHomeworkEnabled } from "@/features/video-homework/policy";
import type { ReportsState } from "../session-input";
import type { useEnglishJj } from "./use-english-jj";
import type { BulkVideo } from "./bulk-ops-types";

/**
 * 저장 입력(보고서 필드) 조립 — 수정 계획 P3-O batch D, `use-send-core.ts`에서 나눔(본문 그대로).
 * 카드·표·일괄·첨부의 저장과 발송이 모두 이 함수 하나를 지난다(발송 조건 pilotCheck·영상 과제 값을 서버에 함께 싣는다).
 * 🔴 최신 초안·'학습 추세 미발송'·결과지 고르기는 **부를 때** ref에서 읽는다(일괄 루프 중 편집·앞 행 반영 — #10).
 */
export function useReportSaveInput({
  ctx: { date, activeDate, showDailyTest, showCheckTest },
  refs: { reportsRef, trendOptOutRef },
  video: { videoHwSaveOk, videoHwPolicy, videoHwByOther, videoDueReady, submitLinkMode, videoHwStore },
  english: { jj, freshEnglishDraft },
}: {
  /** date = 조회 대상 날짜 원문(빈값 = 서버 오늘) · activeDate = 화면 날짜(결과지 고르기 열쇠). */
  ctx: { date: string; activeDate: string; showDailyTest: boolean; showCheckTest: boolean };
  refs: { reportsRef: { readonly current: ReportsState }; trendOptOutRef: { readonly current: ReadonlySet<string> } };
  /** 영상 과제 정책 묶음 — 일괄 적용과 같은 모양(bulk-ops-types.ts). */
  video: BulkVideo;
  english: {
    jj: ReturnType<typeof useEnglishJj>;
    freshEnglishDraft: (student: OneScreenStudent, subjectName: string) => { draft: string; autoDraft: string | undefined };
  };
}) {
  /**
   * 저장 입력(보고서 필드)을 (학생,과목)별로 조립 — 카드/표 공용.
   *
   * 🔴 **멘트가 비면 빈 채로 저장한다**(2026-07-30 발송 감사로 변경). 예전엔 여기서 조용히
   *    `buildSubjectReport` 템플릿을 끼워 넣었는데, 그 결과가 아래 저장 후 `patchReport`로
   *    **강사의 멘트칸에 되써져** 발송 가능 상태가 됐다 — 강사가 쓴 적 없는 문장이 강사 이름으로
   *    학부모에게 나갔다(4일치 발송분 226건 중 50건, 22%). 진도만 넣고 일괄 저장하면 벌어지는 일이라
   *    본인은 눈치채기 어렵다.
   *    이제 멘트가 비면 기록만 저장되고 발송은 게이트가 막는다("멘트 입력 필요") → 강사가 자동작성을
   *    누르거나 직접 쓰게 된다. 템플릿은 **AI 생성이 실패했을 때만**, 토스트로 알리며 멘트칸에 들어간다.
   */
  function buildSaveInputFor(student: OneScreenStudent, subjectName: string) {
    const idx = student.subjects.findIndex((su) => su.name === subjectName);
    const su = student.subjects[idx];
    // ⚠️ 최신 초안은 ref에서(일괄 루프 중 사용자 편집·앞 행 patch 반영) — closure `reports`는 클릭 시점 스냅샷이라 유실 위험(#10).
    const existing = reportsRef.current[student.id]?.[subjectName];
    // 영어 행: 손대지 않은 자동 글이면 지금 칸 값으로 다시 조립해서 저장한다(기록과 다른 글이 나가지 않게).
    const fresh = su?.subjectKey === "english" ? freshEnglishDraft(student, subjectName) : null;
    const draft = fresh ? fresh.draft : (existing?.draft ?? "");
    // 자동작성 스냅샷(0214a) — 작성 방식 판정과 자동작성 원문(0370a)이 같은 값을 본다.
    const autoSnap = fresh ? fresh.autoDraft : existing?.autoDraft;
    const mentSource = computeClientMentSource(draft, autoSnap);
    // 표시 필드(교재·진도·시험·태도·멘트…)는 **카드 미리보기와 같은 함수**로 만든다(report-fields.ts).
    // 여기서 따로 조립하면 "화면에 보이던 것"과 "학부모가 받은 것"이 조용히 갈라진다.
    // 🔴 평가값(태도·점수·과제 수행률)은 **행 단위**로 해석한다(row-fields.ts) — 보강은 정규와 따로 나가는
    //    다른 보고서라 값도 독립이어야 한다(원장 2026-08-13). 행에 값이 없으면 학생 값으로 폴백해
    //    옛 세션·기존 행은 지금까지와 똑같이 동작한다.
    const rowEval = resolveRowFields(student, su);
    const fields = buildReportFields({
      subject: su,
      homework: rowEval.homework,
      attitude: rowEval.attitude,
      tests: rowEval.tests,
      draft,
      jjSheet: su?.subjectKey === "english" && isJjSheetDraft(existing),
      trendDraft: existing?.trendDraft,
      // '학습 추세 미발송'(원장 2026-09-18) — ref로 읽는다(디바운스·발송은 비동기라 closure가 옛 값일 수 있다).
      trendHidden: isTrendOptedOut(trendOptOutRef.current, su?.classId, student.id),
      showDailyTest,
      showCheckTest,
    });
    return {
      draft,
      input: {
        studentId: student.id,
        reportDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — report_date가 곧 카드 표시일·ClassNote 게시일
        ...fields,
        // ⚠️ subject는 **과목키**(math)여야 한다 — 발송 과목 게이트·보드 매핑이 이 값을 본다.
        //    행 이름(name)엔 반 이름이 붙을 수 있으므로 폴백도 subjectLabel을 먼저 본다.
        subject: su?.subjectKey || su?.subjectLabel || su?.name || undefined,
        // 반(수업) — 보고서 1건의 단위(0134a). 같은 날 정규+특강이 서로 안 덮게 하는 키. 보강 행은 classId=null → unit_key=과목키.
        classId: su?.classId ?? null,
        // 보강(수업외) = 담당반·결석 게이트 우회. 카드 전체가 보강(isMakeup)이거나, **정규 카드에 병합된 보강 행**
        // (makeup=true·classId 없음)도 우회 — 그 학생의 담당반이 아닌 추가수업이라 담당반/결석 검사에 걸리면 안 된다.
        outOfClass: (student.isMakeup ?? false) || (!!su?.makeup && !su?.classId),
        // 보강 행의 소속(어느 수업 시간에 한 보강인가) — 반 필터 앵커(0171a). 정규 행이면 서버가 무시한다.
        makeupClassId: su?.makeupClassId ?? null,
        // 오늘 영상 과제(0308a) — 🔴 **값이 있을 때만** 싣는다(DB·세션에서 읽었거나 강사가 눌렀을 때). 손대지 않은 행을
        // false로 적으면 '모름'이 '없음'이 되어 다음 수업 검사가 조용히 사라진다(적대 리뷰 High). 정책이 끈 반·반 없는 행·
        // 과제 값을 못 읽은 세션(videoHwSaveOk=false — 저장돼 있던 '있음'을 덮는다)도 싣지 않는다.
        // 다른 선생님이 처음 쓴 줄도 싣지 않는다(그 선생님만 바꾼다 — 서버·DB도 한 번씩 더 막는다).
        ...(videoHwSaveOk && typeof su?.videoHomework === "boolean" && su.classId && videoHwPolicy &&
        !videoHwByOther(student.id, su.classId) &&
        isVideoHomeworkEnabled(videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey ?? "math", grade: student.grade })
          // 그 값을 DB와 맞춘 시각도 함께 — 장부에서 취소한 숙제를 모른 채 '있음'으로 되살리지 않게(서버 `cancels.ts`, 원장 2026-10-16).
          ? { videoHomework: su.videoHomework, videoHomeworkSeenAt: videoHwStore?.seenAtOf(student.id, su.classId) ?? null }
          : {}),
        // 영상 첨부 링크 넣기(0328a) — 같은 규약: 고른 값이 있고 그 행에서 고를 수 있을 때만 싣는다(토글이 안 보이는 행·단계는
        // 싣지 않아 저장돼 있던 값을 덮지 않는다). 영상 과제가 꺼진 행은 false로 — 과제 없이 링크만 켜진 값이 남지 않게.
        ...(videoHwSaveOk && typeof su?.videoSubmitLink === "boolean" && !videoHwByOther(student.id, su?.classId) &&
        submitLinkChoosable(submitLinkMode, videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey, grade: student.grade, studentName: student.name })
          ? { videoSubmitLink: su.videoSubmitLink && su.videoHomework === true }
          : {}),
        // 영상 숙제 마감(원장 2026-10-15) — 같은 규약: 고른 값이 있고 그 행에서 고를 수 있을 때만(영상 과제를 싣는 조건 + 마감 칸 준비됨).
        // 영상 과제가 꺼진 행은 서버가 마감을 지운다(값을 보내지 않아도). '다음 수업' 날짜는 서버가 시간표로 정한다(화면 값을 믿지 않는다).
        ...(videoDueReady && videoHwSaveOk && su?.videoHomework === true && su.videoHomeworkDue && su.classId && videoHwPolicy &&
        !videoHwByOther(student.id, su.classId) &&
        isVideoHomeworkEnabled(videoHwPolicy, { classId: su.classId, subjectKey: su.subjectKey ?? "math", grade: student.grade })
          ? { videoHomeworkDue: su.videoHomeworkDue }
          : {}),
        // 멘트 작성 방식(0214a) — 이번 세션 자동작성 스냅샷과 비교(최종은 서버 resolveMentSource가 sticky 판정).
        mentSource,
        // 수학 보고서 시범 — 강사 한줄 멘트(필수). 서버가 비었거나 글 끝에 안 붙었으면 거절한다.
        // 영어도 같다(원장 2026-10-26 *"영어도 수학이랑 동일하게 … 사랑의 한마디 · 필수"*).
        ...(isMathReportPilot(student.id, su?.subjectKey) || su?.subjectKey === "english" ? { pilotOneLine: rowEval.note } : {}),
        // JJ 수업보고서 글 — 사랑의 한마디가 선택이다(원장 2026-10-27). 서버가 이 표시로 '영어 한마디 필수'를 건너뛴다.
        ...(su?.subjectKey === "english" && isJjSheetDraft(existing) ? { jjSheet: true } : {}),
        // 새 수학 보고서 — 화면 발송 조건(자동작성이 지금 값 기준인가 · 사유를 다 적었나)을 서버에도 싣는다(원장 2026-10-26 일괄 발송 구멍).
        //   일괄 발송·행 발송이 모두 이 입력을 지나므로, 어느 길로 보내도 서버가 같은 조건으로 거절한다.
        // 영어 줄도 싣는다 — 보강 사유를 서버가 같은 조건으로 본다(2026-10-26). 영어엔 자동작성 조건이 없어 factsCurrent는 늘 참이다.
        ...(isMathReportPilot(student.id, su?.subjectKey) || su?.subjectKey === "english"
          ? (() => {
              const blocks = pilotSendBlocks(student, subjectName, { draft, autoDraft: autoSnap, pilotFactsSig: existing?.pilotFactsSig, templateId: existing?.templateId });
              return { pilotCheck: { factsCurrent: !blocks.includes("autowrite"), reasonsOk: !blocks.some((b) => REASON_BLOCKS.includes(b)) } };
            })()
          : {}),
        // 자동작성 후 고친 멘트면 그 자동작성 원문도 싣는다(0370a) — 말투 프로파일이 선생님이 '늘 고치는 것'을 배운다(원장 2026-10-16).
        //   영어는 템플릿 모드라 뺀다(코퍼스 밖).
        //   AI 실패 폴백 템플릿은 AI 원문이 아니라 뺀다.
        ...(mentSource === "auto_edited" && su?.subjectKey !== "english" && autoSnap && !existing?.autoDraftTemplate ? { mentAutoDraft: autoSnap } : {}),
        // 영어 결과지 고르기(2026-09-28) — 이 화면이 아는 값만 싣는다. 모르면(안 받음) 빼서 서버가 저장해 둔 고르기를 따르게.
        ...(su?.subjectKey === "english" && jjDayKey(student.id, activeDate) in jj.picksRef.current
          ? { jjExamPick: jj.picksRef.current[jjDayKey(student.id, activeDate)] }
          : {}),
      },
    };
  }
  return { buildSaveInputFor };
}
