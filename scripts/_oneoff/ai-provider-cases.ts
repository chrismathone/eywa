import { buildClassifyPrompt } from "../../src/features/attendance/parent-alerts/intent";
import {
  buildStudentConsultationPrompt,
  type StudentConsultationPromptContext,
} from "../../src/features/consultations/analysis-prompt";
import { buildConsultationAnalysisPrompt, type ConsultationPromptInput } from "../../src/features/enrollment/consultation-analysis-prompt";
import { buildConsultationFormPrompt, type ConsultationFormPromptContext } from "../../src/features/enrollment/form-extract-prompt";
import { buildPrepBriefPrompt, type PrepFacts } from "../../src/features/enrollment/prep-brief";
import { buildMeetingAnalysisPrompt, type MeetingPromptContext } from "../../src/features/meetings/analysis-prompt";
import { buildNoticeTranslationPrompt } from "../../src/features/notices/translate-prompt";
import type { NoticeSource } from "../../src/features/notices/translate-rules";
import type { MustCaptureFact } from "./ai-provider-metrics";

type Effort = "low" | "medium" | "high";
type ClassifyItem = { id: string; studentName: string; date: string; content: string };
type BaseSeed = { id: string; mustCapture: MustCaptureFact[] };

export type AnalysisSeed =
  | (BaseSeed & { kind: "consultation"; consult: ConsultationPromptInput; transcript: string; multi?: boolean })
  | (BaseSeed & { kind: "form"; context: ConsultationFormPromptContext; transcript: string })
  | (BaseSeed & { kind: "classification"; items: ClassifyItem[] })
  | (BaseSeed & { kind: "translation"; source: NoticeSource })
  | (BaseSeed & { kind: "meeting"; transcript: string; context: MeetingPromptContext })
  | (BaseSeed & { kind: "studentConsultation"; transcript: string; context: StudentConsultationPromptContext })
  | (BaseSeed & { kind: "prep"; facts: PrepFacts });

type AnalysisCaseBase = {
  id: string;
  feature: string;
  tier: "balanced";
  claudeEffort: Effort;
  prompt: string;
  sourceFacts: string;
  expectedFields: string[];
  mustCapture: MustCaptureFact[];
};

export type AnalysisCase =
  | (AnalysisCaseBase & { kind: "consultation"; inputName: string; multi: boolean })
  | (AnalysisCaseBase & { kind: "form" })
  | (AnalysisCaseBase & { kind: "classification"; messageDates: Record<string, string> })
  | (AnalysisCaseBase & { kind: "translation" })
  | (AnalysisCaseBase & { kind: "meeting" })
  | (AnalysisCaseBase & { kind: "studentConsultation" })
  | (AnalysisCaseBase & { kind: "prep"; prepFacts: PrepFacts });

const CONSULTATION_FIELDS = [
  "consultationType",
  "summary",
  "familyBackground",
  "parentConcerns",
  "parentQuestions",
  "parentRequests",
  "parentSatisfaction",
  "studentTraits",
  "teacherResponse",
  "salesPoints",
  "agreements",
  "followUps",
  "warnings",
  "conversationFlow",
  "extracted",
];
const MEETING_FIELDS = [
  "meetingType",
  "summary",
  "agendaDiscussion",
  "decisions",
  "actionItems",
  "speakerSummary",
  "concerns",
  "nextSteps",
];

