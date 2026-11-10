import {describe,it,expect} from "vitest";
import {validateWorkTransition,workDocumentSchema,type WorkDocument,type WorkRecord} from "./model";
const doc:WorkDocument={template:"weekly",title:"주간 실행보고",date:"2026-11-02",plan:"적응 점검",action:"전화 상담",result:"다음 상담 예약",next:"",state:"draft",reviewNote:""};
const record:WorkRecord={id:"one",author_id:"teacher",version:1,document:doc,updated_at:"now"};
describe("개인 업무 문서와 검토 경계",()=>{
  it("초안은 미완성 저장이 가능하지만 검토 요청은 목적·실행·결과가 필요하다",()=>{
    expect(()=>validateWorkTransition(null,{...doc,plan:""},"teacher",false,"save")).not.toThrow();
    expect(()=>validateWorkTransition(record,{...doc,state:"submitted",result:""},"teacher",false,"save")).toThrow();
  });
  it("관리자도 다른 사람의 본문을 대신 바꿀 수 없다",()=>{
    expect(()=>validateWorkTransition(record,doc,"admin",true,"save")).toThrow();
    expect(()=>validateWorkTransition({...record,document:{...doc,state:"submitted"}},{...doc,state:"reviewed",reviewNote:"확인",action:"다른 내용"},"admin",true,"review")).toThrow();
  });
  it("검토 요청 후 권한자만 의견을 남기고 완료·보완할 수 있다",()=>{
    const old={...record,document:{...doc,state:"submitted" as const}};
    const next={...doc,state:"reviewed" as const,reviewNote:"내용 확인"};
    expect(()=>validateWorkTransition(old,next,"admin",true,"review")).not.toThrow();
    expect(()=>validateWorkTransition(old,next,"teacher",false,"review")).toThrow();
    expect(()=>validateWorkTransition(record,next,"teacher",false,"save")).toThrow();
    expect(()=>validateWorkTransition(old,{...next,state:"draft"},"admin",true,"review")).not.toThrow();
  });
  it("임의 필드·잘못된 날짜는 입력 스키마에서 거절한다",()=>{
    expect(workDocumentSchema.safeParse({...doc,tenant_id:"other"}).success).toBe(false);
    expect(workDocumentSchema.safeParse({...doc,date:"2026-02-30"}).success).toBe(false);
  });
  it("확인 완료 문서는 작성자가 다시 고치지 못하고, 본인 문서는 본인이 확인하지 못한다",()=>{
    expect(()=>validateWorkTransition({...record,document:{...doc,state:"reviewed",reviewNote:"확인"}},{...doc,state:"draft",reviewNote:"확인"},"teacher",false,"save")).toThrow("확인 완료");
    expect(()=>validateWorkTransition({...record,document:{...doc,state:"submitted"}},{...doc,state:"reviewed",reviewNote:"확인"},"teacher",true,"review")).toThrow("본인 문서");
  });
});
