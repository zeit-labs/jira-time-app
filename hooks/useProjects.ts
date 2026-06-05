'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { JiraProject } from '@/src/types/jira';
import { apiFetch } from '@/lib/api-client';

async function fetchProjects(): Promise<JiraProject[]> {
  const res = await apiFetch('/api/projects');
  if (!res.ok) throw new Error('Failed to fetch projects');
  const data = await res.json();
  return data.projects || [];
}

export function useProjects() {
  const [selectedProject, setSelectedProject] = useState<JiraProject | null>(null);

  const { data: projects = [], isLoading, error, refetch } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 5 * 60 * 1000,
  });

  // No auto-selection — null means "All Projects"

  return {
    projects,
    selectedProject,
    setSelectedProject,
    isLoading,
    error: error ? (error as Error).message : null,
    refetch,
  };
}