/** 가명 입력을 운영 프롬프트와 운영 강도로 조립한다. 임의 시험 프롬프트를 받을 수 없게 종류별 재료만 받는다. */
export function buildAnalysisCase(seed: AnalysisSeed): AnalysisCase {
  const base = {
    id: seed.id,
    tier: "balanced" as const,
    mustCapture: seed.mustCapture,
  };
  switch (seed.kind) {
    case "consultation": {
      const multi = seed.multi ?? false;
      return {
        ...base,
        kind: seed.kind,
        feature: "enrollment_analysis",
        claudeEffort: "high",
        prompt: buildConsultationAnalysisPrompt(seed.consult, seed.transcript, multi),
        sourceFacts: JSON.stringify({ consult: seed.consult, transcript: seed.transcript }),
        expectedFields: CONSULTATION_FIELDS,
        inputName: seed.consult.prospect_name,
        multi,
      };
    }
    case "form":
      return {
        ...base,
        kind: seed.kind,
        feature: "enrollment_form_extract",
        claudeEffort: "high",
        prompt: buildConsultationFormPrompt(seed.transcript, seed.context),
        sourceFacts: JSON.stringify({ context: seed.context, transcript: seed.transcript }),
        expectedFields: ["schoolName", "grade", "parentRelation", "safetyNotes", "subject", "parentRequest", "prevAcademy", "lastScore"],
      };
    case "classification":
      return {
        ...base,
        kind: seed.kind,
        feature: "parent_attendance_intent",
        claudeEffort: "medium",
        prompt: buildClassifyPrompt(seed.items),
        sourceFacts: JSON.stringify(seed.items),
        expectedFields: ["results"],
        messageDates: Object.fromEntries(seed.items.map((item) => [item.id, item.date])),
      };
    case "translation":
      return {
        ...base,
        kind: seed.kind,
        feature: "notice_translate",
        claudeEffort: "medium",
        prompt: buildNoticeTranslationPrompt(seed.source),
        sourceFacts: JSON.stringify(seed.source),
        expectedFields: ["title", "body", "linkLabel"],
      };
    case "meeting":
      return {
        ...base,
        kind: seed.kind,
        feature: "meeting_analysis",
        claudeEffort: "high",
        prompt: buildMeetingAnalysisPrompt(seed.transcript, seed.context),
        sourceFacts: JSON.stringify({ transcript: seed.transcript, context: seed.context }),
        expectedFields: MEETING_FIELDS,
      };
    case "studentConsultation":
      return {
        ...base,
        kind: seed.kind,
        feature: "consultation_analysis",
        claudeEffort: "high",
        prompt: buildStudentConsultationPrompt(seed.transcript, seed.context),
        sourceFacts: JSON.stringify({ transcript: seed.transcript, context: seed.context }),
        expectedFields: ["summary", "mainTopics", "studentState", "parentConcerns", "actionItems", "followUps", "warnings"],
      };
    case "prep":
      return {
        ...base,
        kind: seed.kind,
        feature: "enrollment_prep_brief",
        claudeEffort: "high",
        prompt: buildPrepBriefPrompt(seed.facts),
        sourceFacts: JSON.stringify(seed.facts),
        expectedFields: ["headline", "opening", "questions", "playbook", "proposal", "objections", "closing", "cautions"],
        prepFacts: seed.facts,
      };
  }
}

