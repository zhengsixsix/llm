export const DEFAULT_BOARD_ORDER = [
  '兴趣起源',
  '进阶思考',
  '能力匹配',
  '心仪课程',
  '衷心求学',
] as const;

export type BoardName = (typeof DEFAULT_BOARD_ORDER)[number];

export interface BoardBudget {
  boardName: BoardName;
  ratio: number;
  targetChars: number;
  nodeCount: number;
  nodeBudgets: number[];
}

export interface WordBudgetPlan {
  totalContentChars: number;
  boards: BoardBudget[];
}

export interface BudgetCompliance {
  boardName: BoardName;
  expectedChars: number;
  actualChars: number;
  deltaChars: number;
  withinTolerance: boolean;
}
