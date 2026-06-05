'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toJiraDatetimeAt9AM } from '@/lib/date-utils';
import { textToADF } from '@/lib/adf-helpers';
import type { GridCell, CellMutationState } from '@/types/timesheet';
import type { JiraWorklog } from '@/src/types/jira';
import { formatDateISO } from '@/lib/date-utils';
import { apiFetch } from '@/lib/api-client';

interface UseWorklogMutationsReturn {
  cellStates: Map<string, CellMutationState>;
  saveCell: (cell: GridCell, newHours: number, comment?: string) => Promise<void>;
  updateWorklog: (cell: GridCell, worklog: JiraWorklog, newHours: number, comment?: string) => Promise<void>;
  deleteWorklog: (cell: GridCell, worklog: JiraWorklog) => Promise<void>;
  deleteCell: (cell: GridCell) => Promise<void>;
  getCellState: (issueKey: string, date: Date) => CellMutationState;
}

function cellKey(issueKey: string, date: Date | string): string {
  const d = typeof date === 'string' ? date : formatDateISO(date);
  return `${issueKey}:${d}`;
}

function formatError(msg: string): string {
  if (msg.includes('No permission')) return 'No permission to log time on this issue';
  if (msg.includes('Rate limited')) return 'Rate limited by Jira — please wait and try again';
  if (msg.includes('not found')) return 'Issue or worklog not found';
  return msg;
}

