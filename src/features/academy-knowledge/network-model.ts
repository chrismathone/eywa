import type { Graph } from "./graph";
import { nodeHealth, uniqueEdges, type VisualNode, type VisualEdge } from "./studio-model";

/** Only real loaded records and relationships enter the record-level map. */
export function recordNetwork(graph: Graph) {
  const ids = new Set(graph.nodes.map(n => n.id));
  const pairs = new Map<string, VisualEdge>();
  const neighbors = new Map(graph.nodes.map(n => [n.id, new Set<string>()]));
  for (const e of uniqueEdges(graph)) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    const [from, to] = [e.from, e.to].sort(), key = JSON.stringify([from, to]);
    pairs.set(key, { from, to, count: (pairs.get(key)?.count ?? 0) + 1 });
    if (from !== to) { neighbors.get(from)!.add(to); neighbors.get(to)!.add(from); }
  }
  return {
    nodes: graph.nodes.map(n => ({ id: n.id, label: n.label, type: n.type, count: neighbors.get(n.id)!.size, incomplete: nodeHealth(n) })),
    edges: [...pairs.values()],
  };
}

export type NetworkPoint = { x: number; y: number };
const goldenAngle = Math.PI * (3 - Math.sqrt(5));

/** Deterministic hub neighborhoods. Positions are a reading aid, never inferred facts.
 * Work is O(N + E + H² * iterations), with H capped at 48, not N².
 * Connected small records form radial clouds around actual high-degree records.
 */
export function networkPositions(nodes: VisualNode[], edges: VisualEdge[]): Record<string, NetworkPoint> {
  if (!nodes.length) return {};
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  const adjacency = new Map(ordered.map(n => [n.id, new Set<string>()]));
  for (const e of edges) if (e.from !== e.to && adjacency.has(e.from) && adjacency.has(e.to)) {
    adjacency.get(e.from)!.add(e.to); adjacency.get(e.to)!.add(e.from);
  }
  const degree = (id: string) => adjacency.get(id)!.size;
  const ranked = [...ordered].sort((a, b) => degree(b.id) - degree(a.id) || a.id.localeCompare(b.id));
  const owners = new Map<string, number>();
  const groups: { hub: string; members: string[]; x: number; y: number; radius: number }[] = [];
  for (const n of ranked) {
    if (owners.has(n.id) || degree(n.id) < 3 || groups.length >= 48) continue;
    const free = [...adjacency.get(n.id)!].filter(id => !owners.has(id));
    if (free.length < 2) continue;
    const members = [n.id, ...free.sort()];
    const index = groups.length;
    groups.push({ hub: n.id, members, x: 0, y: 0, radius: 0 });
    for (const id of members) owners.set(id, index);
  }
  // Attach remaining records by real paths to an existing hub, without creating edges.
  const queue = [...owners.keys()];
  for (let i = 0; i < queue.length; i++) for (const id of adjacency.get(queue[i])!) {
    if (owners.has(id)) continue;
    const owner = owners.get(queue[i])!;
    owners.set(id, owner); groups[owner].members.push(id); queue.push(id);
  }
  const loose: string[] = [];
  for (const n of ordered) if (!owners.has(n.id)) loose.push(n.id);
  // Disconnected records stay visible. This visual grouping does not add a synthetic hub.
  if (loose.length) groups.push({ hub: "", members: loose, x: 0, y: 0, radius: 0 });
  const totalArea = groups.reduce((sum, g) => sum + g.members.length * 34, 0);
  const spread = Math.max(160, Math.sqrt(totalArea) * 1.7);
  groups.forEach((g, i) => {
    g.radius = Math.max(22, Math.sqrt(g.members.length) * 4.7 + 12);
    const angle = i * goldenAngle, r = Math.sqrt((i + .5) / groups.length) * spread;
    g.x = Math.cos(angle) * r; g.y = Math.sin(angle) * r;
  });
  const groupEdges = new Set<string>();
  for (const e of edges) {
    const a = owners.get(e.from), b = owners.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) groupEdges.add([a, b].sort((x,y)=>x-y).join(":"));
  }
  for (let step = 0; step < 180; step++) {
    const forces = groups.map(g => ({ x: -g.x * .002, y: -g.y * .002 }));
    for (let a = 0; a < groups.length; a++) for (let b = a + 1; b < groups.length; b++) {
      const dx = groups[b].x - groups[a].x || .01, dy = groups[b].y - groups[a].y || .01;
      const d = Math.max(1, Math.hypot(dx,dy)), desired = groups[a].radius + groups[b].radius + 85;
      const push = Math.max(0, desired - d) * .2 + 25 / d;
      forces[a].x -= dx/d*push; forces[a].y -= dy/d*push;
      forces[b].x += dx/d*push; forces[b].y += dy/d*push;
    }
    for (const key of groupEdges) {
      const [a,b]=key.split(":").map(Number),dx=groups[b].x-groups[a].x,dy=groups[b].y-groups[a].y;
      const d=Math.max(1,Math.hypot(dx,dy)),desired=groups[a].radius+groups[b].radius+120;
      const pull=Math.max(0,d-desired)*.008;
      forces[a].x+=dx/d*pull;forces[a].y+=dy/d*pull;forces[b].x-=dx/d*pull;forces[b].y-=dy/d*pull;
    }
    groups.forEach((g,i)=>{g.x+=Math.max(-15,Math.min(15,forces[i].x));g.y+=Math.max(-15,Math.min(15,forces[i].y));});
  }
  const positions: Record<string, NetworkPoint> = {};
  for (const g of groups) {
    if (g.hub) positions[g.hub]={x:g.x,y:g.y};
    const satellites=g.members.filter(id=>id!==g.hub);
    satellites.forEach((id,i)=>{
      const r=12+4.7*Math.sqrt(i+1),angle=i*goldenAngle;
      positions[id]={x:g.x+Math.cos(angle)*r,y:g.y+Math.sin(angle)*r};
    });
  }
  return positions;
}
