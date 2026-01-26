import type { SheetData } from '@/lib/types';

export type SpreadsheetAction =
  | { type: 'set_cell'; row: number; col: number; value: string }
  | { type: 'set_range'; startRow: number; startCol: number; values: string[][] };

export type ParsedActions = {
  cleanedText: string;
  actions: SpreadsheetAction[];
};

function parseJsonPayload(raw: string): SpreadsheetAction[] {
  try {
    const parsed = JSON.parse(raw) as { actions?: SpreadsheetAction[] };
    if (!parsed || !Array.isArray(parsed.actions)) return [];
    return parsed.actions.filter((action) => isAction(action));
  } catch {
    return [];
  }
}

function isAction(action: unknown): action is SpreadsheetAction {
  if (!action || typeof action !== 'object') return false;
  if (action.type === 'set_cell') {
    return Number.isFinite(action.row) && Number.isFinite(action.col);
  }
  if (action.type === 'set_range') {
    return (
      Number.isFinite(action.startRow) &&
      Number.isFinite(action.startCol) &&
      Array.isArray(action.values)
    );
  }
  return false;
}

export function parseAgentActions(text: string): ParsedActions {
  const trimmed = text || '';
  const blockMatch = trimmed.match(/```(?:json|agentconnect)\s*([\s\S]*?)```/i);
  if (blockMatch) {
    const actions = parseJsonPayload(blockMatch[1].trim());
    if (actions.length > 0) {
      const cleanedText = trimmed.replace(blockMatch[0], '').trim();
      return { cleanedText, actions };
    }
  }

  const inlineMatch = trimmed.match(/ACTION:\s*(\{[\s\S]*\})/i);
  if (inlineMatch) {
    const actions = parseJsonPayload(inlineMatch[1].trim());
    if (actions.length > 0) {
      const cleanedText = trimmed.replace(inlineMatch[0], '').trim();
      return { cleanedText, actions };
    }
  }

  return { cleanedText: trimmed, actions: [] };
}

function ensureGrid(data: SheetData, minRows: number, minCols: number): SheetData {
  const next = data.map((row) => row.map((cell) => ({ value: String(cell?.value ?? '') })));
  while (next.length < minRows) {
    next.push([]);
  }
  for (const row of next) {
    while (row.length < minCols) {
      row.push({ value: '' });
    }
  }
  return next;
}

export function applyAgentActions(data: SheetData, actions: SpreadsheetAction[]): SheetData {
  if (actions.length === 0) return data;

  let next = data.map((row) => row.map((cell) => ({ value: String(cell?.value ?? '') })));

  for (const action of actions) {
    if (action.type === 'set_cell') {
      const row = Math.max(1, Math.floor(action.row));
      const col = Math.max(1, Math.floor(action.col));
      next = ensureGrid(next, row, col);
      next[row - 1][col - 1] = { value: String(action.value ?? '') };
    }
    if (action.type === 'set_range') {
      const startRow = Math.max(1, Math.floor(action.startRow));
      const startCol = Math.max(1, Math.floor(action.startCol));
      const values = Array.isArray(action.values) ? action.values : [];
      const rowCount = values.length;
      const colCount = values.reduce((max, row) => Math.max(max, row.length), 0);
      next = ensureGrid(next, startRow + rowCount - 1, startCol + colCount - 1);
      values.forEach((rowValues, rowIndex) => {
        rowValues.forEach((value, colIndex) => {
          next[startRow - 1 + rowIndex][startCol - 1 + colIndex] = {
            value: String(value ?? ''),
          };
        });
      });
    }
  }

  return next;
}
