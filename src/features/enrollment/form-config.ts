// 등록 상담 폼 — 공유 옵션/필드 config(클라·서버 공용. ⚠️ server-only 금지, [[#61]]).
// 과목/학년은 학원설정 단일소스(useSubjectMaps/useGradeLevels)에서 — 여기 하드코딩 금지.

export const GENDER_OPTIONS = [
  { value: "male", label: "남" },
  { value: "female", label: "여" },
] as const;

export const BLOOD_OPTIONS = ["A", "B", "O", "AB"] as const;
export const RELATION_OPTIONS = ["모", "부", "조부", "조모", "기타"] as const;
export const SIBLINGS_OPTIONS = ["외동", "형제자매 있음"] as const;
export const CONSULTATION_PATHS = [
  "지인 소개",
  "인터넷 검색",
  "블로그/카페",
  "간판/현수막",
  "전단지",
  "설명회",
  "재원생 추천",
  "기타",
] as const;
export const REGISTRATION_STATUSES = [
  "상담전",
  "이번달 등록예정",
  "추후 등록예정",
  "등록완료",
  "미등록",
] as const;

// ── 과목별 점수 탭(subject_details jsonb) ──
// ijw ConsultationForm 과목 탭 이식. 데이터 주도 — 폼이 이 config를 map해 입력 렌더(필드 수기 나열 회피).
// type: text=1행 · date=날짜 · textarea=여러 줄(히스토리/상담류)
//     · score=좁은 점수칸(정수 3자리 + 소수 2자리까지 — 정규화는 score-input.ts `sanitizeScoreInput`)
export type FieldDef = { key: string; label: string; type?: "text" | "date" | "textarea" | "score" };
export type FieldGroup = { title?: string; cols?: number; fields: FieldDef[] };

// 과목 공통 필드(학원히스토리·진도·시험성적·추천반·담임·기타 등). math/국어/과학 탭에 포함되며,
// 라벨 매핑(상세 '과목별 점수' 카드)에서 영어 포함 모든 과목에 공통 라벨로도 쓰인다(export).
export const COMMON_FIELDS: FieldGroup = {
  title: "공통",
  cols: 2,
  fields: [
    { key: "academyHistory", label: "학원 히스토리", type: "textarea" },
    { key: "learningProgress", label: "학습 진도", type: "textarea" },
    { key: "examResults", label: "시험 성적", type: "textarea" },
    { key: "consultationHistory", label: "상담 내역", type: "textarea" },
    { key: "recommendedClass", label: "추천반" },
    { key: "homeRoomTeacher", label: "담임" },
    { key: "firstClassDate", label: "첫 수업일", type: "date" },
    { key: "notes", label: "기타", type: "textarea" },
  ],
};

const MATH_GROUPS: FieldGroup[] = [
  {
    title: "영역별 점수",
    cols: 4,
    fields: [
      { key: "calculationScore", label: "계산력" },
      { key: "comprehensionScore", label: "이해력" },
      { key: "reasoningScore", label: "추론력" },
      { key: "problemSolvingScore", label: "문제해결력" },
    ],
  },
  {
    title: "종합",
    cols: 3,
    fields: [
      { key: "myTotalScore", label: "내 점수" },
      { key: "averageScore", label: "평균 점수" },
      { key: "scoreGrade", label: "등급" },
    ],
  },
  COMMON_FIELDS,
];

// 영어 — 테스트 유형(ai/nelt/eie)별 필드 세트. 폼이 testType 선택값에 따라 해당 그룹만 노출.
export const ENGLISH_TEST_TYPES = [
  { value: "ai", label: "AI 레벨테스트" },
  { value: "nelt", label: "NELT" },
  { value: "eie", label: "EiE" },
] as const;

export const ENGLISH_GROUPS: Record<string, FieldGroup[]> = {
  ai: [
    {
      title: "AI 종합",
      cols: 3,
      fields: [
        { key: "aiGradeLevel", label: "학년 수준" },
        { key: "aiArIndex", label: "AR 지수" },
        { key: "aiTopPercent", label: "상위 %" },
      ],
    },
    {
      title: "AI 세부 (내 점수 / 평균)",
      cols: 4,
      fields: [
        { key: "aiWordMy", label: "단어(내)", type: "score" },
        { key: "aiWordAvg", label: "단어(평균)", type: "score" },
        { key: "aiListenMy", label: "듣기(내)", type: "score" },
        { key: "aiListenAvg", label: "듣기(평균)", type: "score" },
        { key: "aiReadMy", label: "읽기(내)", type: "score" },
        { key: "aiReadAvg", label: "읽기(평균)", type: "score" },
        { key: "aiWriteMy", label: "쓰기(내)", type: "score" },
        { key: "aiWriteAvg", label: "쓰기(평균)", type: "score" },
      ],
    },
  ],
  nelt: [
    {
      title: "NELT 종합",
      cols: 2,
      fields: [
        { key: "neltOverallLevel", label: "종합 수준" },
        { key: "neltRank", label: "동학년 석차" },
      ],
    },
    {
      title: "NELT 세부",
      cols: 4,
      fields: [
        { key: "neltVocab", label: "어휘", type: "score" },
        { key: "neltGrammar", label: "문법", type: "score" },
        { key: "neltListening", label: "듣기", type: "score" },
        { key: "neltReading", label: "독해", type: "score" },
      ],
    },
  ],
  eie: [
    {
      title: "EiE 종합",
      cols: 3,
      fields: [
        { key: "eieGradeLevel", label: "학년 수준" },
        { key: "eieVocabLevel", label: "어휘 수준" },
        { key: "eieRank", label: "동학년 순위" },
      ],
    },
    {
      title: "EiE Level Chart",
      cols: 3,
      fields: [
        { key: "eieCourse", label: "과정" },
        { key: "eieChartLevel", label: "레벨" },
        { key: "eieTextbook", label: "교재" },
      ],
    },
    {
      title: "EiE 세부 (내 점수 / 평균)",
      cols: 4,
      fields: [
        { key: "eieVocabMy", label: "어휘(내)", type: "score" },
        { key: "eieVocabAvg", label: "어휘(평균)", type: "score" },
        { key: "eieListenMy", label: "듣기(내)", type: "score" },
        { key: "eieListenAvg", label: "듣기(평균)", type: "score" },
        { key: "eieReadMy", label: "읽기(내)", type: "score" },
        { key: "eieReadAvg", label: "읽기(평균)", type: "score" },
        { key: "eieGrammarMy", label: "문법(내)", type: "score" },
        { key: "eieGrammarAvg", label: "문법(평균)", type: "score" },
      ],
    },
  ],
};

const LEVEL_GROUPS: FieldGroup[] = [
  { title: "레벨테스트", cols: 1, fields: [{ key: "levelTestScore", label: "레벨테스트 점수" }] },
  COMMON_FIELDS,
];

/** 과목 탭 정의. 영어는 testType 분기라 groups 대신 별도 처리(ENGLISH_GROUPS). */
export const SUBJECT_TABS: { key: string; label: string; groups?: FieldGroup[]; english?: boolean }[] = [
  { key: "math", label: "수학", groups: MATH_GROUPS },
  { key: "english", label: "영어", english: true },
  { key: "korean", label: "국어", groups: LEVEL_GROUPS },
  { key: "science", label: "과학", groups: LEVEL_GROUPS },
  { key: "etc", label: "기타", groups: LEVEL_GROUPS },
];

export type SubjectDetails = Record<string, Record<string, string>>;
