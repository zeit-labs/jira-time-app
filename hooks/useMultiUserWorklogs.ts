'use client';

import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { JiraWorklog } from '@/src/types/jira';

interface UseMultiUserWorklogsProps {
  issueKeys: string[];
  startDate: string;
  endDate: string;
  accountIds: string[];
}

interface UseMultiUserWorklogsReturn {
  worklogs: JiraWorklog[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

async function fetchWorklogs(
  issueKeys: string[],
  startDate: string,
  endDate: string,
  accountIds: string[],
  signal?: AbortSignal,
): Promise<JiraWorklog[]> {
  const params = new URLSearchParams({
    issueKeys: issueKeys.join(','),
    startDate,
    endDate,
  });
  if (accountIds.length > 0) {
    params.set('accountIds', accountIds.join(','));
  }

  const res = await fetch(`/api/worklogs?${params.toString()}`, { signal });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed to fetch worklogs (${res.status})`);
  }

  const data = await res.json();
  const worklogsByIssue: Record<string, JiraWorklog[]> = data.worklogs ?? {};

  // Flatten worklogsByIssue into a single array, ensuring issueId is set
  const flattened: JiraWorklog[] = [];
  for (const [issueId, issueWorklogs] of Object.entries(worklogsByIssue)) {
    for (const wl of issueWorklogs) {
      flattened.push({
        ...wl,
        issueId: wl.issueId || issueId,
      });
    }
  }

  return flattened;
}

export function useMultiUserWorklogs({
  issueKeys,
  startDate,
  endDate,
  accountIds,
}: UseMultiUserWorklogsProps): UseMultiUserWorklogsReturn {
  const queryClient = useQueryClient();

  // Sort arrays for stable query keys (prevents unnecessary refetches)
  const sortedIssueKeys = [...issueKeys].sort();
  const sortedAccountIds = [...accountIds].sort();

  const { data: worklogs = [], isLoading, error } = useQuery({
    queryKey: ['worklogs', sortedIssueKeys, startDate, endDate, sortedAccountIds],
    queryFn: ({ signal }) => fetchWorklogs(issueKeys, startDate, endDate, accountIds, signal),
    enabled: issueKeys.length > 0 && startDate !== '' && endDate !== '',
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData, // keep previous data while navigating weeks
  });

  const refetch = () => {
    queryClient.invalidateQueries({ queryKey: ['worklogs'] });
  };

  return {
    worklogs,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}
