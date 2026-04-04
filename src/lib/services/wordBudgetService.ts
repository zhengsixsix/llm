import type { BoardBudget, BoardName, BudgetCompliance, WordBudgetPlan } from '@/types/budget';
import { DEFAULT_BOARD_ORDER } from '@/types/budget';

const BOARD_RATIOS: Record<BoardName, number> = {
  '兴趣起源': 0.25,
  '进阶思考': 0.25,
  '能力匹配': 0.25,
  '心仪课程': 0.15,
  '衷心求学': 0.10,
};

class WordBudgetService {
  buildPlan(totalContentChars: number): WordBudgetPlan {
    const safeTotal = Math.max(300, Math.round(totalContentChars || 1000));
    const boards = this.allocateBoardBudgets(safeTotal);
    return {
      totalContentChars: safeTotal,
      boards,
    };
  }

  getBoardBudget(plan: WordBudgetPlan, boardName: string): BoardBudget {
    const board = plan.boards.find((item) => item.boardName === boardName);
    if (!board) {
      throw new Error(`Missing board budget: ${boardName}`);
    }
    return board;
  }

  countChars(text: string): number {
    return (text || '').replace(/\s+/g, '').length;
  }

  countContentCharsFromTitles(titles: string[]): number {
    return titles.reduce((sum, title) => sum + this.countChars(title), 0);
  }

  measureBoardCompliance(boardName: BoardName, expectedChars: number, titles: string[]): BudgetCompliance {
    const actualChars = this.countContentCharsFromTitles(titles);
    const deltaChars = actualChars - expectedChars;
    const tolerance = Math.max(15, Math.round(expectedChars * 0.1));
    return {
      boardName,
      expectedChars,
      actualChars,
      deltaChars,
      withinTolerance: Math.abs(deltaChars) <= tolerance,
    };
  }

  truncateToBudget(text: string, budget: number): string {
    const safeBudget = Math.max(1, budget);
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    if (this.countChars(normalized) <= safeBudget) {
      return normalized;
    }

    let kept = '';
    let visibleCount = 0;
    for (const char of normalized) {
      if (!/\s/.test(char)) {
        visibleCount += 1;
      }
      if (visibleCount > safeBudget) {
        break;
      }
      kept += char;
    }

    const sentenceEnd = Math.max(kept.lastIndexOf('。'), kept.lastIndexOf('！'), kept.lastIndexOf('？'));
    if (sentenceEnd >= Math.floor(kept.length * 0.55)) {
      return kept.slice(0, sentenceEnd + 1).trim();
    }

    const clauseEnd = Math.max(kept.lastIndexOf('；'), kept.lastIndexOf('，'), kept.lastIndexOf('：'));
    if (clauseEnd >= Math.floor(kept.length * 0.65)) {
      return kept.slice(0, clauseEnd + 1).trim();
    }

    return `${kept.trim()}……`;
  }

  renderPlan(plan: WordBudgetPlan): string {
    return plan.boards
      .map((board) => {
        const nodeLine = board.nodeBudgets
          .map((budget, index) => `正文节点${index + 1}:${budget}字`)
          .join('；');
        return `- ${board.boardName}: ${board.targetChars}字，占比${Math.round(board.ratio * 100)}%，${nodeLine}`;
      })
      .join('\n');
  }

  private allocateBoardBudgets(totalContentChars: number): BoardBudget[] {
    const rawBoards = DEFAULT_BOARD_ORDER.map((boardName) => {
      const ratio = BOARD_RATIOS[boardName];
      const rawTarget = totalContentChars * ratio;
      const baseTarget = Math.floor(rawTarget);
      return {
        boardName,
        ratio,
        rawTarget,
        baseTarget,
        remainder: rawTarget - baseTarget,
      };
    });

    let assigned = rawBoards.reduce((sum, board) => sum + board.baseTarget, 0);
    const remaining = totalContentChars - assigned;
    rawBoards
      .sort((left, right) => right.remainder - left.remainder)
      .slice(0, remaining)
      .forEach((board) => {
        board.baseTarget += 1;
        assigned += 1;
      });

    return DEFAULT_BOARD_ORDER.map((boardName) => {
      const raw = rawBoards.find((item) => item.boardName === boardName);
      const targetChars = raw?.baseTarget ?? 0;
      const nodeCount = this.pickNodeCount(targetChars);
      return {
        boardName,
        ratio: BOARD_RATIOS[boardName],
        targetChars,
        nodeCount,
        nodeBudgets: this.allocateEvenly(targetChars, nodeCount),
      };
    });
  }

  private pickNodeCount(targetChars: number): number {
    if (targetChars < 140) return 1;
    if (targetChars < 360) return 2;
    return 3;
  }

  private allocateEvenly(total: number, count: number): number[] {
    const safeCount = Math.max(1, count);
    const base = Math.floor(total / safeCount);
    const budgets = Array.from({ length: safeCount }, () => base);
    let remainder = total - base * safeCount;
    let index = 0;
    while (remainder > 0) {
      budgets[index] += 1;
      remainder -= 1;
      index = (index + 1) % safeCount;
    }
    return budgets;
  }
}

export const wordBudgetService = new WordBudgetService();
