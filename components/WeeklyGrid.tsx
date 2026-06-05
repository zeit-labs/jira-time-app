'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Button from '@atlaskit/button/new';
import Spinner from '@atlaskit/spinner';
import { AutoDismissFlag, FlagGroup } from '@atlaskit/flag';
import { token } from '@atlaskit/tokens';
import WeekNavigator from '@/components/WeekNavigator';
import TimesheetRow from '@/components/TimesheetRow';
import GrandTotal from '@/components/GrandTotal';
import IssueSearch from '@/components/IssueSearch';
import BulkEntryModal from '@/components/BulkEntryModal';
import HistoricalLogViewer from '@/components/HistoricalLogViewer';
import { getWeekRange, shiftWeek, formatDateISO, getDayLabel } from '@/lib/date-utils';
import { aggregateWorklogs } from '@/lib/worklog-aggregator';
import { loadSavedIssues, addSavedIssue, removeSavedIssue } from '@/lib/issue-storage';
import { useWorklogMutations } from '@/hooks/useWorklogMutations';
import type { WeekRange, IssueSelection } from '@/types/timesheet';
import type { JiraIssue, JiraWorklog } from '@/src/types/jira';
import { apiFetch } from '@/lib/api-client';

interface WeeklyGridProps {
  projectKey?: string;
}

