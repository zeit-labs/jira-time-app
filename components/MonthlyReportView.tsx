'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { token } from '@atlaskit/tokens';
import { format, getDaysInMonth } from 'date-fns';
import dynamic from 'next/dynamic';
import {
  buildMonthlyReport,
  formatSeconds,
  secondsToHours,
  type RawReportInput,
  type MonthlyReport,
} from '@/types/report';
import type { JiraIssue, JiraWorklog } from '@/src/types/jira';
import { apiFetch } from '@/lib/api-client';

// Dynamically import PDF button to avoid SSR issues with @react-pdf/renderer
const ReportPDFButton = dynamic<{ report: MonthlyReport }>(
  () => import('./ReportPDFButton'),
  { ssr: false }
);

// ── CSV export ────────────────────────────────────────────────────────────────

function escapeCsvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadReportCSV(report: MonthlyReport) {
  const headers = ['Date', 'Issue Key', 'Summary', 'Project', 'Hours', 'Time', 'Comment'];
  const rows: string[][] = report.byDay.flatMap((day) =>
    day.entries.map((entry) => [
      entry.date,
      entry.issueKey,
      entry.issueSummary,
      entry.projectName,
      secondsToHours(entry.timeSpentSeconds).toString(),
      formatSeconds(entry.timeSpentSeconds),
      entry.comment ?? '',
    ]),
  );

  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${report.authorName.replace(/\s+/g, '-')}-${report.year}-${String(report.month).padStart(2, '0')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Types returned by /api/report ────────────────────────────────────────────

interface ReportApiResponse {
  issues: JiraIssue[];
  worklogsByIssue: Record<string, JiraWorklog[]>;
  authorAccountId: string;
  authorName: string;
}

interface TeamUser { accountId: string; displayName: string; }

// ── Month/Year picker helpers ────────────────────────────────────────────────

function getMonthOptions() {
  return Array.from({ length: 12 }, (_, i) => ({
    value: i + 1,
    label: format(new Date(2000, i, 1), 'MMMM'),
  }));
}

function getYearOptions() {
  const current = new Date().getFullYear();
  return Array.from({ length: 5 }, (_, i) => current - i);
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function fetchMonthlyReport(month: number, year: number, accountId?: string): Promise<ReportApiResponse> {
  const params = new URLSearchParams({ month: String(month), year: String(year) });
  if (accountId) params.set('accountId', accountId);
  const res = await apiFetch(`/api/report?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to load report');
  }
  return res.json();
}

async function fetchTeamUsers(month: number, year: number): Promise<TeamUser[]> {
  const res = await apiFetch(`/api/team-report?month=${month}&year=${year}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.users ?? []) as TeamUser[];
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MonthlyReportView() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [activeTab, setActiveTab] = useState<'day' | 'issue' | 'project' | 'comments'>('issue');
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');

  // Fetch team users for the "report for" picker (lazy — only when month/year are set)
  const { data: teamUsers } = useQuery<TeamUser[]>({
    queryKey: ['team-users-for-report', month, year],
    queryFn: () => fetchTeamUsers(month, year),
    staleTime: 10 * 60 * 1000,
  });

  const { data, isLoading, error, refetch } = useQuery<ReportApiResponse>({
    queryKey: ['monthly-report', month, year, selectedAccountId],
    queryFn: () => fetchMonthlyReport(month, year, selectedAccountId || undefined),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const report: MonthlyReport | null = useMemo(() => {
    if (!data) return null;
    const inputs: RawReportInput[] = data.issues.map((issue) => ({
      issueKey: issue.key,
      issueSummary: issue.fields.summary,
      projectKey: issue.fields.project.key,
      projectName: issue.fields.project.name,
      worklogs: data.worklogsByIssue[issue.key] ?? [],
    }));
    return buildMonthlyReport(inputs, month, year, data.authorAccountId, data.authorName);
  }, [data, month, year]);

  const handleGenerate = useCallback(() => {
    refetch();
  }, [refetch]);

  // ── Render ──────────────────────────────────────────────────────────────────

  const selectStyle: React.CSSProperties = {
    padding: '6px 10px',
    borderRadius: 4,
    border: `1px solid ${token('color.border')}`,
    background: token('color.background.input'),
    color: token('color.text'),
    fontSize: 14,
    cursor: 'pointer',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 16px',
    borderBottom: active ? `2px solid ${token('color.border.focused')}` : '2px solid transparent',
    borderLeft: 'none',
    borderRight: 'none',
    borderTop: 'none',
    color: active ? token('color.text.selected') : token('color.text.subtle'),
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    background: 'none',
    fontSize: 14,
    transition: 'color 0.15s',
  });

  return (
    <div style={{ color: token('color.text') }}>
      {/* Header / Controls */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold">Monthly Report</h2>
          <p className="text-sm mt-1" style={{ color: token('color.text.subtlest') }}>
            Your logged time for a selected month
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* User picker */}
          {teamUsers && teamUsers.length > 0 && (
            <select
              style={selectStyle}
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              title="View report for"
            >
              <option value="">My Report</option>
              {teamUsers.map((u) => (
                <option key={u.accountId} value={u.accountId}>{u.displayName}</option>
              ))}
            </select>
          )}

          <select style={selectStyle} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {getMonthOptions().map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>

          <select style={selectStyle} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {getYearOptions().map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <button
            onClick={handleGenerate}
            disabled={isLoading}
            style={{
              padding: '7px 18px',
              background: token('color.background.brand.bold'),
              color: token('color.text.inverse'),
              border: 'none',
              borderRadius: 4,
              fontWeight: 600,
              fontSize: 14,
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? 'Loading…' : 'Generate'}
          </button>

          {report && (
            <button
              onClick={() => downloadReportCSV(report)}
              title="Download as CSV"
              style={{
                padding: '7px 14px',
                background: token('color.background.neutral'),
                color: token('color.text'),
                border: `1px solid ${token('color.border')}`,
                borderRadius: 4,
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              CSV
            </button>
          )}

          {report && <ReportPDFButton report={report} />}
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="p-4 rounded mb-6"
          style={{ background: token('color.background.danger'), color: token('color.text.danger') }}
        >
          {(error as Error).message}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-12 rounded animate-pulse" style={{ background: token('color.background.neutral') }} />
          ))}
        </div>
      )}

      {/* No data */}
      {!isLoading && report && report.totalSeconds === 0 && (
        <div
          className="p-8 rounded text-center"
          style={{ background: token('color.background.neutral'), color: token('color.text.subtlest') }}
        >
          No work logged in {format(new Date(year, month - 1, 1), 'MMMM yyyy')}.
        </div>
      )}

      {/* Report content */}
      {!isLoading && report && report.totalSeconds > 0 && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard label="Total Time" value={formatSeconds(report.totalSeconds)} />
            <SummaryCard label="Total Hours" value={`${secondsToHours(report.totalSeconds)}h`} />
            <SummaryCard label="Issues Worked" value={String(report.byIssue.length)} />
            <SummaryCard label="Projects" value={String(report.byProject.length)} />
          </div>

          {/* Tabs */}
          <div
            className="flex gap-1 mb-4 border-b"
            style={{ borderColor: token('color.border') }}
          >
            {(['issue', 'project', 'day', 'comments'] as const).map((t) => (
              <button key={t} style={tabStyle(activeTab === t)} onClick={() => setActiveTab(t)}>
                {t === 'day' ? 'By Day' : t === 'issue' ? 'By Issue' : t === 'project' ? 'By Project' : 'Comments'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'issue' && <IssueTable report={report} />}
          {activeTab === 'project' && <ProjectTable report={report} />}
          {activeTab === 'day' && <DayTable report={report} />}
          {activeTab === 'comments' && <CommentsTable report={report} />}
        </>
      )}
    </div>
  );
}

// ── Summary card ─────────────────────────────────────────────────────────────

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{
        background: token('color.background.neutral'),
        border: `1px solid ${token('color.border')}`,
      }}
    >
      <div className="text-xs font-medium mb-1" style={{ color: token('color.text.subtlest') }}>
        {label}
      </div>
      <div className="text-2xl font-bold" style={{ color: token('color.text') }}>
        {value}
      </div>
    </div>
  );
}

// ── Table styles ─────────────────────────────────────────────────────────────

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  borderBottom: `2px solid ${token('color.border')}`,
};
const tdStyle: React.CSSProperties = { padding: '8px 12px', borderBottom: `1px solid ${token('color.border')}` };

// ── By Issue table ────────────────────────────────────────────────────────────

function IssueTable({ report }: { report: MonthlyReport }) {
  return (
    <table style={tableStyle}>
      <thead>
        <tr style={{ color: token('color.text.subtlest') }}>
          <th style={thStyle}>Issue</th>
          <th style={thStyle}>Summary</th>
          <th style={thStyle}>Project</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Time</th>
        </tr>
      </thead>
      <tbody>
        {report.byIssue.map((row) => (
          <tr key={row.issueKey} style={{ color: token('color.text') }}>
            <td style={tdStyle}>
              <span
                className="font-mono text-xs px-2 py-0.5 rounded"
                style={{ background: token('color.background.neutral'), color: token('color.text.accent.blue') }}
              >
                {row.issueKey}
              </span>
            </td>
            <td style={tdStyle}>{row.issueSummary}</td>
            <td style={{ ...tdStyle, color: token('color.text.subtle') }}>{row.projectName}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
              {formatSeconds(row.totalSeconds)}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <td colSpan={3} style={{ ...tdStyle, fontWeight: 700, borderTop: `2px solid ${token('color.border')}` }}>
            Total
          </td>
          <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700, borderTop: `2px solid ${token('color.border')}` }}>
            {formatSeconds(report.totalSeconds)}
          </td>
        </tr>
      </tfoot>
    </table>
  );
}

// ── By Project table ──────────────────────────────────────────────────────────

function ProjectTable({ report }: { report: MonthlyReport }) {
  return (
    <div className="flex flex-col gap-4">
      {report.byProject.map((proj) => (
        <div key={proj.projectKey} className="rounded-lg overflow-hidden" style={{ border: `1px solid ${token('color.border')}` }}>
          <div
            className="flex justify-between items-center px-4 py-3"
            style={{ background: token('color.background.neutral') }}
          >
            <span className="font-semibold">{proj.projectName}</span>
            <span className="font-bold">{formatSeconds(proj.totalSeconds)}</span>
          </div>
          <table style={{ ...tableStyle, margin: 0 }}>
            <tbody>
              {proj.issues.map((issue) => (
                <tr key={issue.issueKey}>
                  <td style={{ ...tdStyle, width: 120 }}>
                    <span className="font-mono text-xs" style={{ color: token('color.text.accent.blue') }}>
                      {issue.issueKey}
                    </span>
                  </td>
                  <td style={tdStyle}>{issue.issueSummary}</td>
                  <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600, width: 100 }}>
                    {formatSeconds(issue.totalSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

// ── By Day table ──────────────────────────────────────────────────────────────

function DayTable({ report }: { report: MonthlyReport }) {
  // Build full month grid (all days, even with 0 hours)
  const daysInMonth = getDaysInMonth(new Date(report.year, report.month - 1));
  const dayMap = new Map(report.byDay.map((d) => [d.date, d.totalSeconds]));

  const rows = Array.from({ length: daysInMonth }, (_, i) => {
    const d = i + 1;
    const date = `${report.year}-${String(report.month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayLabel = format(new Date(report.year, report.month - 1, d), 'EEE, MMM d');
    const seconds = dayMap.get(date) ?? 0;
    return { date, dayLabel, seconds };
  });

  const maxSeconds = Math.max(...rows.map((r) => r.seconds), 1);

  return (
    <div className="flex flex-col gap-1">
      {rows.map((row) => (
        <div key={row.date} className="flex items-center gap-3">
          <span className="text-xs w-28 shrink-0" style={{ color: token('color.text.subtle') }}>
            {row.dayLabel}
          </span>
          <div className="flex-1 h-6 rounded overflow-hidden" style={{ background: token('color.background.neutral') }}>
            {row.seconds > 0 && (
              <div
                className="h-full rounded transition-all"
                style={{
                  width: `${(row.seconds / maxSeconds) * 100}%`,
                  background: token('color.background.brand.bold'),
                  opacity: 0.85,
                }}
              />
            )}
          </div>
          <span
            className="text-xs w-16 text-right font-mono"
            style={{ color: row.seconds > 0 ? token('color.text') : token('color.text.disabled') }}
          >
            {row.seconds > 0 ? formatSeconds(row.seconds) : '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Comments table ────────────────────────────────────────────────────────────

function CommentsTable({ report }: { report: MonthlyReport }) {
  const allEntries = report.byDay.flatMap((d) => d.entries).filter((e) => e.comment);

  if (allEntries.length === 0) {
    return (
      <div className="p-6 text-center" style={{ color: token('color.text.subtlest') }}>
        No comments on any worklog entries this month.
      </div>
    );
  }

  return (
    <table style={tableStyle}>
      <thead>
        <tr style={{ color: token('color.text.subtlest') }}>
          <th style={thStyle}>Date</th>
          <th style={thStyle}>Issue</th>
          <th style={thStyle}>Comment</th>
          <th style={{ ...thStyle, textAlign: 'right' }}>Time</th>
        </tr>
      </thead>
      <tbody>
        {allEntries.map((e) => (
          <tr key={e.worklogId} style={{ color: token('color.text') }}>
            <td style={{ ...tdStyle, whiteSpace: 'nowrap', color: token('color.text.subtle') }}>
              {format(new Date(e.date), 'MMM d')}
            </td>
            <td style={tdStyle}>
              <span className="font-mono text-xs" style={{ color: token('color.text.accent.blue') }}>
                {e.issueKey}
              </span>
            </td>
            <td style={tdStyle}>{e.comment}</td>
            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>
              {formatSeconds(e.timeSpentSeconds)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