const consultationA = [
  "[화자 A] 안녕하세요, 가명학생봄 보호자님. 오늘은 현재 학습 상황과 반 배정을 차근차근 확인하겠습니다.",
  "[화자 B] 네, 아이는 가명중학교A 중학교 2학년이고 저는 엄마입니다. 수학 때문에 상담을 신청했습니다.",
  "[화자 A] 최근 시험과 지금 배우는 범위를 말씀해 주시겠어요?",
  "[화자 B] 최근 수학이 62점이었고 일차함수에서 많이 막힙니다. 가명수학관을 여덟 달 다녔는데 진도가 너무 빨랐어요.",
  "[화자 B] 질문을 못 했다고 혼이 난 뒤부터 수학 문제만 펴면 숨이 가빠지는 과호흡이 한 번씩 있습니다.",
  "[화자 A] 건강과 안전에 관련된 내용이라 수업 담당에게 반드시 전달하고, 증상이 오면 즉시 쉬도록 하겠습니다.",
  "[화자 B] 병원에서는 긴장 반응이라고 했고 응급약은 없습니다. 그래도 억지로 발표시키지는 말아 주세요.",
  "[화자 A] 알겠습니다. 진단 결과를 보고 소수 정원 기초반부터 시작하는 방안을 제안드립니다.",
  "[화자 B] 그런데 가명수학관을 그만둘 때 남은 수강료 환불을 두고 분쟁이 있었어요. 설명과 실제 수업이 달랐다고 느꼈습니다.",
  "[화자 B] 그래서 이번에는 환불 규정과 반 변경 기준을 문서로 먼저 받고 싶습니다.",
  "[화자 A] 등록 전에 규정 문서와 반 변경 절차를 보내 드리고, 첫 달은 매주 학습 상황을 안내하겠습니다.",
  "[화자 B] 집에서는 고등학생 형과 자꾸 비교하게 됩니다. 형은 잘했는데 왜 너는 못하냐고 말해서 아이가 상처를 많이 받았어요.",
  "[화자 B] 형제 비교 때문에 어제는 학원을 전부 그만두고 싶다고 했습니다. 저도 그러면 안 된다는 걸 압니다.",
  "[화자 A] 비교 표현은 학원에서도 쓰지 않고, 작은 성공을 확인하는 방식으로 자신감을 회복시키겠습니다.",
  "[화자 B] 지금 다른 학원 두 곳도 상담 중입니다. 아이가 여기서도 압박을 느끼면 바로 옮기겠다고 해서 이탈 가능성이 있어요.",
  "[화자 A] 첫 수업 뒤 학생 반응을 전화로 확인하고, 맞지 않으면 진도를 낮추거나 반을 조정하겠습니다.",
  "[화자 B] 화요일과 목요일 저녁은 가능하고 토요일은 형 일정 때문에 어렵습니다.",
  "[화자 A] 화목 저녁 기초반을 임시로 잡고, 이번 금요일 오후 6시에 레벨 테스트를 진행하면 어떨까요?",
  "[화자 B] 네, 금요일 6시로 하겠습니다. 다만 테스트 결과와 추천 근거를 함께 설명해 주세요.",
  "[화자 A] 테스트 뒤 20분 상담을 붙이고 결과표도 전달하겠습니다. 담당자는 제가 맡겠습니다.",
  "[화자 B] 숙제는 하루 30분을 넘기지 않았으면 합니다. 길어지면 아이가 울면서 포기합니다.",
  "[화자 A] 초기 2주는 20분 분량으로 시작하고 적응을 보며 조절하겠습니다.",
  "[화자 C] 잠깐만요, 택배 어디에 둘까요?",
  "[화자 A] 문 앞에 두세요. 방금 대화는 상담과 무관한 사무실 잡담입니다.",
  "[화자 B] 등록 결정은 레벨 테스트 설명과 환불 규정을 본 뒤 하겠습니다.",
  "[화자 A] 오늘 안에 규정 문서를 보내고 금요일 테스트 뒤 최종 여부를 확인하겠습니다.",
  "[화자 B] 첫 달에는 형과 점수를 비교하지 말고, 숙제 누락과 과호흡 증상 여부를 매주 따로 알려 주세요. 다른 학원 체험도 예약해 두어서 아이가 적응하지 못하면 옮길 생각입니다.",
  "[화자 A] 형제 비교 없이 학생 본인의 오답과 참여 변화를 기록하고, 증상이 보이면 즉시 쉬게 한 뒤 보호자께 연락하겠습니다. 첫 수업 다음 날과 2주 뒤에 적응 상황도 확인하겠습니다.",
  "[화자 B] 그 일정과 환불 기준이 문서에 분명히 적혀 있으면 검토하겠습니다.",
].join("\n");

