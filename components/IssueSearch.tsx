'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import Textfield from '@atlaskit/textfield';
import Spinner from '@atlaskit/spinner';
import { token } from '@atlaskit/tokens';
import type { JiraIssue } from '@/src/types/jira';
import { apiFetch } from '@/lib/api-client';

interface IssueSearchProps {
  onAddIssue: (issue: JiraIssue) => void;
  existingKeys: string[];
  projectKey?: string;
}

export default function IssueSearch({ onAddIssue, existingKeys, projectKey }: IssueSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<JiraIssue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const searchIssues = useCallback(async (searchQuery: string) => {
    if (searchQuery.trim().length < 2) {
      setResults([]);
      setShowDropdown(false);
      return;
    }

    setIsLoading(true);
    try {
      const projectFilter = projectKey ? `project = "${projectKey}" AND ` : '';
      const jql = searchQuery.includes('-')
        ? `${projectFilter}(key = "${searchQuery}" OR summary ~ "${searchQuery}") ORDER BY updated DESC`
        : `${projectFilter}summary ~ "${searchQuery}" ORDER BY updated DESC`;

      const response = await apiFetch(`/api/issues?jql=${encodeURIComponent(jql)}&maxResults=10`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();

      const filtered = (data.issues || []).filter(
        (issue: JiraIssue) => !existingKeys.includes(issue.key)
      );

      setResults(filtered);
      setShowDropdown(filtered.length > 0);
    } catch (err) {
      console.error('Issue search failed:', err);
      setResults([]);
    } finally {
      setIsLoading(false);
    }
  }, [existingKeys, projectKey]);

  const handleInputChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchIssues(value), 400);
  };

  const handleSelect = (issue: JiraIssue) => {
    onAddIssue(issue);
    setQuery('');
    setResults([]);
    setShowDropdown(false);
  };

  return (
    <div ref={containerRef} className="relative mb-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Textfield
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange(e.target.value)}
            placeholder="Search issues by key or summary..."
            elemAfterInput={isLoading ? (
              <div className="pr-2">
                <Spinner size="small" />
              </div>
            ) : undefined}
          />
        </div>
      </div>

      {showDropdown && results.length > 0 && (
        <ul
          className="absolute z-10 w-full mt-1 rounded-md max-h-60 overflow-auto"
          style={{
            backgroundColor: token('color.background.input'),
            border: `1px solid ${token('color.border')}`,
            boxShadow: token('elevation.shadow.overlay'),
          }}
        >
          {results.map((issue) => (
            <li key={issue.id}>
              <button
                onClick={() => handleSelect(issue)}
                className="w-full px-3 py-2 text-left transition-colors flex items-center gap-2"
                style={{ color: token('color.text') }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = token('color.background.neutral.subtle.hovered'))}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <span className="text-sm font-medium" style={{ color: token('color.link') }}>{issue.key}</span>
                <span className="text-sm truncate" style={{ color: token('color.text.subtle') }}>{issue.fields.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
