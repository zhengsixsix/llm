import type { BoardName, WordBudgetPlan } from './budget';
import type { ProgramProfile, ResumeProfile } from './profile';
import type { StyleProfile } from './style';

export type NodeType = 'content' | 'explanation' | 'image';

export interface NodeMeta {
  boardName?: BoardName;
  boardGoal?: string;
  boardThesis?: string;
  boardBudget?: number;
  nodeBudget?: number;
  voiceRole?: 'content' | 'explanation' | 'summary';
  styleTone?: string;
  preferredAddress?: string | null;
  writingGuide?: string;
  transition?: string;
  keyPoints?: string[];
  siblingContents?: string[];
  visualHint?: string;
  sampleAnchors?: string[];
  reviewIssues?: string[];
}

export interface MindMapGenerationMeta {
  schoolName?: string;
  programName?: string;
  thesis?: string;
  overallLogic?: string;
  sampleContent?: string;
  styleProfile?: StyleProfile;
  budgetPlan?: WordBudgetPlan;
  resumeProfile?: ResumeProfile;
  programProfile?: ProgramProfile;
}

export interface MindMapNode {
  id?: string;
  title: string;
  type?: NodeType;
  imageKeyword?: string;
  imageUrl?: string;
  meta?: NodeMeta;
  children?: MindMapNode[];
}

export interface Relationship {
  id?: string;
  title: string;
  end1Title: string;
  end2Title: string;
  end1Board?: string;
  end2Board?: string;
  linePattern?: string;
}

export interface MindMapData {
  rootTitle: string;
  structure: MindMapNode[];
  relationships: Relationship[];
  generationMeta?: MindMapGenerationMeta;
}

let counter = 0;
function makeId(): string {
  return `node_${Date.now()}_${++counter}`;
}

export function ensureNodeIds(nodes: MindMapNode[]): MindMapNode[] {
  return nodes.map((node) => ({
    ...node,
    id: node.id || makeId(),
    children: node.children ? ensureNodeIds(node.children) : undefined,
  }));
}

export function findNodeById(nodes: MindMapNode[], id: string): MindMapNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return null;
}

export function updateNodeTitle(nodes: MindMapNode[], id: string, newTitle: string): MindMapNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, title: newTitle };
    }
    if (node.children) {
      return { ...node, children: updateNodeTitle(node.children, id, newTitle) };
    }
    return node;
  });
}

export function updateNodeMeta(
  nodes: MindMapNode[],
  id: string,
  updater: (meta: NodeMeta | undefined) => NodeMeta | undefined,
): MindMapNode[] {
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, meta: updater(node.meta) };
    }
    if (node.children) {
      return { ...node, children: updateNodeMeta(node.children, id, updater) };
    }
    return node;
  });
}

export function getNodePath(nodes: MindMapNode[], id: string, path: string[] = []): string[] | null {
  for (const node of nodes) {
    const current = [...path, node.title];
    if (node.id === id) {
      return current;
    }
    if (node.children) {
      const found = getNodePath(node.children, id, current);
      if (found) return found;
    }
  }
  return null;
}

export interface BoardContext {
  boardNode: MindMapNode;
  boardName: string;
  boardIndex: number;
  contentNodes: MindMapNode[];
  explanationNodes: MindMapNode[];
  summaryNode?: MindMapNode;
}

export interface NodeTitleUpdate {
  nodeId: string;
  newTitle: string;
}

export function getBoardContextByNodeId(nodes: MindMapNode[], nodeId: string): BoardContext | null {
  for (let boardIndex = 0; boardIndex < nodes.length; boardIndex += 1) {
    const boardNode = nodes[boardIndex];
    if (!containsNodeId(boardNode, nodeId)) continue;

    const directChildren = boardNode.children || [];
    const contentNodes = directChildren.filter((child) => child.type === 'content');
    const explanationNodes = contentNodes.flatMap((child) => (child.children || []).filter((nested) => nested.type === 'explanation'));
    const summaryNode = directChildren.find((child) => child.type === 'explanation' && child.title.startsWith('板块总结'));

    return {
      boardNode,
      boardName: boardNode.title,
      boardIndex,
      contentNodes,
      explanationNodes,
      summaryNode,
    };
  }
  return null;
}

export function applyNodeTitleUpdates(nodes: MindMapNode[], updates: NodeTitleUpdate[]): MindMapNode[] {
  const updateMap = new Map(updates.map((item) => [item.nodeId, item.newTitle]));

  const walk = (nodeList: MindMapNode[]): MindMapNode[] =>
    nodeList.map((node) => {
      const nextTitle = node.id ? updateMap.get(node.id) : undefined;
      return {
        ...node,
        title: nextTitle ?? node.title,
        children: node.children ? walk(node.children) : undefined,
      };
    });

  return walk(nodes);
}

function containsNodeId(node: MindMapNode, id: string): boolean {
  if (node.id === id) return true;
  return !!node.children?.some((child) => containsNodeId(child, id));
}