const consultationB = [
  "[화자 A] 가명학생별 보호자님, 고등학교 진학 뒤 학습 상황을 먼저 듣겠습니다.",
  "[화자 B] 아이는 가명고등학교B 고등학교 1학년이고 저는 아버지입니다. 영어와 수학을 같이 고민 중입니다.",
  "[화자 B] 지난 중간고사는 영어 71점, 수학 58점이었습니다. 수학은 도형, 영어는 긴 지문에서 시간이 부족합니다.",
  "[화자 A] 이전에는 어떤 방식으로 공부했나요?",
  "[화자 B] 가명공부방에서 1년 했고 최근에는 개인 과외를 석 달 받았습니다. 과외 선생님과 숙제량 문제로 그만뒀습니다.",
  "[화자 B] 아이가 땅콩 알레르기가 심해서 간식에 땅콩이 들어가면 안 됩니다. 에피펜은 가방 앞주머니에 있습니다.",
  "[화자 A] 안전 주의사항으로 기록하고 담당 강사와 데스크가 함께 확인하도록 하겠습니다.",
  "[화자 B] 부모가 별거 중이라 엄마와 아빠가 교육 방침으로 자주 다툽니다. 아이가 양쪽 눈치를 보며 말을 숨깁니다.",
  "[화자 B] 엄마는 성적이 바로 안 오르면 학원을 끊겠다고 하고, 저는 한 학기는 지켜보자는 입장입니다.",
  "[화자 A] 학생 앞에서 서로 다른 목표가 충돌하지 않도록 첫 달 목표를 작게 합의하는 게 필요해 보입니다.",
  "[화자 B] 아이는 친구가 다니는 다른 학원으로 옮기고 싶다고 합니다. 여기 수업이 맞지 않으면 한 달 안에 이탈할 수 있습니다.",
  "[화자 A] 체험 수업과 진단을 먼저 하고 학생 본인의 의견도 따로 확인하겠습니다.",
  "[화자 B] 예전 학원에서 환불 신청을 했는데 상담 때 들은 기준과 달라 분쟁이 길었습니다. 이번에는 결제 전에 환불 기준을 받고 싶습니다.",
  "[화자 A] 결제 전 약관을 보내고 질문에 답한 기록도 남기겠습니다.",
  "[화자 B] 셔틀은 신청하지 않겠습니다. 주소는 가명동이고 제가 직접 데리러 옵니다.",
  "[화자 A] 가능한 시간은 언제인가요?",
  "[화자 B] 월요일과 수요일 오후 7시 이후가 됩니다. 금요일은 병원 알레르기 진료가 있어 어렵습니다.",
  "[화자 A] 월수 7시 반 통합반 체험을 다음 주 수요일에 잡고, 수학 진단은 그날 30분 먼저 보겠습니다.",
  "[화자 B] 수학 숙제는 매일보다 주 3회로 나눠 주세요. 엄마와 숙제 때문에 갈등이 커지는 걸 막고 싶습니다.",
  "[화자 A] 주 3회 분량으로 설계하고 앱에 완료 여부만 간단히 표시하겠습니다.",
  "[화자 B] 아이가 상담 사실을 친구에게 알리고 싶어 하지 않습니다. 반에서 개인 사정을 언급하지 말아 주세요.",
  "[화자 A] 개인 정보와 가정 상황은 담당자만 공유하고 수업 중 공개하지 않겠습니다.",
  "[화자 C] 오늘 저녁 메뉴 정했어요? 저는 김밥 먹고 싶어요.",
  "[화자 A] 그 이야기는 상담과 관계없는 잡담이니 기록에서 제외하겠습니다.",
  "[화자 B] 체험 뒤 학생이 동의하고 환불 규정을 확인하면 등록하겠습니다.",
  "[화자 A] 제가 오늘 약관을 보내고, 다음 주 수요일 체험 뒤 목요일까지 등록 의사를 확인하겠습니다.",
  "[화자 B] 어머니와 교육 방향이 달라 체험 결과를 두 사람에게 같은 내용으로 보내 주세요. 알레르기 대응과 숙제 분량이 지켜지지 않으면 한 달 안에 다른 학원으로 옮기겠다는 입장도 같습니다.",
  "[화자 A] 보호자 두 분께 동일한 요약과 환불 기준을 전달하고, 에피펜 위치는 담당 강사와 데스크가 함께 확인하겠습니다. 체험 다음 날 학생 반응도 따로 묻겠습니다.",
  "[화자 B] 네, 가족 갈등이 학생 앞에서 드러나지 않도록 연락은 개별로 부탁드립니다.",
].join("\n");

