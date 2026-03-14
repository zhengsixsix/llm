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
  title: string;
  end1Title: string;
  end2Title: string;
}

/** 思维导图数据 */
export interface MindMapData {
  rootTitle: string;
  structure: MindMapNode[];
  relationships: Relationship[];
}
