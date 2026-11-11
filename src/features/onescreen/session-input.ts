/**
 * 원스크린 세션(임시저장) 입력 조립·복원 — 순수 함수(수정 계획 P3-O 1/10, `onescreen-client.tsx`에서 옮김).
 *
 *  · `initReports` = 로스터 복원값(오늘 세션 > 오늘 발송본)으로 화면 보고서 state를 세운다.
 *  · `buildSessionInput` = 학생 한 명의 지금 화면 값 → `saveOnescreenSession` 입력. 자동저장 줄이 **보낼 때마다** 부른다.
 *    화면 값(대상 날짜·테스트 사용 여부)은 `opts`로 받는다 — 예전엔 컴포넌트 closure에서 읽었다.
 */
import { EMPTY_TEMPLATE_PREFS, implicitTemplateFor, type TemplatePrefs } from "./last-template";
import { hasRowOverrides } from "./row-fields";
import type { OneScreenStudent } from "./types";
import type { SubjectReport } from "./components/report-card";

export type ReportsState = Record<string, Record<string, SubjectReport>>; // studentId → 과목명 → {draft, sent}

/** 세션 입력 조립에 드는 화면 값 — 렌더마다 바뀔 수 있어 부를 때 넘긴다. */
export type SessionInputOptions = {
  /** 조회 대상 날짜(YYYY-MM-DD) — 빈값 = 서버가 오늘로. */
  date: string;
  showDailyTest: boolean;
  showCheckTest: boolean;
};

/**
 * @param templatePrefs 영어 보고서 템플릿 내 기본값(반별 마지막 선택, last-template.ts) — **글이 없고 안 보낸** 영어 행에만,
 *   표시로만(`templateImplicit`) 붙는다(세션엔 안 싣는다).
 */
export function initReports(students: OneScreenStudent[], templatePrefs: TemplatePrefs = EMPTY_TEMPLATE_PREFS): ReportsState {
  const out: ReportsState = {};
  for (const s of students) {
    out[s.id] = {};
    // 발송상태·공유토큰·ClassNote 상태는 **과목별**(su)로 초기화 — 학생단위(s.reportSent) 뭉갬 금지.
    // 새로고침 시 워커가 쓴 최종 classnoteStatus(success/failed 등)도 roster 초기로드로 반영됨.
    // 멘트/추세 초안도 roster 복원값(오늘 세션 > 오늘 발송본)으로 시딩 — 새로고침 유실 방지.
    for (const su of s.subjects)
      out[s.id]![su.name] = {
        draft: su.draft ?? "",
        trendDraft: su.trendDraft,
        autoDraft: su.autoDraft, // 자동작성 스냅샷(0214a) — 세션 복원값. 저장 시 draft와 비교해 작성 방식 판정.
        trendAutoDraft: su.trendAutoDraft, // 자동작성 추세 스냅샷(2026-10-16) — '달라진 것 없음' 때 칸을 비울지 가른다.
        autoDraftTemplate: su.autoDraftTemplate, // AI 원문 아님(0370a)
        sent: su.reportSent ?? false,
        shareToken: su.shareToken,
        classnoteStatus: su.classnoteStatus,
        revoked: !!su.revokedAt,
        viewCount: su.viewCount,
        attachments: su.attachments ?? [],
        // 영어 템플릿 모드(2026-09-10) — 세션 복원값. 수학 행은 전부 undefined(세션에 키가 없다).
        ...((): { templateId?: string; templateImplicit?: true } => {
          const implicit = implicitTemplateFor(su, templatePrefs);
          return implicit ? { templateId: implicit, templateImplicit: true } : { templateId: su.templateId };
        })(),
        nextTest: su.nextTest,
        wordFeedback: su.wordFeedback, // EiE 일일 보고서(2026-11-06) — 세션 복원값
        wordRetest: su.wordRetest,
        aiIntro: su.aiIntro,
        aiComment: su.aiComment,
        templateHash: su.templateHash, // 템플릿 글 지문 — 없으면(옛 세션·가져온 글) 저장 직전 재조립 대상이 아니다
        aiFactsHash: su.aiFactsHash,
        composedFactsHash: su.composedFactsHash,
      };
  }
  return out;
}

