/**
 * 반 필터의 '전체' 자리 — **라벨이 아니라 값**이다.
 *
 * 🔴 서버 로스터가 `classTags = ["전체", ...반 이름]`으로 목록을 만들고 클라가 그 문자열로
 *    "지금 전체인가"를 판정한다(`classFilter === CLASS_TAG_ALL`). 화면 글자를 영어로 옮길 때
 *    이 값까지 같이 바꾸면 **필터가 영영 안 맞는다** — 그래서 값은 상수 한 곳에 두고,
 *    보이는 글자는 사전(`os.class.all`)이 따로 정한다.
 */
export const CLASS_TAG_ALL = "전체";

/**
 * 반 이름이 없는 학생을 모으는 **묶음 키** — Map의 키이자 폴백 표기다.
 * 화면에 적는 글자는 사전(`os.list.noClass`·`os.status.noClass`)이 따로 정한다.
 */
export const CLASS_GROUP_OTHER = "기타";
export const CLASS_GROUP_NONE = "반 미배정";

/**
 * 반이 없는 **보강 행**을 모으는 묶음 키(학생 목록) — 위와 같은 규약: 값은 Map 키, 화면 글자는 사전
 * (`os.list.makeup`)이 따로 정한다. 🔴 값을 영어로 바꾸지 말 것 — 반 순서(`classOrder`)와 같은 축의 키다.
 */
export const CLASS_GROUP_MAKEUP = "보강";
