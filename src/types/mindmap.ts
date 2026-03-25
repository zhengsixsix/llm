/**
 * 思维导图相关类型定义
 */

/** 思维导图节点类型 */
export type NodeType = 'content' | 'explanation' | 'image';

/** 思维导图节点 */
export interface MindMapNode {
  id?: string;
  title: string;
  type?: NodeType;
  imageKeyword?: string;
  imageUrl?: string;
  children?: MindMapNode[];
}

/** 关联线 */
export interface Relationship {
  id?: string;
  title: string;
  end1Title: string;
  end2Title: string;
  end1Board?: string;
  end2Board?: string;
  linePattern?: string;
}

/** 思维导图数据 */
export interface MindMapData {
  rootTitle: string;
  structure: MindMapNode[];
  relationships: Relationship[];
}

/* ========== 工具函数 ========== */

let _counter = 0;
function makeId(): string {
  return `node_${Date.now()}_${++_counter}`;
}

/** 给所有缺少 id 的节点补上唯一 id */
export function ensureNodeIds(nodes: MindMapNode[]): MindMapNode[] {
  return nodes.map(n => ({
    ...n,
    id: n.id || makeId(),
    children: n.children ? ensureNodeIds(n.children) : undefined,
  }));
}

/** 根据 id 查找节点 */
export function findNodeById(nodes: MindMapNode[], id: string): MindMapNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.children) {
      const found = findNodeById(n.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** 替换指定 id 节点的 title，返回新树（不变原树） */
export function updateNodeTitle(nodes: MindMapNode[], id: string, newTitle: string): MindMapNode[] {
  return nodes.map(n => {
    if (n.id === id) return { ...n, title: newTitle };
    if (n.children) return { ...n, children: updateNodeTitle(n.children, id, newTitle) };
    return n;
  });
}

/** 获取节点的祖先路径（从根到该节点的 title 数组） */
export function getNodePath(nodes: MindMapNode[], id: string, path: string[] = []): string[] | null {
  for (const n of nodes) {
    const cur = [...path, n.title];
    if (n.id === id) return cur;
    if (n.children) {
      const found = getNodePath(n.children, id, cur);
      if (found) return found;
    }
  }
  return null;
}
