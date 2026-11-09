/** Final workbook manifest: 2026-11-03, 41 sheets. Definitions only; no example values. */
export const blueprint = [
  {
    "id": "00_대시보드",
    "role": "output",
    "href": "/dashboard",
    "fields": [
      {
        "id": "0",
        "label": "지표"
      },
      {
        "id": "1",
        "label": "현재값"
      },
      {
        "id": "2",
        "label": "집계 기준"
      }
    ]
  },
  {
    "id": "01_설정",
    "role": "config",
    "href": "/settings",
    "fields": [
      {
        "id": "0",
        "label": "설정 항목"
      },
      {
        "id": "1",
        "label": "설정값"
      },
      {
        "id": "2",
        "label": "정의"
      }
    ]
  },
  {
    "id": "02_학생통합뷰",
    "role": "output",
    "href": "/students",
    "fields": [
      {
        "id": "0",
        "label": "항목"
      },
      {
        "id": "1",
        "label": "값"
      },
      {
        "id": "2",
        "label": "연결되는 기록"
      }
    ]
  },
  {
    "id": "03_신입생90일뷰",
    "role": "output",
    "href": "/newcomers",
    "fields": [
      {
        "id": "0",
        "label": "학생ID"
      },
      {
        "id": "1",
        "label": "학생명"
      },
      {
        "id": "2",
        "label": "등록일"
      },
      {
        "id": "3",
        "label": "경과일"
      },
      {
        "id": "4",
        "label": "정착 단계"
      },
      {
        "id": "5",
        "label": "수학 관리자"
      },
      {
        "id": "6",
        "label": "영어 관리자"
      },
      {
        "id": "7",
        "label": "EiE 관리자"
      },
      {
        "id": "8",
        "label": "미완료 필수"
      },
      {
        "id": "9",
        "label": "기한 경과"
      },
      {
        "id": "10",
        "label": "미확인 피드백"
      },
      {
        "id": "11",
        "label": "다음 조치"
      },
      {
        "id": "12",
        "label": "장기재원 인계"
      }
    ]
  },
  {
    "id": "04_3년비교연간기획",
    "role": "build",
    "href": "/marketing",
    "fields": [
      {
        "id": "0",
        "label": "비교그룹ID"
      },
      {
        "id": "1",
        "label": "반복 행사·주제"
      },
      {
        "id": "2",
        "label": "월"
      },
      {
        "id": "3",
        "label": "3년전 비용"
      },
      {
        "id": "4",
        "label": "3년전 등록"
      },
      {
        "id": "5",
        "label": "2년전 비용"
      },
      {
        "id": "6",
        "label": "2년전 등록"
      },
      {
        "id": "7",
        "label": "전년 비용"
      },
      {
        "id": "8",
        "label": "전년 등록"
      },
      {
        "id": "9",
        "label": "전년 귀속수입"
      },
      {
        "id": "10",
        "label": "전년 회고"
      },
      {
        "id": "11",
        "label": "신년 계획"
      },
      {
        "id": "12",
        "label": "목표일"
      },
      {
        "id": "13",
        "label": "담당자ID"
      },
      {
        "id": "14",
        "label": "예산"
      },
      {
        "id": "15",
        "label": "등록 목표"
      },
      {
        "id": "16",
        "label": "유지·변경·중단"
      },
      {
        "id": "17",
        "label": "결정 근거"
      }
    ]
  },
  {
    "id": "05_월별경영분석",
    "role": "build",
    "href": "/dashboard/management",
    "fields": [
      {
        "id": "0",
        "label": "기준월"
      },
      {
        "id": "1",
        "label": "월말 재원생"
      },
      {
        "id": "2",
        "label": "활성 강좌"
      },
      {
        "id": "3",
        "label": "실청구액"
      },
      {
        "id": "4",
        "label": "청구분 순수납"
      },
      {
        "id": "5",
        "label": "회계매출"
      },
      {
        "id": "6",
        "label": "영업비용"
      },
      {
        "id": "7",
        "label": "인건비"
      },
      {
        "id": "8",
        "label": "영업이익"
      },
      {
        "id": "9",
        "label": "영업이익률"
      },
      {
        "id": "10",
        "label": "인건비율"
      },
      {
        "id": "11",
        "label": "학생당 매출"
      },
      {
        "id": "12",
        "label": "영수 동시수강"
      },
      {
        "id": "13",
        "label": "동시수강 비율"
      },
      {
        "id": "14",
        "label": "신규등록"
      },
      {
        "id": "15",
        "label": "학원전체 퇴원"
      },
      {
        "id": "16",
        "label": "월초 재원생"
      },
      {
        "id": "17",
        "label": "월 퇴원율"
      },
      {
        "id": "18",
        "label": "마감 상태"
      }
    ]
  },
  {
    "id": "06_강사성과",
    "role": "build",
    "href": "/class-review/knowledge",
    "fields": [
      {
        "id": "0",
        "label": "기준월"
      },
      {
        "id": "1",
        "label": "직원ID"
      },
      {
        "id": "2",
        "label": "과목"
      },
      {
        "id": "3",
        "label": "담당 노출학생"
      },
      {
        "id": "4",
        "label": "전체퇴원 학생"
      },
      {
        "id": "5",
        "label": "과목종료 학생"
      },
      {
        "id": "6",
        "label": "평균 이전점수"
      },
      {
        "id": "7",
        "label": "평균 현재점수"
      },
      {
        "id": "8",
        "label": "비교 표본수"
      },
      {
        "id": "9",
        "label": "만족도 평균"
      },
      {
        "id": "10",
        "label": "응답수"
      },
      {
        "id": "11",
        "label": "연결상담수"
      },
      {
        "id": "12",
        "label": "예정상담수"
      },
      {
        "id": "13",
        "label": "진도 이행수"
      },
      {
        "id": "14",
        "label": "계획수"
      },
      {
        "id": "15",
        "label": "귀속매출"
      },
      {
        "id": "16",
        "label": "총인건비"
      },
      {
        "id": "17",
        "label": "전체퇴원 비율"
      },
      {
        "id": "18",
        "label": "성적 변화"
      },
      {
        "id": "19",
        "label": "상담 이행률"
      },
      {
        "id": "20",
        "label": "진도 이행률"
      },
      {
        "id": "21",
        "label": "급여 매출비"
      },
      {
        "id": "22",
        "label": "비교집단·근거"
      },
      {
        "id": "23",
        "label": "지원·배정 제안"
      },
      {
        "id": "24",
        "label": "관리자 검토"
      }
    ]
  },
  {
    "id": "07_채널성과",
    "role": "build",
    "href": "/marketing",
    "fields": [
      {
        "id": "0",
        "label": "채널"
      },
      {
        "id": "1",
        "label": "캠페인수"
      },
      {
        "id": "2",
        "label": "집행비용"
      },
      {
        "id": "3",
        "label": "문의 기여수"
      },
      {
        "id": "4",
        "label": "등록 기여수"
      },
      {
        "id": "5",
        "label": "귀속 순수입"
      },
      {
        "id": "6",
        "label": "등록당 비용 CPE"
      },
      {
        "id": "7",
        "label": "수입 비용비 ROAS"
      },
      {
        "id": "8",
        "label": "계산 범위"
      }
    ]
  },
  {
    "id": "08_기여도상대평가",
    "role": "build",
    "href": "/student-contribution",
    "fields": [
      {
        "id": "0",
        "label": "학생ID"
      },
      {
        "id": "1",
        "label": "학생명"
      },
      {
        "id": "2",
        "label": "상태"
      },
      {
        "id": "3",
        "label": "수익 기여"
      },
      {
        "id": "4",
        "label": "유지 기여"
      },
      {
        "id": "5",
        "label": "확산 기여"
      },
      {
        "id": "6",
        "label": "성장 가능성"
      },
      {
        "id": "7",
        "label": "지원 부담"
      },
      {
        "id": "8",
        "label": "유지 위험"
      },
      {
        "id": "9",
        "label": "정밀 기여점수"
      },
      {
        "id": "10",
        "label": "측정 상태"
      },
      {
        "id": "11",
        "label": "모형 버전"
      },
      {
        "id": "12",
        "label": "비교 점수"
      },
      {
        "id": "13",
        "label": "공동 순위"
      },
      {
        "id": "14",
        "label": "동점수"
      },
      {
        "id": "15",
        "label": "상위 비율"
      },
      {
        "id": "16",
        "label": "등급"
      },
      {
        "id": "17",
        "label": "최저점"
      },
      {
        "id": "18",
        "label": "최고점"
      },
      {
        "id": "19",
        "label": "최저최고 위치"
      }
    ]
  },
  {
    "id": "09_채용시뮬레이션",
    "role": "build",
    "href": "/dashboard/management#accounting",
    "fields": [
      {
        "id": "0",
        "label": "항목"
      },
      {
        "id": "1",
        "label": "입력·계산값"
      },
      {
        "id": "2",
        "label": "단위·기준"
      }
    ]
  },
  {
    "id": "10_학생",
    "role": "input",
    "href": "/students",
    "fields": [
      {
        "id": "0",
        "label": "학생ID"
      },
      {
        "id": "1",
        "label": "지점ID"
      },
      {
        "id": "2",
        "label": "학생명"
      },
      {
        "id": "3",
        "label": "학교ID"
      },
      {
        "id": "4",
        "label": "학년"
      },
      {
        "id": "5",
        "label": "등록일"
      },
      {
        "id": "6",
        "label": "전체퇴원일"
      },
      {
        "id": "7",
        "label": "현재상태"
      },
      {
        "id": "8",
        "label": "가구ID"
      },
      {
        "id": "9",
        "label": "보호자ID"
      },
      {
        "id": "10",
        "label": "입학상담ID"
      },
      {
        "id": "11",
        "label": "대표 요구사항"
      },
      {
        "id": "12",
        "label": "장기재원 인계일"
      },
      {
        "id": "13",
        "label": "원본시스템"
      },
      {
        "id": "14",
        "label": "원본ID"
      },
      {
        "id": "15",
        "label": "수집일"
      },
      {
        "id": "16",
        "label": "기준일 재원"
      },
      {
        "id": "17",
        "label": "수학 수강수"
      },
      {
        "id": "18",
        "label": "영어 수강수"
      },
      {
        "id": "19",
        "label": "EiE 수강수"
      },
      {
        "id": "20",
        "label": "영수 동시수강"
      }
    ]
  },
  {
    "id": "11_직원",
    "role": "input",
    "href": "/staff",
    "fields": [
      {
        "id": "0",
        "label": "직원ID"
      },
      {
        "id": "1",
        "label": "지점ID"
      },
      {
        "id": "2",
        "label": "성명"
      },
      {
        "id": "3",
        "label": "직책"
      },
      {
        "id": "4",
        "label": "역할"
      },
      {
        "id": "5",
        "label": "담당과목"
      },
      {
        "id": "6",
        "label": "소속팀"
      },
      {
        "id": "7",
        "label": "상태"
      },
      {
        "id": "8",
        "label": "입사일"
      },
      {
        "id": "9",
        "label": "퇴사일"
      },
      {
        "id": "10",
        "label": "상위담당자ID"
      },
      {
        "id": "11",
        "label": "업무권한 범위"
      },
      {
        "id": "12",
        "label": "원본ID"
      }
    ]
  },
  {
    "id": "12_강좌",
    "role": "input",
    "href": "/classes",
    "fields": [
      {
        "id": "0",
        "label": "강좌ID"
      },
      {
        "id": "1",
        "label": "지점ID"
      },
      {
        "id": "2",
        "label": "강좌명"
      },
      {
        "id": "3",
        "label": "과목"
      },
      {
        "id": "4",
        "label": "과정"
      },
      {
        "id": "5",
        "label": "시작일"
      },
      {
        "id": "6",
        "label": "종료일"
      },
      {
        "id": "7",
        "label": "담임ID"
      },
      {
        "id": "8",
        "label": "보조강사ID"
      },
      {
        "id": "9",
        "label": "정원"
      },
      {
        "id": "10",
        "label": "주당 수업시간"
      },
      {
        "id": "11",
        "label": "강의실"
      },
      {
        "id": "12",
        "label": "학교·학년 대상"
      },
      {
        "id": "13",
        "label": "원본ID"
      }
    ]
  },
  {
    "id": "13_수강이력",
    "role": "input",
    "href": "/students",
    "fields": [
      {
        "id": "0",
        "label": "수강ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "강좌ID"
      },
      {
        "id": "3",
        "label": "과목"
      },
      {
        "id": "4",
        "label": "시작일"
      },
      {
        "id": "5",
        "label": "종료일"
      },
      {
        "id": "6",
        "label": "상태"
      },
      {
        "id": "7",
        "label": "담임ID"
      },
      {
        "id": "8",
        "label": "첫수업일"
      },
      {
        "id": "9",
        "label": "종료사유"
      },
      {
        "id": "10",
        "label": "귀속비중"
      },
      {
        "id": "11",
        "label": "원본ID"
      },
      {
        "id": "12",
        "label": "기준일 활성"
      }
    ]
  },
  {
    "id": "14_문의방문상담",
    "role": "input",
    "href": "/consultations",
    "fields": [
      {
        "id": "0",
        "label": "상담기록ID"
      },
      {
        "id": "1",
        "label": "문의ID"
      },
      {
        "id": "2",
        "label": "학생ID"
      },
      {
        "id": "3",
        "label": "일시"
      },
      {
        "id": "4",
        "label": "단계"
      },
      {
        "id": "5",
        "label": "과목"
      },
      {
        "id": "6",
        "label": "상담자ID"
      },
      {
        "id": "7",
        "label": "실제 연결여부"
      },
      {
        "id": "8",
        "label": "방문예약일"
      },
      {
        "id": "9",
        "label": "실제방문일"
      },
      {
        "id": "10",
        "label": "학부모 요구"
      },
      {
        "id": "11",
        "label": "합의·약속ID"
      },
      {
        "id": "12",
        "label": "다음액션"
      },
      {
        "id": "13",
        "label": "기한"
      },
      {
        "id": "14",
        "label": "결과"
      },
      {
        "id": "15",
        "label": "미등록 사유"
      },
      {
        "id": "16",
        "label": "접점ID"
      },
      {
        "id": "17",
        "label": "원본시스템"
      },
      {
        "id": "18",
        "label": "원본ID"
      },
      {
        "id": "19",
        "label": "작성자ID"
      }
    ]
  },
  {
    "id": "15_입학요구약속",
    "role": "input",
    "href": "/newcomers",
    "fields": [
      {
        "id": "0",
        "label": "약속ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "과목"
      },
      {
        "id": "3",
        "label": "최초상담ID"
      },
      {
        "id": "4",
        "label": "보호자 요구"
      },
      {
        "id": "5",
        "label": "합의한 약속"
      },
      {
        "id": "6",
        "label": "검증 가능한 완료기준"
      },
      {
        "id": "7",
        "label": "담당자ID"
      },
      {
        "id": "8",
        "label": "인수확인일"
      },
      {
        "id": "9",
        "label": "기한"
      },
      {
        "id": "10",
        "label": "실행 기록"
      },
      {
        "id": "11",
        "label": "완료일"
      },
      {
        "id": "12",
        "label": "증거ID"
      },
      {
        "id": "13",
        "label": "검토자ID"
      },
      {
        "id": "14",
        "label": "검토결과"
      },
      {
        "id": "15",
        "label": "후속 조치"
      },
      {
        "id": "16",
        "label": "변경합의 내용"
      },
      {
        "id": "17",
        "label": "상태"
      }
    ]
  },
  {
    "id": "16_과목별관리배정",
    "role": "input",
    "href": "/newcomers",
    "fields": [
      {
        "id": "0",
        "label": "배정ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "과목"
      },
      {
        "id": "3",
        "label": "등록일"
      },
      {
        "id": "4",
        "label": "첫수업일"
      },
      {
        "id": "5",
        "label": "담임ID"
      },
      {
        "id": "6",
        "label": "개별 관리자ID"
      },
      {
        "id": "7",
        "label": "기본 관리자ID"
      },
      {
        "id": "8",
        "label": "적용 관리자ID"
      },
      {
        "id": "9",
        "label": "관리자명"
      },
      {
        "id": "10",
        "label": "인계메모"
      },
      {
        "id": "11",
        "label": "기준 버전"
      }
    ]
  },
  {
    "id": "17_90일액션기록",
    "role": "input",
    "href": "/newcomers",
    "fields": [
      {
        "id": "0",
        "label": "액션ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "과목"
      },
      {
        "id": "3",
        "label": "단계코드"
      },
      {
        "id": "4",
        "label": "등록일"
      },
      {
        "id": "5",
        "label": "첫수업일"
      },
      {
        "id": "6",
        "label": "기한"
      },
      {
        "id": "7",
        "label": "필수여부"
      },
      {
        "id": "8",
        "label": "담당자ID"
      },
      {
        "id": "9",
        "label": "수행일"
      },
      {
        "id": "10",
        "label": "실제처리자ID"
      },
      {
        "id": "11",
        "label": "실행한 액션"
      },
      {
        "id": "12",
        "label": "처리 결과"
      },
      {
        "id": "13",
        "label": "증거ID"
      },
      {
        "id": "14",
        "label": "확인자ID"
      },
      {
        "id": "15",
        "label": "확인일"
      },
      {
        "id": "16",
        "label": "확인결과"
      },
      {
        "id": "17",
        "label": "후속 조치"
      },
      {
        "id": "18",
        "label": "후속기한"
      },
      {
        "id": "19",
        "label": "후속처리 결과"
      },
      {
        "id": "20",
        "label": "후속완료일"
      },
      {
        "id": "21",
        "label": "완료 판정"
      },
      {
        "id": "22",
        "label": "기한 상태"
      },
      {
        "id": "23",
        "label": "원본ID"
      }
    ]
  },
  {
    "id": "18_학습관찰성적",
    "role": "input",
    "href": "/work-records/knowledge",
    "fields": [
      {
        "id": "0",
        "label": "기록ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "과목"
      },
      {
        "id": "3",
        "label": "강좌ID"
      },
      {
        "id": "4",
        "label": "기록일"
      },
      {
        "id": "5",
        "label": "작성자ID"
      },
      {
        "id": "6",
        "label": "기록종류"
      },
      {
        "id": "7",
        "label": "예정 수업수"
      },
      {
        "id": "8",
        "label": "출석수"
      },
      {
        "id": "9",
        "label": "지각수"
      },
      {
        "id": "10",
        "label": "부여과제수"
      },
      {
        "id": "11",
        "label": "제출수"
      },
      {
        "id": "12",
        "label": "시험명"
      },
      {
        "id": "13",
        "label": "시험일"
      },
      {
        "id": "14",
        "label": "원점수"
      },
      {
        "id": "15",
        "label": "만점"
      },
      {
        "id": "16",
        "label": "학교평균"
      },
      {
        "id": "17",
        "label": "학습목표"
      },
      {
        "id": "18",
        "label": "실제진도"
      },
      {
        "id": "19",
        "label": "관찰 사실"
      },
      {
        "id": "20",
        "label": "지원 액션"
      },
      {
        "id": "21",
        "label": "처리결과"
      },
      {
        "id": "22",
        "label": "증거ID"
      }
    ]
  },
  {
    "id": "19_퇴원휴원",
    "role": "input",
    "href": "/withdrawals",
    "fields": [
      {
        "id": "0",
        "label": "이탈ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "과목"
      },
      {
        "id": "3",
        "label": "유형"
      },
      {
        "id": "4",
        "label": "발생일"
      },
      {
        "id": "5",
        "label": "당시강사ID"
      },
      {
        "id": "6",
        "label": "주원인"
      },
      {
        "id": "7",
        "label": "부원인"
      },
      {
        "id": "8",
        "label": "확인 주체"
      },
      {
        "id": "9",
        "label": "진술·관찰 근거"
      },
      {
        "id": "10",
        "label": "방어상담ID"
      },
      {
        "id": "11",
        "label": "대응 조치"
      },
      {
        "id": "12",
        "label": "복귀약속일"
      },
      {
        "id": "13",
        "label": "실제복귀일"
      },
      {
        "id": "14",
        "label": "결과"
      },
      {
        "id": "15",
        "label": "증거ID"
      }
    ]
  },
  {
    "id": "20_수납청구환불",
    "role": "input",
    "href": "/billing",
    "fields": [
      {
        "id": "0",
        "label": "거래ID"
      },
      {
        "id": "1",
        "label": "청구ID"
      },
      {
        "id": "2",
        "label": "학생ID"
      },
      {
        "id": "3",
        "label": "과목"
      },
      {
        "id": "4",
        "label": "귀속월"
      },
      {
        "id": "5",
        "label": "거래일"
      },
      {
        "id": "6",
        "label": "구분"
      },
      {
        "id": "7",
        "label": "항목"
      },
      {
        "id": "8",
        "label": "금액"
      },
      {
        "id": "9",
        "label": "할인액"
      },
      {
        "id": "10",
        "label": "기한"
      },
      {
        "id": "11",
        "label": "수납수단"
      },
      {
        "id": "12",
        "label": "강좌ID"
      },
      {
        "id": "13",
        "label": "원본시스템"
      },
      {
        "id": "14",
        "label": "원본ID"
      },
      {
        "id": "15",
        "label": "버전"
      },
      {
        "id": "16",
        "label": "대사상태"
      }
    ]
  },
  {
    "id": "21_회계월마감",
    "role": "input",
    "href": "/dashboard/management#accounting",
    "fields": [
      {
        "id": "0",
        "label": "기준월"
      },
      {
        "id": "1",
        "label": "회계매출"
      },
      {
        "id": "2",
        "label": "영업비용"
      },
      {
        "id": "3",
        "label": "총인건비"
      },
      {
        "id": "4",
        "label": "감가상각비"
      },
      {
        "id": "5",
        "label": "영업외수익"
      },
      {
        "id": "6",
        "label": "이자 등 영업외비용"
      },
      {
        "id": "7",
        "label": "법인세"
      },
      {
        "id": "8",
        "label": "현금잔액"
      },
      {
        "id": "9",
        "label": "유동자산"
      },
      {
        "id": "10",
        "label": "유동부채"
      },
      {
        "id": "11",
        "label": "부채총계"
      },
      {
        "id": "12",
        "label": "자본총계"
      },
      {
        "id": "13",
        "label": "차량 원금상환"
      },
      {
        "id": "14",
        "label": "마감상태"
      },
      {
        "id": "15",
        "label": "대사 차이"
      },
      {
        "id": "16",
        "label": "원본ID"
      },
      {
        "id": "17",
        "label": "확인자ID"
      },
      {
        "id": "18",
        "label": "영업이익"
      },
      {
        "id": "19",
        "label": "순이익"
      },
      {
        "id": "20",
        "label": "유동비율"
      },
      {
        "id": "21",
        "label": "부채비율"
      }
    ]
  },
  {
    "id": "22_인건비근태",
    "role": "input",
    "href": "/staff",
    "fields": [
      {
        "id": "0",
        "label": "기록ID"
      },
      {
        "id": "1",
        "label": "직원ID"
      },
      {
        "id": "2",
        "label": "기준월"
      },
      {
        "id": "3",
        "label": "급여"
      },
      {
        "id": "4",
        "label": "사업주부담"
      },
      {
        "id": "5",
        "label": "수당"
      },
      {
        "id": "6",
        "label": "성과급"
      },
      {
        "id": "7",
        "label": "총인건비"
      },
      {
        "id": "8",
        "label": "계획근무시간"
      },
      {
        "id": "9",
        "label": "실제근무시간"
      },
      {
        "id": "10",
        "label": "수업시간"
      },
      {
        "id": "11",
        "label": "상담시간"
      },
      {
        "id": "12",
        "label": "행정시간"
      },
      {
        "id": "13",
        "label": "추가지원시간"
      },
      {
        "id": "14",
        "label": "지각횟수"
      },
      {
        "id": "15",
        "label": "결근시간"
      },
      {
        "id": "16",
        "label": "원본ID"
      }
    ]
  },
  {
    "id": "23_연간행사캠페인",
    "role": "input",
    "href": "/marketing",
    "fields": [
      {
        "id": "0",
        "label": "캠페인ID"
      },
      {
        "id": "1",
        "label": "비교그룹ID"
      },
      {
        "id": "2",
        "label": "행사·캠페인명"
      },
      {
        "id": "3",
        "label": "유형"
      },
      {
        "id": "4",
        "label": "채널"
      },
      {
        "id": "5",
        "label": "시즌"
      },
      {
        "id": "6",
        "label": "기획일"
      },
      {
        "id": "7",
        "label": "시작일"
      },
      {
        "id": "8",
        "label": "종료일"
      },
      {
        "id": "9",
        "label": "대상학교·학년"
      },
      {
        "id": "10",
        "label": "담당자ID"
      },
      {
        "id": "11",
        "label": "목적·가설"
      },
      {
        "id": "12",
        "label": "예산"
      },
      {
        "id": "13",
        "label": "실제 집행비"
      },
      {
        "id": "14",
        "label": "문의 목표"
      },
      {
        "id": "15",
        "label": "등록 목표"
      },
      {
        "id": "16",
        "label": "계획 내용"
      },
      {
        "id": "17",
        "label": "실행 결과"
      },
      {
        "id": "18",
        "label": "측정 시작일"
      },
      {
        "id": "19",
        "label": "측정 종료일"
      },
      {
        "id": "20",
        "label": "원본 문서ID"
      },
      {
        "id": "21",
        "label": "사후 회고"
      },
      {
        "id": "22",
        "label": "개선안"
      },
      {
        "id": "23",
        "label": "상태"
      },
      {
        "id": "24",
        "label": "문의 기여수"
      },
      {
        "id": "25",
        "label": "등록 기여수"
      },
      {
        "id": "26",
        "label": "귀속 순수입"
      },
      {
        "id": "27",
        "label": "변동서비스 원가"
      },
      {
        "id": "28",
        "label": "귀속 공헌이익"
      },
      {
        "id": "29",
        "label": "CPE"
      },
      {
        "id": "30",
        "label": "ROAS"
      },
      {
        "id": "31",
        "label": "귀속 ROI"
      },
      {
        "id": "32",
        "label": "증분효과 근거"
      }
    ]
  },
  {
    "id": "24_유입기여이벤트",
    "role": "input",
    "href": "/marketing",
    "fields": [
      {
        "id": "0",
        "label": "접점ID"
      },
      {
        "id": "1",
        "label": "문의ID"
      },
      {
        "id": "2",
        "label": "학생ID"
      },
      {
        "id": "3",
        "label": "캠페인ID"
      },
      {
        "id": "4",
        "label": "채널"
      },
      {
        "id": "5",
        "label": "접점일"
      },
      {
        "id": "6",
        "label": "접점종류"
      },
      {
        "id": "7",
        "label": "확인방법"
      },
      {
        "id": "8",
        "label": "모형"
      },
      {
        "id": "9",
        "label": "기여종류"
      },
      {
        "id": "10",
        "label": "배분비중"
      },
      {
        "id": "11",
        "label": "전환ID"
      },
      {
        "id": "12",
        "label": "전환일"
      },
      {
        "id": "13",
        "label": "연결 순수입"
      },
      {
        "id": "14",
        "label": "증거ID"
      },
      {
        "id": "15",
        "label": "모형별 배분합"
      },
      {
        "id": "16",
        "label": "중복 점검"
      }
    ]
  },
  {
    "id": "25_행사초대참여",
    "role": "input",
    "href": "/marketing",
    "fields": [
      {
        "id": "0",
        "label": "참여ID"
      },
      {
        "id": "1",
        "label": "캠페인ID"
      },
      {
        "id": "2",
        "label": "학생ID"
      },
      {
        "id": "3",
        "label": "보호자ID"
      },
      {
        "id": "4",
        "label": "초대일"
      },
      {
        "id": "5",
        "label": "초대자ID"
      },
      {
        "id": "6",
        "label": "응답"
      },
      {
        "id": "7",
        "label": "참석일"
      },
      {
        "id": "8",
        "label": "참석여부"
      },
      {
        "id": "9",
        "label": "지인동반수"
      },
      {
        "id": "10",
        "label": "만족도"
      },
      {
        "id": "11",
        "label": "후속상담ID"
      },
      {
        "id": "12",
        "label": "후속기한"
      },
      {
        "id": "13",
        "label": "후속결과"
      },
      {
        "id": "14",
        "label": "증거ID"
      }
    ]
  },
  {
    "id": "26_블로그콘텐츠",
    "role": "input",
    "href": "/work-records/knowledge?kind=content",
    "fields": [
      {
        "id": "0",
        "label": "콘텐츠ID"
      },
      {
        "id": "1",
        "label": "캠페인ID"
      },
      {
        "id": "2",
        "label": "담당자ID"
      },
      {
        "id": "3",
        "label": "채널"
      },
      {
        "id": "4",
        "label": "제목"
      },
      {
        "id": "5",
        "label": "키워드"
      },
      {
        "id": "6",
        "label": "계획일"
      },
      {
        "id": "7",
        "label": "발행일"
      },
      {
        "id": "8",
        "label": "최근수정일"
      },
      {
        "id": "9",
        "label": "URL"
      },
      {
        "id": "10",
        "label": "측정일"
      },
      {
        "id": "11",
        "label": "조회수"
      },
      {
        "id": "12",
        "label": "유입수"
      },
      {
        "id": "13",
        "label": "문의수"
      },
      {
        "id": "14",
        "label": "등록수"
      },
      {
        "id": "15",
        "label": "추적코드"
      },
      {
        "id": "16",
        "label": "개선메모"
      },
      {
        "id": "17",
        "label": "상태"
      }
    ]
  },
  {
    "id": "27_기여도팩터42",
    "role": "config",
    "href": "/student-contribution",
    "fields": [
      {
        "id": "0",
        "label": "팩터ID"
      },
      {
        "id": "1",
        "label": "축ID"
      },
      {
        "id": "2",
        "label": "팩터명"
      },
      {
        "id": "3",
        "label": "단위"
      },
      {
        "id": "4",
        "label": "관찰기간"
      },
      {
        "id": "5",
        "label": "100점 기준"
      },
      {
        "id": "6",
        "label": "역방향"
      },
      {
        "id": "7",
        "label": "측정 정의"
      },
      {
        "id": "8",
        "label": "점수 사용"
      },
      {
        "id": "9",
        "label": "최소값"
      },
      {
        "id": "10",
        "label": "최대값"
      },
      {
        "id": "11",
        "label": "정수 여부"
      }
    ]
  },
  {
    "id": "28_팩터측정",
    "role": "input",
    "href": "/student-contribution",
    "fields": [
      {
        "id": "0",
        "label": "측정ID"
      },
      {
        "id": "1",
        "label": "학생ID"
      },
      {
        "id": "2",
        "label": "기준월"
      },
      {
        "id": "3",
        "label": "팩터ID"
      },
      {
        "id": "4",
        "label": "상태"
      },
      {
        "id": "5",
        "label": "숫자값"
      },
      {
        "id": "6",
        "label": "메모값"
      },
      {
        "id": "7",
        "label": "측정자ID"
      },
      {
        "id": "8",
        "label": "측정일"
      },
      {
        "id": "9",
        "label": "근거ID·URL"
      },
      {
        "id": "10",
        "label": "모형버전"
      },
      {
        "id": "11",
        "label": "축ID"
      },
      {
        "id": "12",
        "label": "100점기준"
      },
      {
        "id": "13",
        "label": "역방향"
      },
      {
        "id": "14",
        "label": "중복수"
      },
      {
        "id": "15",
        "label": "정규화점수"
      },
      {
        "id": "16",
        "label": "값검증"
      }
    ]
  },
  {
    "id": "29_조직OKR",
    "role": "input",
    "href": "/organization/okr",
    "fields": [
      {
        "id": "0",
        "label": "목표ID"
      },
      {
        "id": "1",
        "label": "상위목표ID"
      },
      {
        "id": "2",
        "label": "수준"
      },
      {
        "id": "3",
        "label": "팀"
      },
      {
        "id": "4",
        "label": "담당자ID"
      },
      {
        "id": "5",
        "label": "시작일"
      },
      {
        "id": "6",
        "label": "종료일"
      },
      {
        "id": "7",
        "label": "목표"
      },
      {
        "id": "8",
        "label": "KR ID"
      },
      {
        "id": "9",
        "label": "결과지표"
      },
      {
        "id": "10",
        "label": "방향"
      },
      {
        "id": "11",
        "label": "기준값"
      },
      {
        "id": "12",
        "label": "목표값"
      },
      {
        "id": "13",
        "label": "현재값"
      },
      {
        "id": "14",
        "label": "단위"
      },
      {
        "id": "15",
        "label": "모집단·분모"
      },
      {
        "id": "16",
        "label": "품질기준"
      },
      {
        "id": "17",
        "label": "측정일"
      },
      {
        "id": "18",
        "label": "근거ID"
      },
      {
        "id": "19",
        "label": "달성률"
      },
      {
        "id": "20",
        "label": "상태"
      },
      {
        "id": "21",
        "label": "검토자ID"
      },
      {
        "id": "22",
        "label": "관리자 피드백"
      }
    ]
  },
  {
    "id": "30_실행주간점검",
    "role": "input",
    "href": "/organization/okr",
    "fields": [
      {
        "id": "0",
        "label": "실행ID"
      },
      {
        "id": "1",
        "label": "KR ID"
      },
      {
        "id": "2",
        "label": "담당자ID"
      },
      {
        "id": "3",
        "label": "계획일"
      },
      {
        "id": "4",
        "label": "기한"
      },
      {
        "id": "5",
        "label": "이번주 실행"
      },
      {
        "id": "6",
        "label": "예상 결과"
      },
      {
        "id": "7",
        "label": "진행상태"
      },
      {
        "id": "8",
        "label": "실제 결과"
      },
      {
        "id": "9",
        "label": "증거ID"
      },
      {
        "id": "10",
        "label": "장애요인"
      },
      {
        "id": "11",
        "label": "필요지원"
      },
      {
        "id": "12",
        "label": "다음 행동"
      },
      {
        "id": "13",
        "label": "완료일"
      },
      {
        "id": "14",
        "label": "점검일"
      },
      {
        "id": "15",
        "label": "확신도"
      },
      {
        "id": "16",
        "label": "검토자ID"
      },
      {
        "id": "17",
        "label": "피드백"
      }
    ]
  },
  {
    "id": "31_업무문서",
    "role": "input",
    "href": "/work-records",
    "fields": [
      {
        "id": "0",
        "label": "문서ID"
      },
      {
        "id": "1",
        "label": "템플릿종류"
      },
      {
        "id": "2",
        "label": "제목"
      },
      {
        "id": "3",
        "label": "작성자ID"
      },
      {
        "id": "4",
        "label": "작성일"
      },
      {
        "id": "5",
        "label": "학생ID"
      },
      {
        "id": "6",
        "label": "직원ID"
      },
      {
        "id": "7",
        "label": "강좌ID"
      },
      {
        "id": "8",
        "label": "캠페인ID"
      },
      {
        "id": "9",
        "label": "KR ID"
      },
      {
        "id": "10",
        "label": "기획·목적"
      },
      {
        "id": "11",
        "label": "실행 내용"
      },
      {
        "id": "12",
        "label": "결과"
      },
      {
        "id": "13",
        "label": "다음 조치"
      },
      {
        "id": "14",
        "label": "기한"
      },
      {
        "id": "15",
        "label": "상태"
      },
      {
        "id": "16",
        "label": "검토자ID"
      },
      {
        "id": "17",
        "label": "검토일"
      },
      {
        "id": "18",
        "label": "버전"
      },
      {
        "id": "19",
        "label": "원본URL"
      }
    ]
  },
  {
    "id": "32_학교점유율",
    "role": "input",
    "href": "/work-records/knowledge?kind=population",
    "fields": [
      {
        "id": "0",
        "label": "기준일"
      },
      {
        "id": "1",
        "label": "학교ID"
      },
      {
        "id": "2",
        "label": "학교명"
      },
      {
        "id": "3",
        "label": "학년"
      },
      {
        "id": "4",
        "label": "학교 재학생수"
      },
      {
        "id": "5",
        "label": "학원 재원생수"
      },
      {
        "id": "6",
        "label": "점유율"
      },
      {
        "id": "7",
        "label": "모집단 기준일"
      },
      {
        "id": "8",
        "label": "모집단 출처"
      },
      {
        "id": "9",
        "label": "전년 학원생수"
      },
      {
        "id": "10",
        "label": "증감"
      }
    ]
  },
  {
    "id": "33_온톨로지사전",
    "role": "config",
    "href": "/dashboard/management/knowledge?tab=schema",
    "fields": [
      {
        "id": "0",
        "label": "종류"
      },
      {
        "id": "1",
        "label": "코드"
      },
      {
        "id": "2",
        "label": "표시명"
      },
      {
        "id": "3",
        "label": "출발 주체"
      },
      {
        "id": "4",
        "label": "도착 주체"
      },
      {
        "id": "5",
        "label": "연결키·조건"
      },
      {
        "id": "6",
        "label": "근거 표"
      },
      {
        "id": "7",
        "label": "시간·권한 규칙"
      }
    ]
  },
  {
    "id": "34_그래프관계",
    "role": "input",
    "href": "/dashboard/management/knowledge?tab=graph",
    "fields": [
      {
        "id": "0",
        "label": "관계ID"
      },
      {
        "id": "1",
        "label": "지점ID"
      },
      {
        "id": "2",
        "label": "주체종류"
      },
      {
        "id": "3",
        "label": "주체ID"
      },
      {
        "id": "4",
        "label": "관계코드"
      },
      {
        "id": "5",
        "label": "객체종류"
      },
      {
        "id": "6",
        "label": "객체ID"
      },
      {
        "id": "7",
        "label": "유효시작일"
      },
      {
        "id": "8",
        "label": "유효종료일"
      },
      {
        "id": "9",
        "label": "근거ID"
      },
      {
        "id": "10",
        "label": "기록자ID"
      },
      {
        "id": "11",
        "label": "기록일"
      },
      {
        "id": "12",
        "label": "연결상태"
      },
      {
        "id": "13",
        "label": "검토메모"
      }
    ]
  },
  {
    "id": "35_규칙과AI분석",
    "role": "input",
    "href": "/dashboard/management/knowledge?tab=rules",
    "fields": [
      {
        "id": "0",
        "label": "분석ID"
      },
      {
        "id": "1",
        "label": "영역"
      },
      {
        "id": "2",
        "label": "질문·규칙"
      },
      {
        "id": "3",
        "label": "주체ID"
      },
      {
        "id": "4",
        "label": "기간"
      },
      {
        "id": "5",
        "label": "관측 사실"
      },
      {
        "id": "6",
        "label": "근거ID 목록"
      },
      {
        "id": "7",
        "label": "모집단·분모"
      },
      {
        "id": "8",
        "label": "원인 가설"
      },
      {
        "id": "9",
        "label": "추가 확인"
      },
      {
        "id": "10",
        "label": "권고 액션"
      },
      {
        "id": "11",
        "label": "담당자ID"
      },
      {
        "id": "12",
        "label": "기한"
      },
      {
        "id": "13",
        "label": "실행 결과"
      },
      {
        "id": "14",
        "label": "모형버전"
      },
      {
        "id": "15",
        "label": "검토상태"
      }
    ]
  },
  {
    "id": "36_소스연동대사",
    "role": "config",
    "href": "/dashboard/management#sources",
    "fields": [
      {
        "id": "0",
        "label": "소스ID"
      },
      {
        "id": "1",
        "label": "시스템"
      },
      {
        "id": "2",
        "label": "자료종류"
      },
      {
        "id": "3",
        "label": "수집방식"
      },
      {
        "id": "4",
        "label": "원본 위치"
      },
      {
        "id": "5",
        "label": "업무 키"
      },
      {
        "id": "6",
        "label": "담당역할"
      },
      {
        "id": "7",
        "label": "최근 수집일"
      },
      {
        "id": "8",
        "label": "자료 기준일"
      },
      {
        "id": "9",
        "label": "대상 지점·회사"
      },
      {
        "id": "10",
        "label": "대사상태"
      },
      {
        "id": "11",
        "label": "원본 합계"
      },
      {
        "id": "12",
        "label": "수집 합계"
      },
      {
        "id": "13",
        "label": "차이"
      },
      {
        "id": "14",
        "label": "다음 조치"
      }
    ]
  },
  {
    "id": "37_담당자입력설계",
    "role": "config",
    "href": "/work-records",
    "fields": [
      {
        "id": "0",
        "label": "담당역할"
      },
      {
        "id": "1",
        "label": "자기 화면"
      },
      {
        "id": "2",
        "label": "입력 시점"
      },
      {
        "id": "3",
        "label": "최소 필수값"
      },
      {
        "id": "4",
        "label": "연결되는 주체"
      },
      {
        "id": "5",
        "label": "다음 담당·확인"
      },
      {
        "id": "6",
        "label": "중복입력 방지"
      }
    ]
  },
  {
    "id": "38_지표정의",
    "role": "config",
    "href": "/dashboard/management/knowledge?tab=model",
    "fields": [
      {
        "id": "0",
        "label": "지표"
      },
      {
        "id": "1",
        "label": "분자"
      },
      {
        "id": "2",
        "label": "분모"
      },
      {
        "id": "3",
        "label": "기간·대상"
      },
      {
        "id": "4",
        "label": "원본"
      },
      {
        "id": "5",
        "label": "제외·누락 처리"
      }
    ]
  },
  {
    "id": "39_사용법변경내역",
    "role": "config",
    "href": "/work-records",
    "fields": [
      {
        "id": "0",
        "label": "구분"
      },
      {
        "id": "1",
        "label": "내용"
      },
      {
        "id": "2",
        "label": "입력·확인할 곳"
      }
    ]
  },
  {
    "id": "40_회계원장",
    "role": "input",
    "href": "/dashboard/management#accounting",
    "fields": [
      {
        "id": "0",
        "label": "원장ID"
      },
      {
        "id": "1",
        "label": "원본 전표ID"
      },
      {
        "id": "2",
        "label": "전표행"
      },
      {
        "id": "3",
        "label": "거래일"
      },
      {
        "id": "4",
        "label": "귀속월"
      },
      {
        "id": "5",
        "label": "계정코드"
      },
      {
        "id": "6",
        "label": "계정명"
      },
      {
        "id": "7",
        "label": "차변"
      },
      {
        "id": "8",
        "label": "대변"
      },
      {
        "id": "9",
        "label": "적요"
      },
      {
        "id": "10",
        "label": "거래처ID"
      },
      {
        "id": "11",
        "label": "분류"
      },
      {
        "id": "12",
        "label": "학원귀속 비중"
      },
      {
        "id": "13",
        "label": "캠페인ID"
      },
      {
        "id": "14",
        "label": "직원ID"
      },
      {
        "id": "15",
        "label": "MakeEdu 대응ID"
      },
      {
        "id": "16",
        "label": "수집배치ID"
      },
      {
        "id": "17",
        "label": "대사상태"
      }
    ]
  }
] as const;
