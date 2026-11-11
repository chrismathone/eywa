import { z } from "zod";
export const workTemplates={
  weekly:{label:"주간 업무보고",description:"이번 주 실행·결과·다음 주 계획",plan:"이번 주 목표·계획",action:"실행한 업무",result:"결과·미완료 사유",next:"다음 주 액션·협조 요청"},
  proposal:{label:"업무 기획안",description:"목적부터 실행 방법·성과 기준까지",plan:"배경·목표·성공 기준",action:"실행 방법·담당 협업",result:"검토할 근거·예상 효과",next:"준비 일정·다음 액션"},
  training:{label:"교육·연수 기록",description:"학습한 내용과 수업 적용 계획",plan:"교육 주제·참여 목적",action:"핵심 내용·실습",result:"배운 점·적용 결과",next:"수업 적용·후속 확인"},
  handover:{label:"업무 인수인계서",description:"진행 현황·미처리·다음 담당자 안내",plan:"인계 범위·목적",action:"진행한 업무·처리 절차",result:"현재 상태·미해결 사항",next:"후속 담당·기한·주의사항"},
  improvement:{label:"운영 개선 제안",description:"문제·근거·해결안·실행 점검",plan:"개선할 문제·목표",action:"제안하는 실행 방법",result:"현황 근거·기대 효과",next:"실행 일정·확인 기준"},
  free:{label:"일반 업무 문서",description:"그 밖의 업무 기록을 직접 작성",plan:"목적·계획",action:"내용·실행",result:"결과·근거",next:"후속 액션"},
} as const;
export type WorkTemplate=keyof typeof workTemplates;
export const workStates={draft:"작성 중",submitted:"검토 요청",reviewed:"확인 완료",cancelled:"취소"} as const;
export const workDocumentSchema=z.object({template:z.enum(["weekly","proposal","training","handover","improvement","free"]),title:z.string().trim().min(2).max(200),date:z.iso.date(),plan:z.string().trim().max(4000),action:z.string().trim().max(4000),result:z.string().trim().max(4000),next:z.string().trim().max(2000),state:z.enum(["draft","submitted","reviewed","cancelled"]),reviewNote:z.string().trim().max(1500)}).strict();
export type WorkDocument=z.infer<typeof workDocumentSchema>;
export type WorkRecord={id:string;author_id:string;version:number;document:WorkDocument;updated_at:string};
export const workRequestSchema=z.object({id:z.uuid(),requestId:z.uuid(),version:z.number().int().min(0),action:z.enum(["save","review"]),document:workDocumentSchema}).strict();
export function validateWorkTransition(old:WorkRecord|null,next:WorkDocument,actor:string,canReview:boolean,action:"save"|"review"){
  if(action==="review"){
    if(old&&old.author_id===actor)throw Error("본인 문서는 다른 검토자가 확인합니다");
    if(!canReview||!old||old.document.state!=="submitted"||!["reviewed","draft"].includes(next.state)||!next.reviewNote)throw Error("검토 요청된 문서에 확인 의견을 남겨 주세요");
    for(const key of ["template","title","date","plan","action","result","next"] as const)if(next[key]!==old.document[key])throw Error("검토자는 작성 내용을 변경할 수 없습니다");
  }else{
    if(old&&old.author_id!==actor)throw Error("본인이 작성한 문서만 수정할 수 있습니다");
    if(old?.document.state==="reviewed")throw Error("확인 완료된 문서는 고칠 수 없습니다. 이어지는 내용은 새 문서로 작성해 주세요");
    if(next.state==="reviewed"||next.reviewNote!==(old?.document.reviewNote??""))throw Error("작성자가 확인 완료 상태를 지정할 수 없습니다");
    if(next.state==="submitted"&&(!next.plan||!next.action||!next.result))throw Error("목적·내용·결과 또는 검토 근거를 채워 주세요");
    if(old&&old.document.template!==next.template)throw Error("저장한 문서의 서식은 유지해 주세요");
  }
}
