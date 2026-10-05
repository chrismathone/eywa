# Codex 자체 적대 검토 — v1

판정: **CHANGES_REQUIRED**. Claude 검토와 별도로 초안의 아래 조건을 구체화해야 한다.

1. **native 판정을 mapped legacy보다 우선해야 한다.** 완료된 native를 먼저 필터하면 아직 reserved인 기존 반영 행이 다시 보일 수 있다. 모든 읽을 수 있는 참여와 연결을 먼저 대조하고 새 상태로 기존 행을 대체한 다음 예정 조건을 적용한다. 반영 pending/failed, 참가 취소/변경 및 released 매핑을 수용 기준에 넣는다. linked 과거 done를 imported한 참여는 unknown이어도 근거 확인 업무로 보내야 하며 미래 예약으로 되살리지 않는다.
2. **새 조회 호환을 공용 명단 파서에 강제하지 않는다.** 공용 participant 응답은 구버전에서도 기존 명단/보고서가 동작하게 추가 필드를 선택적으로 파싱한다. 예정/일정의 새 상태 판단에는 별도 contract_version=2를 요구하고 미지원/조회 실패를 숫자0으로 표시하지 않는다. DB 먼저 배포해도 앱 롤백과 계약 결여 테스트가 필요하다.
3. **새 문맥 접수의 최신 유효 결석 검증을 저장 시점에도 수행한다.** 0346a는 보낸 출결 행의 상태를 검사하나 latest superseding correction 전체를 확인하지 않는다. 새 읽기에서만 확인하면 정정 경쟁을 막지 못한다. intake의 attendance 원경로에만 최신 셀/같은 날 유효 출석/원반 소속 검사를 추가하고 기존 공통 출결 쓰기와 맞는 잠금 또는 충돌 검증을 적용한다. 돈/권리 산식은 유지한다. 시점 검증 추가와 writer 전체 불변이라는 문구의 모순을 없앤다.
4. **미연결 예약 총수는 예약과 옛 이행을 분리한다.** 0264a의 legacy status는 reserved/done 두 개이며 cancelled 상태는 없다(취소는 삭제/새 참여 이력). 0348e의 후보 전체 total은 둘을 포함한다. P1의 진행 예약은 reserved, 옛 done는 ‘기존 이행 검토’로 별도 분리하고 날짜 지난 reserved는 자동 노쇼/완료가 아니다.
5. **기존 예약 연결 버튼의 권한은 intake 권한과 다르다.** 0346i link_legacy는 wide 수준을 요구한다. 일반 강사의 기존 예약 저장에 관리 연결 버튼을 무조건 제공하지 않는다. 서버가 허용하는 기능별 capability에 맞춰 표시하고, 권한 없는 사용자의 업무는 관리자 연결 대기임을 알린다. 기존 permissions.ts의 intake 제외 화면 도우미와 실제 SQL 권한은 별개이므로 그 도우미로 간편 접수를 숨기지 않는다.
6. **일정의 legacy 미등록 정보 필터를 결정한다.** legacy created_by는 실시 강사가 아니다. 특정 강사/강의실 필터에서 legacy 미등록 행을 임의 배정하지 않으며 ‘미등록’ 선택으로 따로 찾을 수 있게 한다. pending imported의 실제 강사/강의실은 확인된 새 회차 정보만 사용한다. 연결 후 잠금/원장 승인 대기를 유지한다.
7. **문맥 진입을 실제 공용 부품에 매핑한다.** 현존 출석부 학생 행, 강사뷰 결석 선택창, 공용 MakeupConfirmDialog에서 출결 저장과 새 접수를 별도 액션으로 제공한다. 날짜 없는 학생 선택만으로 원결석을 만들지 않는다. 기존 add 흐름의 저장와 신규 intake 실패를 원자적 성공으로 설명하지 않는다.
8. **변경 전파와 화면 복귀 검증을 명시한다.** client refresh 명령은 mutation signal로 다른 창을 갱신한다. dashboard, timetable, student, schedule, unlinked counter가 갱신을 받도록 현재 invalidation 계약을 확장하고 창 재진입/새로고침과 같은 예약 ID의 반영 지연을 테스트한다.

소스 근거: makeup-upcoming.ts, makeup-reservation-queries.ts, 0348c participant 읽기, 0348e 후보 읽기, 0346a intake, 0346i link_legacy, 0264a 예약 상태, makeups schemas/actions/list-navigation, 공용 MakeupAddFlow/MakeupConfirmDialog. 이 문서는 계획 검토이며 추가 앱 결함을 브라우저에서 재현했다고 주장하지 않는다.
