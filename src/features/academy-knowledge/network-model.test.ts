import { describe, expect, it } from "vitest";
import type { Graph } from "./graph";
import { recordNetwork, networkPositions } from "./network-model";
const node=(id:string)=>({id,label:id,type:"Student" as const,source:"test"});
const edge=(from:string,to:string,relation="ABOUT")=>({from,to,relation,sourceRelation:relation,basis:"evidence",evidence:[],asOf:"2026-11-03"});
const base:Graph={tenant:"t",version:"v",observedAt:"2026-11-03",issues:[],nodes:[node("a"),node("b"),node("isolated")],edges:[edge("a","b")]};
describe("record-level network",()=>{
  it("preserves every real record including isolated ones and draws no invented edge",()=>{const map=recordNetwork(base);expect(map.nodes.map(n=>n.id)).toEqual(["a","b","isolated"]);expect(map.nodes.find(n=>n.id==="isolated")?.count).toBe(0);expect(map.edges).toEqual([{from:"a",to:"b",count:1}]);});
  it("counts unique relations but node size counts distinct neighbors, not repeated reads",()=>{const map=recordNetwork({...base,edges:[edge("a","b"),edge("a","b"),edge("b","a","TAUGHT_BY"),edge("a","missing")]});expect(map.edges).toEqual([{from:"a",to:"b",count:2}]);expect(map.nodes[0].count).toBe(1);});
  it("keeps incomplete evidence visible without changing its status",()=>{const map=recordNetwork({...base,nodes:[{...node("a"),state:"insufficient"}]});expect(map.nodes[0].incomplete).toBe("자료 부족");expect(map.edges).toHaveLength(0);});
  it("does not turn self references into neighboring records",()=>{const map=recordNetwork({...base,edges:[edge("a","a")]});expect(map.nodes[0].count).toBe(0);expect(map.edges[0].from).toBe(map.edges[0].to);});
  it("separates disconnected star neighborhoods without changing data",()=>{const graph={...base,nodes:[node("h1"),node("h2"),...Array.from({length:80},(_,i)=>node("n"+i))],edges:Array.from({length:80},(_,i)=>edge(i<40?"h1":"h2","n"+i))};const before=JSON.stringify(graph),map=recordNetwork(graph),p=networkPositions(map.nodes,map.edges);expect(JSON.stringify(graph)).toBe(before);expect(Object.keys(p)).toHaveLength(graph.nodes.length);expect(Math.hypot(p.h1.x-p.h2.x,p.h1.y-p.h2.y)).toBeGreaterThan(100);expect(Math.hypot(p.n1.x-p.h1.x,p.n1.y-p.h1.y)).toBeLessThan(Math.hypot(p.n1.x-p.h2.x,p.n1.y-p.h2.y));});
  it("lays out thousands of records deterministically without dropping nodes",()=>{const graph={...base,nodes:[node("hub"),...Array.from({length:4500},(_,i)=>node("n"+i))],edges:Array.from({length:4300},(_,i)=>edge("hub","n"+i))};const map=recordNetwork(graph),p=networkPositions(map.nodes,map.edges);expect(Object.keys(p)).toHaveLength(4501);expect(p).toEqual(networkPositions(map.nodes,map.edges));for(const point of Object.values(p)){expect(Number.isFinite(point.x)).toBe(true);expect(Number.isFinite(point.y)).toBe(true);}});
  it("handles empty and single-record views",()=>{expect(networkPositions([],[])).toEqual({});expect(Object.keys(networkPositions([{id:"a",label:"a",type:"Student",count:0}],[]))).toEqual(["a"]);});
});
