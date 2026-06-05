'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JiraUser } from '@/src/types/jira';
import { getUserColor } from '@/lib/calendar-constants';
import { apiFetch } from '@/lib/api-client';

const STORAGE_KEY = 'calendar-selected-users';

export interface TeamMember extends JiraUser {
  color: string;
}

interface UseTeamMembersReturn {
  teamMembers: TeamMember[];
  selectedAccountIds: Set<string>;
  isLoading: boolean;
  error: string | null;
  toggleUser: (accountId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  isSelected: (accountId: string) => boolean;
  fetchTeamMembers: (projectKey: string) => void;
}

async function fetchTeamMembersApi(projectKey: string): Promise<TeamMember[]> {
  const res = await apiFetch(
    `/api/team-members?project=${encodeURIComponent(projectKey)}`,
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Failed (${res.status})`);
  }
  const data = await res.json();
  return (data.users as JiraUser[]).map((u) => ({
    ...u,
    color: getUserColor(u.accountId),
  }));
}

export function useTeamMembers(fallbackUser?: JiraUser | null): UseTeamMembersReturn {
  const [projectKey, setProjectKey] = useState<string | null>(null);

  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        try {
          return new Set(JSON.parse(saved) as string[]);
        } catch { /* ignore */ }
      }
    }
    return new Set();
  });

  const { data: fetchedMembers = [], isLoading, error } = useQuery({
    queryKey: ['team-members', projectKey],
    queryFn: () => fetchTeamMembersApi(projectKey!),
    enabled: !!projectKey,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // When no project is selected, fall back to showing just the current user
  // so the UserSelector is never empty and worklogs still load.
  const teamMembers: TeamMember[] = useMemo(() => {
    if (fetchedMembers.length > 0) return fetchedMembers;
    if (!projectKey && fallbackUser?.accountId) {
      return [{ ...fallbackUser, color: getUserColor(fallbackUser.accountId) }];
    }
    return [];
  }, [fetchedMembers, projectKey, fallbackUser]);

  // Persist selected account IDs to localStorage
  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(Array.from(selectedAccountIds)),
    );
  }, [selectedAccountIds]);

  // Public method that triggers the query by setting projectKey
  const fetchTeamMembers = useCallback((key: string) => {
    setProjectKey(key);
  }, []);

  const toggleUser = useCallback((accountId: string) => {
    setSelectedAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(accountId)) {
        if (next.size > 1) {
          next.delete(accountId);
        }
      } else {
        next.add(accountId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedAccountIds(new Set(teamMembers.map((m) => m.accountId)));
  }, [teamMembers]);

  const deselectAll = useCallback(() => {
    if (teamMembers.length > 0) {
      setSelectedAccountIds(new Set([teamMembers[0].accountId]));
    }
  }, [teamMembers]);

  const isSelected = useCallback(
    (accountId: string) => selectedAccountIds.has(accountId),
    [selectedAccountIds],
  );

  return {
    teamMembers,
    selectedAccountIds,
    isLoading,
    error: error ? (error as Error).message : null,
    toggleUser,
    selectAll,
    deselectAll,
    isSelected,
    fetchTeamMembers,
  };
}