export function useWorklogMutations(): UseWorklogMutationsReturn {
  const queryClient = useQueryClient();
  const [cellStates, setCellStates] = useState<Map<string, CellMutationState>>(new Map());

  const setCellStatus = useCallback(
    (issueKey: string, date: string, status: CellMutationState['status'], error?: string) => {
      setCellStates((prev) => {
        const next = new Map(prev);
        next.set(cellKey(issueKey, date), { issueKey, date, status, error });
        return next;
      });
    },
    [],
  );

  const invalidateWorklogs = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['worklogs'] });
  }, [queryClient]);

  const saveCell = useCallback(
    async (cell: GridCell, newHours: number, comment?: string) => {
      const dateStr = formatDateISO(cell.date);
      const newSeconds = Math.round(newHours * 3600);

      // No change in hours and no comment change — skip
      if (newSeconds === cell.totalSeconds && !comment) return;

      setCellStatus(cell.issueKey, dateStr, 'saving');

      try {
        const commentBody = comment ? textToADF(comment) : undefined;

        if (cell.worklogs.length > 0 && newSeconds > 0) {
          // UPDATE existing worklog (use the first one)
          const wl = cell.worklogs[0];
          const body: Record<string, unknown> = {
            issueKey: cell.issueKey,
            worklogId: wl.id,
            timeSpentSeconds: newSeconds,
          };
          if (commentBody) body.comment = commentBody;
          await apiFetch('/api/worklogs', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Failed (${res.status})`);
            }
          });
        } else if (cell.worklogs.length > 0 && newSeconds === 0) {
          // DELETE — user cleared the cell (delete first worklog only for single-worklog cells)
          const wl = cell.worklogs[0];
          await apiFetch(`/api/worklogs?issueKey=${encodeURIComponent(cell.issueKey)}&worklogId=${encodeURIComponent(wl.id)}`, {
            method: 'DELETE',
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Failed (${res.status})`);
            }
          });
        } else if (newSeconds > 0) {
          // CREATE new worklog
          const started = toJiraDatetimeAt9AM(dateStr);
          const body: Record<string, unknown> = {
            issueKey: cell.issueKey,
            timeSpentSeconds: newSeconds,
            started,
          };
          if (commentBody) body.comment = commentBody;
          await apiFetch('/api/worklogs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }).then(async (res) => {
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Failed (${res.status})`);
            }
          });
        }

        setCellStatus(cell.issueKey, dateStr, 'idle');
        invalidateWorklogs();
      } catch (err) {
        setCellStatus(cell.issueKey, dateStr, 'error', formatError((err as Error).message));
      }
    },
    [invalidateWorklogs, setCellStatus],
  );

  /** Update a specific worklog within a cell (for multi-worklog cells) */
  const updateWorklog = useCallback(
    async (cell: GridCell, worklog: JiraWorklog, newHours: number, comment?: string) => {
      const dateStr = formatDateISO(cell.date);
      const newSeconds = Math.round(newHours * 3600);

      setCellStatus(cell.issueKey, dateStr, 'saving');

      try {
        if (newSeconds === 0) {
          // Delete this specific worklog
            const res = await apiFetch(
              `/api/worklogs?issueKey=${encodeURIComponent(cell.issueKey)}&worklogId=${encodeURIComponent(worklog.id)}`,
              { method: 'DELETE' },
            );
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || `Failed (${res.status})`);
            }
          } else {
            const body: Record<string, unknown> = {
              issueKey: cell.issueKey,
              worklogId: worklog.id,
              timeSpentSeconds: newSeconds,
            };
            if (comment) body.comment = textToADF(comment);
            const res = await apiFetch('/api/worklogs', {
              method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Failed (${res.status})`);
          }
        }

        setCellStatus(cell.issueKey, dateStr, 'idle');
        invalidateWorklogs();
      } catch (err) {
        setCellStatus(cell.issueKey, dateStr, 'error', formatError((err as Error).message));
      }
    },
    [invalidateWorklogs, setCellStatus],
  );

  /** Delete a specific worklog within a cell */
  const deleteWorklog = useCallback(
    async (cell: GridCell, worklog: JiraWorklog) => {
      const dateStr = formatDateISO(cell.date);
      setCellStatus(cell.issueKey, dateStr, 'saving');

      try {
        const res = await apiFetch(
          `/api/worklogs?issueKey=${encodeURIComponent(cell.issueKey)}&worklogId=${encodeURIComponent(worklog.id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Delete failed (${res.status})`);
        }

        setCellStatus(cell.issueKey, dateStr, 'idle');
        invalidateWorklogs();
      } catch (err) {
        setCellStatus(cell.issueKey, dateStr, 'error', formatError((err as Error).message));
      }
    },
    [invalidateWorklogs, setCellStatus],
  );

  const deleteCell = useCallback(
    async (cell: GridCell) => {
      if (cell.worklogs.length === 0) return;
      const dateStr = formatDateISO(cell.date);
      setCellStatus(cell.issueKey, dateStr, 'saving');

      try {
        for (const wl of cell.worklogs) {
          const res = await apiFetch(
            `/api/worklogs?issueKey=${encodeURIComponent(cell.issueKey)}&worklogId=${encodeURIComponent(wl.id)}`,
            { method: 'DELETE' },
          );
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || `Delete failed (${res.status})`);
          }
        }

        setCellStatus(cell.issueKey, dateStr, 'idle');
        invalidateWorklogs();
      } catch (err) {
        setCellStatus(cell.issueKey, dateStr, 'error', formatError((err as Error).message));
      }
    },
    [invalidateWorklogs, setCellStatus],
  );

  const getCellState = useCallback(
    (issueKey: string, date: Date): CellMutationState => {
      const key = cellKey(issueKey, date);
      return cellStates.get(key) ?? { issueKey, date: formatDateISO(date), status: 'idle' };
    },
    [cellStates],
  );

  return { cellStates, saveCell, updateWorklog, deleteWorklog, deleteCell, getCellState };
}

/** Check if a worklog already exists for an issue on a given date */
export async function checkExistingWorklogs(issueKey: string, date: string): Promise<boolean> {
  try {
    const res = await apiFetch(
      `/api/worklogs?issueKeys=${encodeURIComponent(issueKey)}&startDate=${date}&endDate=${date}`,
    );
    if (!res.ok) return false;
    const data = await res.json();
    const worklogs = data.worklogs?.[issueKey] ?? [];
    return worklogs.length > 0;
  } catch {
    return false;
  }
}