export function buildSessionInput(
  s: OneScreenStudent,
  r: Record<string, SubjectReport> | undefined,
  opts: SessionInputOptions,
) {
  const { date, showDailyTest, showCheckTest } = opts;
  return {
    studentId: s.id,
    outOfClass: s.isMakeup === true,
    sessionDate: date || undefined, // 대상 날짜(빈값=서버 오늘) — 과거 날짜 작업분도 그 날짜 세션에 저장
    classId: s.classId ?? null,
    baseUpdatedAt: s.sessionUpdatedAt ?? null,
    studyGrade: s.studyGrade ?? null,
    subjectProgress: Object.fromEntries(
      s.subjects
        // 🔴 보강 행도 **이제는 저장한다**(2026-08-13). 예전엔 통째로 걸러냈는데(2026-07-24), 그래서
        //    보강 행에 쓴 진도·교재·오늘 과제가 **새로고침 한 번에 사라졌다**(원장 제보 2026-08-13
        //    "입력해놓은 내용이 일부 새로고침시에 삭제"). 저장된 보고서에서도 복원되지 않는 값들이라
        //    되찾을 길이 없었다.
        //    걸러냈던 진짜 이유는 키 충돌이었다 — 과목키('math')로 저장하면 정규 행이 미편집일 때
        //    로스터의 legacyKey 폴백이 그 항목을 집어 **보강 진도가 정규 행에 새어들었다**(교차오염).
        //    → 보강 행은 `makeup::{과목키}` **전용 키**를 쓴다. legacyKey 폴백은 맨 키('math')만 보므로
        //      구조적으로 겹치지 않는다(로스터가 같은 규약으로 읽는다).
        .map((su) => [
          // 반 키 우선(0134a) — 과목키면 같은 과목 두 행(정규+특강)이 한 항목을 공유해 서로를 덮는다.
          // 로스터 복원(roster.ts)이 같은 순서로 읽는다(보강 전용 키 → 반 키 → 과목키 폴백).
          su.makeup && !su.classId
            ? `makeup::${su.subjectKey || su.name}`
            : su.classId || su.subjectKey || su.name,
          {
            today: su.today,
            // 오늘 수업 성격(복습·문제풀이) — 빈 문자열로 보내 **해제도 저장**한다(undefined면 로스터가
            // `!= null` 복원에서 건너뛰어 껐던 상태가 새로고침에 되살아난다).
            mode: su.progressMode ?? "",
            draft: r?.[su.name]?.draft ?? "",
            trendDraft: r?.[su.name]?.trendDraft ?? "",
            // 자동작성 스냅샷(0214a) — 초안과 함께 영속해야 재접속 후 저장이 manual로 오표기되지 않는다.
            autoDraft: r?.[su.name]?.autoDraft ?? "",
            // 추세 스냅샷·AI 원문 아님 표시도 같은 규약(새로고침 뒤에도 낡은 AI 추세를 지우고, 템플릿·복사 글을 원문으로 싣지 않게).
            ...(r?.[su.name]?.trendAutoDraft ? { trendAutoDraft: r[su.name]!.trendAutoDraft } : {}),
            ...(r?.[su.name]?.autoDraftTemplate ? { autoDraftTemplate: true } : {}),
            textbook: su.textbook ?? "",
            makeup: su.makeup ?? false,
            homeworkToday: su.homeworkToday ?? "",
            // 오늘 영상 과제 있음(0308a) — 켠 적 없는 행은 빼서 세션 모양을 그대로 둔다.
            ...(su.videoHomework != null ? { videoHomework: su.videoHomework } : {}),
            // 영상 첨부 링크 넣기(0328a) — 고른 적 없는 행은 빼서 세션 모양을 그대로 둔다.
            ...(su.videoSubmitLink != null ? { videoSubmitLink: su.videoSubmitLink } : {}),
            // 영상 숙제 마감(원장 2026-10-15) — 고른 적 없는 행은 빼서 세션 모양을 그대로 둔다(날짜는 서버가 정해 세션에 안 싣는다).
            ...(su.videoHomeworkDue != null ? { videoHomeworkDue: su.videoHomeworkDue } : {}),
            // 영어 템플릿 모드(2026-09-10) — **영어 행만** 싣는다(수학 세션 모양 불변). 로스터가 같은 키로 복원한다.
            ...(su.subjectKey === "english"
              ? {
                  // 기본값으로만 붙인 템플릿은 싣지 않는다 — 실으면 기본값을 바꿔도 이 행이 옛 기본값에 묶인다(last-template.ts).
                  //   단 글이 있는 행은 싣는다 — patchReport를 거치지 않고 글이 생긴 행도 그 템플릿으로 쓴 글이다.
                  templateId:
                    r?.[su.name]?.templateImplicit && !(r?.[su.name]?.draft ?? "").trim() ? "" : (r?.[su.name]?.templateId ?? ""),
                  nextTest: r?.[su.name]?.nextTest ?? "",
                  // EiE 일일 보고서(2026-11-06) — 단어 테스트 피드백 · 재시험. 지운 값도 남게 늘 싣는다(nextTest와 같은 규약).
                  wordFeedback: r?.[su.name]?.wordFeedback ?? "",
                  wordRetest: r?.[su.name]?.wordRetest === true,
                  aiIntro: r?.[su.name]?.aiIntro ?? "",
                  aiComment: r?.[su.name]?.aiComment ?? "",
                  // 지문 둘(english-draft.ts) — 새로고침 뒤에도 "템플릿 글 그대로인가"·"AI가 옛 값 기준인가"를 판정한다.
                  templateHash: r?.[su.name]?.templateHash ?? "",
                  aiFactsHash: r?.[su.name]?.aiFactsHash ?? "",
                  composedFactsHash: r?.[su.name]?.composedFactsHash ?? "",
                }
              : {}),
            // 행 단위 평가값(태도·점수·과제 수행률·특이사항) — 지정된 행만 싣는다(row-fields.ts).
            // 미지정 행은 옛 세션과 같은 모양으로 남아 로스터가 학생 값으로 폴백한다(하위호환).
            // 소단원별 이해도(수학 보고서 시범) — 쓴 행만 싣는다(나머지 세션 모양 불변).
            ...(su.understanding ? { understanding: su.understanding } : {}),
            // 일일 테스트 '없음' 사유(수학 보고서 시범) — 고른 적 있는 행만(null = 다시 '있음'으로 돌린 것).
            ...(su.dailyTestSkip !== undefined ? { dailyTestSkip: su.dailyTestSkip } : {}),
            // 숙제 미제출 사유(수학 보고서 시범) — 적은 적 있는 행만.
            ...(su.homeworkMissReason !== undefined ? { homeworkMissReason: su.homeworkMissReason } : {}),
            // 수업 태도 의견 · 보강 사유(2026-10-26) — 적은 적 있는 행만.
            ...(su.attitudeNote !== undefined ? { attitudeNote: su.attitudeNote } : {}),
            // '오늘의 수업' 메모(2026-10-28) — 적은 적 있는 행만.
            ...(su.lessonMemo !== undefined ? { lessonMemo: su.lessonMemo } : {}),
            ...(su.makeupReason !== undefined ? { makeupReason: su.makeupReason } : {}),
            ...(hasRowOverrides(su)
              ? {
                  attitude: su.attitude,
                  homework: su.homework,
                  note: su.note,
                  dailyScore: su.dailyScore,
                  dailyMax: su.dailyMax,
                  checkScore: su.checkScore,
                  checkMax: su.checkMax,
                }
              : {}),
          },
        ]),
    ),
    // 비활성 테스트는 세션에도 점수를 재기입하지 않는다(off 후 남은 옛 점수를 다음 저장이 되살리지 않도록 self-heal).
    dailyScore: showDailyTest ? s.tests.daily.score : null,
    dailyMax: s.tests.daily.max,
    checkScore: showCheckTest ? s.tests.check.score : null,
    checkMax: s.tests.check.max,
    attitude: s.attitude,
    homework: s.homework || null,
    note: s.note || null,
    progressConfirmed: s.progressConfirmed,
  };
}
