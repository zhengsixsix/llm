export interface BoardDraftItem {
  content: string;
  explanation: string;
  imageKeyword: string;
  visualHint?: string;
  reviewIssues?: string[];
}

export interface SectionDraft {
  boardName: string;
  boardThesis: string;
  targetChars: number;
  contentItems: BoardDraftItem[];
  summary: string;
  reviewIssues?: string[];
}

export interface BoardPlan {
  boardName: string;
  goal: string;
  evidenceIds: string[];
  fitHookIds: string[];
  targetChars: number;
  transition?: string;
  avoid?: string[];
}

export interface NarrativePlan {
  thesis: string;
  boards: BoardPlan[];
}