const meetingA = [
  "[화자 A] 오늘 운영회의 안건은 토요일 보충반 시범 운영과 셔틀 동선입니다.",
  "[화자 B] 지난달 보충 요청이 열두 명이었고, 현재 빈 교실은 토요일 오후 두 시에만 가능합니다.",
  "[화자 C] 오후 두 시면 셔틀 2호차 노선과 겹칩니다. 기사님 확인 없이 확정하면 곤란합니다.",
  "[화자 A] 우선 11월 22일 토요일 오후 2시에 한 번 시범 운영하는 안을 제안합니다.",
  "[화자 B] 찬성하지만 개인정보 동의서가 없는 학생 세 명은 명단에서 빼야 합니다.",
  "[화자 C] 반대는 아니고, 셔틀 확인이 11월 16일까지 안 되면 학부모에게 개별 등원을 안내해야 합니다.",
  "[화자 A] 최종 결정은 시범반은 11월 22일 오후 2시, 정원은 열두 명, 동의서 없는 세 명은 보류입니다.",
  "[화자 A] 가명직원A가 11월 14일까지 대상 학생 열두 명과 동의서 현황을 정리하세요.",
  "[화자 C] 제가 11월 16일까지 셔틀 2호차 기사와 동선을 확인하고 결과를 단체방에 올리겠습니다.",
  "[화자 B] 교재는 기존 심화 문제집 3단원을 쓰고 추가 구매는 하지 않는 게 좋겠습니다.",
  "[화자 A] 교재 추가 구매 없음으로 결정하겠습니다. 출력물은 사무실 예산으로 준비합니다.",
  "[화자 C] 위험 요소는 동의서 누락 세 명과 셔틀 확정 지연입니다.",
  "[화자 B] 학부모 안내는 셔틀 확인 뒤 11월 17일에 보내면 됩니다.",
  "[화자 A] 다음 점검 회의는 11월 18일 오전 10시에 열어 명단, 셔틀, 안내문을 최종 확인합니다.",
  "[화자 B] 그때 시범 뒤 정규반 전환 기준도 정합시다. 출석 8명 이상이면 12월에 두 번째 운영을 검토하죠.",
  "[화자 A] 좋습니다. 다음 단계는 18일 점검, 22일 시범, 이후 출석 기준으로 12월 재운영 판단입니다.",
  "[화자 C] 회의 끝났으면 점심은 칼국수 어때요?",
  "[화자 B] 저는 김밥이 좋아요. 이 부분은 회의와 무관한 잡담입니다.",
].join("\n");

const meetingB = [
  "[화자 A] 오늘 강사회의는 환불 안내문 개정과 밀린 상담 기록 처리 두 가지입니다.",
  "[화자 B] 현재 안내문은 중도 환불 계산 예시가 없어 학부모 문의가 반복됩니다.",
  "[화자 C] 지난주에도 같은 문의가 세 번 왔고 답변 표현이 강사마다 달랐습니다.",
  "[화자 A] 12월 1일부터 새 환불 안내문을 적용하고 계산 예시 두 개를 넣는 안을 제안합니다.",
  "[화자 B] 시행일에는 동의하지만 법률 문구 검토 전 게시하는 것은 반대합니다.",
  "[화자 C] 외부 검토는 11월 22일까지 받을 수 있습니다. 그 뒤 게시하면 일정에 맞습니다.",
  "[화자 A] 최종 결정은 12월 1일 시행, 외부 검토 완료 뒤 게시, 기존 상담에는 소급하지 않는 것입니다.",
  "[화자 A] 가명직원B는 11월 20일까지 안내문 초안과 계산 예시를 작성하세요.",
  "[화자 B] 알겠습니다. 예시는 수강 전 취소와 절반 수강 뒤 취소 두 가지로 만들겠습니다.",
  "[화자 A] 가명직원C는 11월 21일까지 상담 답변 템플릿을 같은 표현으로 수정하세요.",
  "[화자 C] 처리하겠습니다. 다만 지금 미작성 상담 기록이 일곱 건이라 시간이 빠듯합니다.",
  "[화자 B] 일곱 건 중 환불 관련 두 건을 먼저 정리하고 나머지는 금요일까지 나누죠.",
  "[화자 A] 미작성 일곱 건은 위험 요소로 남기고, 가명직원C가 11월 22일까지 전부 마감합니다.",
  "[화자 C] 오늘 중 두 건, 내일 세 건, 금요일 두 건으로 처리하겠습니다.",
  "[화자 B] 새 안내문 교육도 필요합니다. 강사들이 문서를 읽지 않으면 표현이 다시 갈립니다.",
  "[화자 A] 11월 24일 오전 9시 30분에 최종 점검과 20분 교육을 진행하겠습니다.",
  "[화자 C] 다음 단계는 초안, 템플릿, 외부 검토, 24일 교육, 12월 1일 시행 순서입니다.",
  "[화자 B] 회의 후 커피 주문은 제가 할게요. 메뉴 이야기는 회의록에서 빼 주세요.",
].join("\n");

const f = (label: string, ...anyOf: string[]): MustCaptureFact => ({ label, anyOf });