export default function WeeklyGrid({ projectKey }: WeeklyGridProps) {
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = useState<Date>(() => new Date());
  const [weekRange, setWeekRange] = useState<WeekRange>(() => getWeekRange(new Date()));
  const [savedIssues, setSavedIssues] = useState<IssueSelection[]>([]);
  const [flags, setFlags] = useState<Array<{ id: number; message: string; type: 'success' | 'error' }>>([]);
  const [showBulkEntry, setShowBulkEntry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // Load saved issues from localStorage
  useEffect(() => {
    const stored = loadSavedIssues();
    setSavedIssues(stored);
  }, []);

  // Update week range when weekStart changes
  useEffect(() => {
    setWeekRange(getWeekRange(weekStart));
  }, [weekStart]);

  const startDate = formatDateISO(weekRange.start);
  const endDate = formatDateISO(weekRange.end);

  // Auto-fetch issues that have worklogs in the visible week
  useEffect(() => {
    (async () => {
      try {
        let res: Response;
        if (projectKey) {
          const jql = `project = "${projectKey}" AND (worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" OR assignee = currentUser()) ORDER BY updated DESC`;
          res = await apiFetch(`/api/issues?jql=${encodeURIComponent(jql)}&maxResults=50`);
        } else {
          res = await apiFetch(`/api/my-issues?startDate=${startDate}&endDate=${endDate}`);
        }
        if (!res.ok) return;
        const data = await res.json();
        const autoIssues: JiraIssue[] = data.issues || [];

        // Merge auto-loaded issues with saved ones (dedup by key)
        setSavedIssues((prev) => {
          const existingKeys = new Set(prev.map((s) => s.issueKey));
          const newIssues = autoIssues.filter((issue) => !existingKeys.has(issue.key));
          if (newIssues.length === 0) return prev;
          return [
            ...prev,
            ...newIssues.map((issue) => ({
              issueKey: issue.key,
              summary: issue.fields.summary,
              addedAt: new Date().toISOString(),
            })),
          ];
        });
      } catch (err) {
        console.error('Auto-load issues failed:', err);
      }
    })();
  }, [projectKey, startDate, endDate]);

  // Stable sorted issue keys for query key identity
  const issueKeys = savedIssues.map((s) => s.issueKey);
  const sortedIssueKeys = useMemo(() => [...issueKeys].sort(), [issueKeys.join(',')]);

  // Fetch issue details via React Query
  const { data: issuesData } = useQuery({
    queryKey: ['weekly-issues', sortedIssueKeys],
    queryFn: async () => {
      if (issueKeys.length === 0) return [];
      const jql = `key in (${issueKeys.join(',')}) ORDER BY key ASC`;
      const res = await apiFetch(`/api/issues?jql=${encodeURIComponent(jql)}&maxResults=${issueKeys.length}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to fetch issues (${res.status})`);
      }
      const data = await res.json();
      return (data.issues || []) as JiraIssue[];
    },
    enabled: issueKeys.length > 0,
    staleTime: 5 * 60 * 1000, // 5 minutes — issues don't change often
  });

  // Fetch worklogs via React Query (uses 'worklogs' prefix so useWorklogMutations invalidation matches)
  const { data: worklogsData, isLoading: isLoadingWorklogs, error: worklogsError } = useQuery({
    queryKey: ['worklogs', 'weekly', sortedIssueKeys, startDate, endDate],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/worklogs?issueKeys=${issueKeys.join(',')}&startDate=${startDate}&endDate=${endDate}`
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Failed to fetch worklogs (${res.status})`);
      }
      const data = await res.json();
      return data.worklogs as Record<string, JiraWorklog[]>;
    },
    enabled: issueKeys.length > 0,
    staleTime: 30 * 1000, // 30 seconds
  });

  // Derive grid data from fetched issues + worklogs
  const gridData = useMemo(() => {
    if (!issuesData || !worklogsData) return null;
    return aggregateWorklogs(issuesData, worklogsData, weekRange);
  }, [issuesData, worklogsData, weekRange]);

  // Worklog mutations hook (no arguments — invalidation via React Query)
  const { saveCell, updateWorklog, deleteWorklog, getCellState } = useWorklogMutations();

  // Toast management
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setFlags((prev) => [...prev, { id: Date.now(), message, type }]);
  }, []);

  // Week navigation handlers
  const handlePrevWeek = () => setWeekStart((prev) => shiftWeek(prev, -1));
  const handleNextWeek = () => setWeekStart((prev) => shiftWeek(prev, 1));
  const handleToday = () => setWeekStart(new Date());

  // Issue management handlers
  const handleAddIssue = (issue: JiraIssue) => {
    const updated = addSavedIssue(issue.key, issue.fields.summary);
    setSavedIssues(updated);
  };

  const handleRemoveIssue = (issueKey: string) => {
    const updated = removeSavedIssue(issueKey);
    setSavedIssues(updated);
  };

  return (
    <div>
      {/* Toast notifications */}
      <FlagGroup onDismissed={(id) => setFlags((prev) => prev.filter((f) => f.id !== id))}>
        {flags.map((flag) => (
          <AutoDismissFlag
            key={flag.id}
            id={flag.id}
            appearance={flag.type === 'success' ? 'success' : 'error'}
            title={flag.message}
          />
        ))}
      </FlagGroup>

      {/* Week navigation */}
      <WeekNavigator
        weekRange={weekRange}
        onPrevious={handlePrevWeek}
        onNext={handleNextWeek}
        onToday={handleToday}
      />

      {/* Issue search */}
      <IssueSearch
        onAddIssue={handleAddIssue}
        existingKeys={savedIssues.map((s) => s.issueKey)}
        projectKey={projectKey}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 mb-4">
        <Button
          onClick={() => setShowBulkEntry(true)}
          appearance="primary"
        >
          Bulk Entry
        </Button>
        <Button
          onClick={() => setShowHistory(true)}
          appearance="default"
        >
          View History
        </Button>
      </div>

      {/* Error state */}
      {worklogsError && (
        <div
          className="mb-4 p-3 rounded-md text-sm"
          style={{
            backgroundColor: token('color.background.danger'),
            border: `1px solid ${token('color.border.danger')}`,
            color: token('color.text.danger'),
          }}
        >
          {worklogsError.message}
        </div>
      )}

      {/* Loading state */}
      {isLoadingWorklogs && (
        <div className="flex items-center justify-center py-12">
          <Spinner size="large" />
          <span className="ml-3" style={{ color: token('color.text.subtlest') }}>Loading timesheet data...</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoadingWorklogs && !worklogsError && savedIssues.length === 0 && (
        <div className="text-center py-12" style={{ color: token('color.text.subtlest') }}>
          <p className="text-lg mb-2">No issues added yet</p>
          <p className="text-sm">Search for Jira issues above to start tracking your time.</p>
        </div>
      )}

      {/* Grid table */}
      {!isLoadingWorklogs && gridData && gridData.rows.length > 0 && (
        <div
          className="overflow-x-auto rounded-lg"
          style={{ border: `1px solid ${token('color.border')}` }}
        >
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ backgroundColor: token('color.background.neutral'), borderBottom: `1px solid ${token('color.border')}` }}>
                <th
                  className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider min-w-[220px]"
                  style={{ color: token('color.text.subtlest') }}
                >
                  Issue
                </th>
                {weekRange.dates.map((date, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider min-w-[80px]"
                    style={{ color: token('color.text.subtlest') }}
                  >
                    {getDayLabel(date)}
                  </th>
                ))}
                <th
                  className="px-3 py-2 text-center text-xs font-semibold uppercase tracking-wider min-w-[80px]"
                  style={{ color: token('color.text.subtlest'), backgroundColor: token('color.background.neutral.hovered') }}
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {gridData.rows.map((row) => (
                <TimesheetRow
                  key={row.issue.key}
                  row={row}
                  onRemove={handleRemoveIssue}
                  onSaveCell={saveCell}
                  onUpdateWorklog={updateWorklog}
                  onDeleteWorklog={deleteWorklog}
                  getCellState={getCellState}
                />
              ))}
            </tbody>
            <tfoot>
              <GrandTotal
                columnTotals={gridData.columnTotals}
                grandTotal={gridData.grandTotal}
              />
            </tfoot>
          </table>
        </div>
      )}

      {/* Modals */}
      <BulkEntryModal
        isOpen={showBulkEntry}
        onClose={() => setShowBulkEntry(false)}
        onComplete={() => {
          queryClient.invalidateQueries({ queryKey: ['worklogs'] });
          setShowBulkEntry(false);
        }}
      />
      <HistoricalLogViewer
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        savedIssueKeys={savedIssues.map((s) => s.issueKey)}
      />
    </div>
  );
}
