/**
 * 분석용 온톨로지 보기 설명(s2_0039 · 2026-11-09) — 원장 질문 *"학생이 점점 줄어드는 원인"* 답 검토에서 비서가 잘못 읽은 자리를
 * DB가 미리 계산해 둔 보기들. 규칙은 앱 함수와 같다(SQL 주석에 대응 함수) — 🔴 규칙을 바꾸면 SQL과 이 글을 함께 고칠 것.
 */
import type { AssistantTableDoc } from "./types";

export const ONTOLOGY_ANALYSIS_DOCS: readonly AssistantTableDoc[] = [
  {
    name: "onto_classes",
    label: "반(상태)",
    ko: "반 한 줄 + 상태(운영 중·종강·종강 예정·폐지) · 프로그램(수학·인재원 영어·EiE·그 밖)",
    notes:
      "state = running(운영 중) · closed(종강 — 종강일이 오늘이거나 지남) · closing(종강 예정) · abolished(폐지 · is_active=false). state_label = 한국어. " +
      "program = 영어 반은 english_track이 eie면 'eie', 아니면 'injaewon'(인재원 영어 — EiE가 아닌 영어 전부) · 그 밖은 과목 키. program_label = 화면 이름(과목 이름은 학원 설정). " +
      "종강·폐지 반을 빼면 그 반 학생의 흐름이 사라진다 — 반 운영이 원인인지 볼 때는 종강 반도 함께 본다(closed_on = 종강일).",
    columns: { state: "running·closed·closing·abolished", closed_on: "종강일", makeup_pool: "보강용 반", homeroom_teacher_id: "지금 담임(users.id)" },
  },
  {
    name: "onto_homeroom_history",
    label: "담임 이력",
    ko: "반의 담임 구간(그때 담임 · 시작일 포함 ~ 끝날 미포함) — 앱의 담임 복원과 같은 규칙",
    notes:
      "감사 기록의 담임 전이(인수인계 적용 · 반 수정에서 담임 바꿈)로 만든 구간이다. valid_from이 비면 시작을 모른다 · valid_to가 비면 지금까지. " +
      "source = handover(담임 변경 기록) · before_first(첫 변경 기록에 적힌 이전 담임 — 시작일 모름) · current_override(마지막 기록과 지금 담임이 달라 지금 값) · no_record(바뀐 기록이 없는 반 — 지금 담임을 그대로 둔 것, 과거에도 같았는지는 모른다). " +
      "날짜 D의 담임 = valid_from ≤ D(또는 비어 있음) and (valid_to > D 또는 비어 있음). 담임 변경 기록은 2026년 6월 하순부터 있고, 반 수정 화면의 담임 변경은 8월 중순부터 남았다 — 그 전 담임은 이 보기로 알 수 없다.",
    columns: { valid_from: "그 담임이 시작한 날(포함)", valid_to: "끝난 날(미포함)", source: "구간 근거" },
  },
  {
    name: "onto_siblings",
    label: "형제",
    ko: "형제 짝(양쪽 방향 두 줄) — 앱 판정 그대로: 보호자 휴대폰 같음 · 학부모 이름 같음 · 직원 지정",
    notes:
      "basis = phone(보호자1·2 휴대폰 중 하나라도 같음) · name(학부모 이름이 같고 한쪽은 보호자 휴대폰이 없음) · manual(직원이 형제로 지정). " +
      "직원이 '형제 아님'으로 뺀 짝은 없다. 학생 이름이 같은 짝(같은 아이의 중복 기록)은 형제가 아니다. student_id 하나로 거르면 그 원생의 형제 전부.",
    columns: { sibling_id: "형제 원생 id", basis: "phone·name·manual" },
  },
  {
    name: "onto_households",
    label: "가구",
    ko: "형제로 이어진 원생 묶음 — 원생 한 줄 · 가구 id · 가구 인원(형제가 없는 원생은 줄이 없다)",
    notes: "household_id = 그 묶음에서 가장 작은 원생 id(이름 없음 — 가구를 부를 땐 가장 나이 많은 학생 이름 + '형제/남매'로). household_size = 묶음 인원(퇴원생 포함). 가구 단위 이탈 = 한 가구의 다니던 자녀가 모두 나간 경우 — 같은 날 나갔는지는 퇴원일로 따로 본다.",
  },
  {
    name: "onto_tuition_months",
    label: "청구 학생(월)",
    ko: "학생·청구 달 한 줄 — 그 달 수업료 청구가 살아 있는 학생(취소·환불 제외 · 미납 포함)",
    notes:
      "앱 '지난 기록'의 청구 학생과 같은 뜻이다(달마다 학생 수를 세면 student_history_monthly의 payingTotal과 같다). eie_billed = [EiE] 수업 줄 · general_billed = 그 밖의 수업 줄. " +
      "🔴 programs_enrolled = 그 달에 걸친 수강의 반 프로그램(math·injaewon·eie… · 보강용 반 제외 · 수강 기록이 없으면 비어 있다) — 앱이 수업명으로 가르는 프로그램과 다를 수 있다(인재원 영어가 특히). 학원 전체 프로그램별 청구 학생 수는 student_history_monthly(source='aywa' — payingMath·payingInjaewon·payingEie)를 쓰고, 학생 단위로 볼 때만 이 칸을 쓴다. lesson_names = 수업명 원문. " +
      "counted = false는 테스트·중복 병합·장부 정리 원생(학년별·프로그램별로 나눌 때 빼면 총원과 합이 어긋난다 — 어느 쪽으로 셌는지 밝힌다). '청구가 끊김'은 퇴원이 아니다(휴원·청구 누락·복귀가 섞인다 — 퇴원은 onto_students).",
    columns: { month: "청구 달(1일)", programs_enrolled: "그 달 수강 반의 프로그램", lesson_names: "수업명 원문", counted: "집계에 넣는 원생" },
  },
  {
    name: "onto_teacher_churn",
    label: "강사 퇴원율",
    ko: "강사·달별 퇴원율 — 앱 강사평가가 계산·마감한 값 그대로(그때 담임·교시 담당 기준)",
    notes:
      "churn_rate = 퇴원율(%) = quit_students ÷ base_students. base_students = 지난달 정규 수업으로 16일 이상 맡은 학생(그때 담임·교시 담당 모두) · quit_students = 이 달 그 선생님 반·가르친 과목을 그만둔 학생(원장이 고른 제외 사유 · 반 이동 · 같은 과목 계속 수강은 빼고 한 번씩). " +
      "quits = 그만둔 학생 목록(day · studentId · reason · className · counted). month_closed = 그 달이 마감돼 값이 굳음(진행 중인 달은 바뀐다). 🔴 강사별 퇴원율은 이 값을 쓴다 — 지금 담임을 과거 학생에게 붙여 따로 계산하지 않는다. 담당 학생 수가 적은 달의 비율은 흔들린다(분모를 함께 밝힌다).",
    columns: { churn_rate: "퇴원율(%)", base_students: "분모(지난달 담당 학생)", quit_students: "분자(그만둔 학생)", quits: "그만둔 학생 목록(jsonb)" },
  },
];