const prepFactsA: PrepFacts = {
  student: {
    name: "가명학생준",
    grade: "중2",
    school: "가명중학교A",
    subjectLabel: "수학",
    genderLabel: "남학생",
    careerGoal: "수학 자신감 회복",
    request: "영어 수강 시간과 겹치지 않는 수학 반과 숙제 관리 방법을 확인해 주세요.",
    shuttleRequest: false,
    siblingsText: "형제가 같은 학원에 재원 중",
    safetyNotes: "땅콩 알레르기가 있어 간식 성분 확인 필요",
    consultationPath: "지인 소개",
    enrolledNow: null,
  },
  parent: { name: "가명보호자준", relation: "어머니" },
  checklist: [
    { question: "이전 학원에서 어려웠던 점", answer: "진도가 빨라 질문할 시간이 부족했음" },
    { question: "원하는 관리 방식", answer: "숙제 누락 시 당일 안내 요청" },
  ],
  habits: [{ label: "오답 복습", score: 2 }, { label: "학습 계획", score: 3 }],
  priorConsults: [],
  siblings: [{ name: "가명형제A", school: "가명중학교A", grade: "중3", classNames: ["중3 수학 심화"] }],
  classes: [{
    id: "fake-class-a",
    className: "중2 수학 A",
    subjectLabel: "수학",
    teacherName: "가명강사A",
    scheduleLabel: "월·수 19:00",
    seats: 8,
    enrolled: 6,
    notes: "분수 계산 진단 후 보강 가능",
    gradeMatched: true,
  }],
  tuition: [{ category: "수강료", name: "중등 수학", price: 320_000, modeLabel: "월 단가", note: null }],
  textbooks: [{ title: "가명수학 중2", subjectLabel: "수학", gradeLevel: "중2" }],
  peers: { sameSchool: 3, sameGrade: 5, total: 42 },
  policy: {
    academyName: "가명학원",
    dueDay: 5,
    latePolicy: "납부일이 지나면 보호자에게 안내",
    shuttleEnabled: false,
    shuttleFee: null,
    shuttleRoutes: [],
  },
};

const prepFactsB: PrepFacts = {
  student: {
    name: "가명학생솔",
    grade: "중1",
    school: "가명중학교B",
    subjectLabel: "수학",
    genderLabel: "여학생",
    careerGoal: "문장제 식 세우기 보완",
    request: "현재 영어 반과 겹치지 않는 수학 반과 셔틀 노선을 확인해 주세요.",
    shuttleRequest: true,
    siblingsText: null,
    safetyNotes: "긴장하면 과호흡 증상이 있어 발표를 강요하지 않음",
    consultationPath: "재원생 추가 과목 상담",
    enrolledNow: { classNames: ["중1 영어 E"], classLines: ["중1 영어 E · 화·목 17:00"] },
  },
  parent: { name: "가명보호자솔", relation: "아버지" },
  checklist: [
    { question: "수학에서 가장 어려운 부분", answer: "문장제 식 세우기" },
    { question: "추가 수강 조건", answer: "영어 수업과 겹치지 않고 셔틀 이용 가능해야 함" },
  ],
  habits: [{ label: "질문하기", score: 2 }, { label: "숙제 완수", score: 4 }],
  priorConsults: [{ date: "2026-10-10", outcomeLabel: "영어 재등록", subjectLabel: "영어" }],
  siblings: [],
  classes: [{
    id: "fake-class-b",
    className: "중1 수학 B",
    subjectLabel: "수학",
    teacherName: "가명강사B",
    scheduleLabel: "월·수 18:30",
    seats: 10,
    enrolled: 7,
    notes: "문장제 기초 보강 포함",
    gradeMatched: true,
  }],
  tuition: [{ category: "수강료", name: "중등 수학 기초", price: 280_000, modeLabel: "월 단가", note: null }],
  textbooks: [{ title: "가명개념수학 중1", subjectLabel: "수학", gradeLevel: "중1" }],
  peers: { sameSchool: 4, sameGrade: 8, total: 42 },
  policy: {
    academyName: "가명학원",
    dueDay: 5,
    latePolicy: "납부일이 지나면 보호자에게 안내",
    shuttleEnabled: true,
    shuttleFee: "월 20,000원",
    shuttleRoutes: ["가명중학교B 정문 18:00"],
  },
};

/** 실제 사람 정보가 없는 운영형 분석 사례. 각 기능은 최소 두 건이다. */
export const BUILT_IN_ANALYSIS_SEEDS: AnalysisSeed[] = [
  {
    id: "consultation-risk-a",
    kind: "consultation",
    consult: { prospect_name: "가명학생봄", prospect_grade: "중2", prospect_school: "가명중학교A", parent_name: "가명보호자A", parent_phone: null },
    transcript: consultationA,
    mustCapture: [
      f("환불 분쟁 이력", "환불", "분쟁"),
      f("과호흡 건강 주의", "과호흡", "숨이가빠"),
      f("형제 비교 갈등", "형제비교", "형과비교"),
      f("다른 학원 비교와 이탈 가능성", "다른학원", "이탈"),
    ],
  },
  {
    id: "consultation-risk-b",
    kind: "consultation",
    consult: { prospect_name: "가명학생별", prospect_grade: "고1", prospect_school: "가명고등학교B", parent_name: "가명보호자B", parent_phone: null },
    transcript: consultationB,
    mustCapture: [
      f("땅콩 알레르기와 에피펜", "땅콩알레르기", "에피펜"),
      f("부모 별거와 교육 갈등", "별거", "부모갈등"),
      f("환불 분쟁 이력", "환불", "분쟁"),
      f("한 달 내 이탈 가능성", "한달안에이탈", "이탈"),
    ],
  },
  {
    id: "form-risk-a",
    kind: "form",
    context: { studentName: "가명학생봄", grade: "중2", school: "가명중학교A" },
    transcript: consultationA,
    mustCapture: [
      f("이전 학원", "가명수학관"),
      f("최근 수학 점수", "62점", "62"),
      f("과호흡 안전 주의", "과호흡"),
      f("환불 규정 문서 요청", "환불규정", "규정문서"),
    ],
  },
  {
    id: "form-risk-b",
    kind: "form",
    context: { studentName: "가명학생별", grade: "고1", school: "가명고등학교B" },
    transcript: consultationB,
    mustCapture: [
      f("이전 공부방", "가명공부방"),
      f("수학 최근 점수", "58점", "58"),
      f("땅콩 알레르기", "땅콩알레르기", "에피펜"),
      f("주 3회 숙제 요청", "주3회", "숙제"),
    ],
  },
  {
    id: "student-consultation-risk-a",
    kind: "studentConsultation",
    context: {
      studentName: "가명학생봄",
      grade: "중2",
      school: "가명중학교A",
      consultedAt: "2026-11-12T10:00:00+09:00",
      audience: "parent",
      category: "학습·정서",
    },
    transcript: consultationA,
    mustCapture: [
      f("환불 분쟁 이력", "환불", "분쟁"),
      f("과호흡 건강 주의", "과호흡", "숨이가빠"),
      f("형제 비교 갈등", "형제비교", "형과비교"),
      f("다른 학원 비교와 이탈 가능성", "다른학원", "이탈"),
    ],
  },
  {
    id: "student-consultation-risk-b",
    kind: "studentConsultation",
    context: {
      studentName: "가명학생별",
      grade: "고1",
      school: "가명고등학교B",
      consultedAt: "2026-11-12T14:00:00+09:00",
      audience: "both",
      category: "재등록·가정",
    },
    transcript: consultationB,
    mustCapture: [
      f("땅콩 알레르기와 에피펜", "땅콩알레르기", "에피펜"),
      f("부모 별거와 교육 갈등", "별거", "부모갈등"),
      f("환불 분쟁 이력", "환불", "분쟁"),
      f("한 달 내 이탈 가능성", "한달안에이탈", "이탈"),
    ],
  },
  {
    id: "prep-brief-a",
    kind: "prep",
    facts: prepFactsA,
    mustCapture: [
      f("땅콩 알레르기 안전 주의", "땅콩알레르기"),
      f("중2 수학 A 후보", "중2수학A"),
      f("월·수 19시", "월수19:00", "월수오후7시"),
      f("월 수강료 320,000원", "320000원", "32만원"),
    ],
  },
  {
    id: "prep-brief-b",
    kind: "prep",
    facts: prepFactsB,
    mustCapture: [
      f("현재 중1 영어 E 수강", "중1영어E"),
      f("과호흡 안전 주의", "과호흡"),
      f("중1 수학 B 후보", "중1수학B"),
      f("월 수강료 280,000원", "280000원", "28만원"),
      f("가명중학교B 셔틀 노선", "가명중학교B정문", "셔틀"),
    ],
  },
  {
    id: "attendance-batch-a",
    kind: "classification",
    items: [
      { id: "a1", studentName: "가명학생가", date: "2026-11-12", content: "오늘 감기 때문에 결석합니다." },
      { id: "a2", studentName: "가명학생나", date: "2026-11-12", content: "내일 병원 들렀다가 7시에 늦게 갈게요." },
      { id: "a3", studentName: "가명학생다", date: "2026-11-12", content: "지난주에 못 갔었는데 보강은 언제 하나요?" },
    ],
    mustCapture: [
      f("오늘 결석", "a1absence2026-11-12"),
      f("내일 지각", "a2late2026-11-13"),
      f("과거 보강 문의는 일반 연락", "a3none"),
    ],
  },
  {
    id: "attendance-batch-b",
    kind: "classification",
    items: [
      { id: "b1", studentName: "가명학생라", date: "2026-11-12", content: "금요일은 가족 일정으로 쉬겠습니다." },
      { id: "b2", studentName: "가명학생마", date: "2026-11-12", content: "오늘 6시 30분에 일찍 데리러 갑니다." },
      { id: "b3", studentName: "가명학생바", date: "2026-11-12", content: "교재비 입금 확인 부탁드립니다." },
    ],
    mustCapture: [
      f("금요일 결석", "b1absence2026-11-13"),
      f("당일 조퇴", "b2early_leave2026-11-12"),
      f("입금 확인은 일반 연락", "b3none"),
    ],
  },
  {
    id: "notice-a",
    kind: "translation",
    source: { title: "AYWA 강사 연수", body: "11월 20일 오후 4시에 가명교실A에서 연수를 진행합니다.\n자료는 @[내 메뉴](menu:/my-menu)에서 확인해 주세요.", linkLabel: "ClassNote 안내 보기" },
    mustCapture: [
      f("AYWA 고유명사 보존", "AYWA"),
      f("메뉴 참조 보존", "@[내메뉴](menu:/my-menu)"),
      f("ClassNote 고유명사 보존", "ClassNote"),
    ],
  },
  {
    id: "notice-b",
    kind: "translation",
    source: { title: "가명반B 휴강 안내", body: "12월 1일 수업은 휴강입니다.\n보강은 12월 3일 오후 6시에 진행합니다.", linkLabel: "일정 확인" },
    mustCapture: [
      f("가명반B 보존", "가명반B"),
      f("12월 1일 휴강", "december1", "12/1"),
      f("12월 3일 보강", "december3", "12/3"),
    ],
  },
  {
    id: "meeting-operations-a",
    kind: "meeting",
    transcript: meetingA,
    context: { title: "토요일 보충반 운영회의", heldAt: "2026. 11. 12.", attendees: ["가명직원A", "가명직원B", "가명직원C"], notepad: "11/22 14시 시범반 확정 · A 11/14 명단 · C 11/16 셔틀 · 11/18 10시 점검" },
    mustCapture: [
      f("시범반 일정 결정", "11월22일오후2시", "11/2214시"),
      f("학생 명단 담당과 기한", "가명직원A11월14일", "A11/14"),
      f("셔틀 확인 담당과 기한", "가명직원C11월16일", "C11/16"),
      f("다음 점검 회의", "11월18일오전10시", "11/1810시"),
    ],
  },
  {
    id: "meeting-operations-b",
    kind: "meeting",
    transcript: meetingB,
    context: { title: "환불 안내 개정 강사회의", heldAt: "2026. 11. 12.", attendees: ["가명직원A", "가명직원B", "가명직원C"], notepad: "12/1 시행 · B 11/20 초안 · C 11/21 템플릿 · 11/24 09:30 교육 · 미작성 7건" },
    mustCapture: [
      f("새 안내문 시행일", "12월1일", "12/1"),
      f("초안 담당과 기한", "가명직원B11월20일", "B11/20"),
      f("미작성 상담 7건", "미작성상담기록일곱건", "미작성7건"),
      f("최종 점검과 교육", "11월24일오전9시30분", "11/2409:30"),
    ],
  },
];

export const BUILT_IN_ANALYSIS_CASES = BUILT_IN_ANALYSIS_SEEDS.map(buildAnalysisCase);
