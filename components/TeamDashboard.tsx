'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { token } from '@atlaskit/tokens';
import { format, eachDayOfInterval, startOfMonth, endOfMonth } from 'date-fns';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, Cell,
  PieChart, Pie,
} from 'recharts';
import {
  formatSeconds, secondsToHours, DEFAULT_TARGET_HOURS,
  type DashboardUserRow, type TargetHoursConfig,
} from '@/types/report';
import type { JiraWorklog } from '@/src/types/jira';
import { getDaysInMonth } from 'date-fns';
import { apiFetch } from '@/lib/api-client';

// ── Progress alert ────────────────────────────────────────────────────────────

type AlertLevel = 'ahead' | 'on-track' | 'at-risk' | 'behind' | null;

function getAlertLevel(
  totalSeconds: number,
  targetSeconds: number,
  month: number,
  year: number,
): AlertLevel {
  const now = new Date();
  // Only show alerts for the current month
  if (now.getFullYear() !== year || now.getMonth() + 1 !== month) return null;

  const dayOfMonth = now.getDate();
  const daysInMonth = getDaysInMonth(new Date(year, month - 1));
  const proRatedTarget = (dayOfMonth / daysInMonth) * targetSeconds;
  if (proRatedTarget === 0) return null;

  const ratio = totalSeconds / proRatedTarget;
  if (ratio >= 1.05) return 'ahead';
  if (ratio >= 0.85) return 'on-track';
  if (ratio >= 0.5) return 'at-risk';
  return 'behind';
}

const ALERT_STYLES: Record<AlertLevel & string, { label: string; bg: string; color: string }> = {
  ahead:    { label: 'Ahead',    bg: '#E3FCEF', color: '#006644' },
  'on-track': { label: 'On track', bg: '#DEEBFF', color: '#0747A6' },
  'at-risk':  { label: 'At risk',  bg: '#FFFAE6', color: '#974F0C' },
  behind:   { label: 'Behind',   bg: '#FFEBE6', color: '#BF2600' },
};

// ── Projects fetch ────────────────────────────────────────────────────────────

interface JiraProject { key: string; name: string; }

async function fetchProjects(): Promise<JiraProject[]> {
  const res = await apiFetch('/api/projects');
  if (!res.ok) return [];
  const data = await res.json();
  return data.projects ?? [];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamReportApiResponse {
  users: { accountId: string; displayName: string }[];
  worklogsByUser: Record<string, Record<string, JiraWorklog[]>>;
  issuesByUser: Record<string, { key: string; summary: string; projectKey: string; projectName: string }[]>;
}

// ── Palette ───────────────────────────────────────────────────────────────────

const USER_COLORS = [
  '#0052CC', '#36B37E', '#FF5630', '#6554C0', '#FF8B00',
  '#00B8D9', '#57D9A3', '#FF7452', '#998DD9', '#FFab00',
];

function getUserColor(index: number) {
  return USER_COLORS[index % USER_COLORS.length];
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchTeamReport(month: number, year: number, projectKey?: string): Promise<TeamReportApiResponse> {
  const params = new URLSearchParams({ month: String(month), year: String(year) });
  if (projectKey) params.set('projectKey', projectKey);
  const res = await apiFetch(`/api/team-report?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Failed to load team dashboard');
  }
  return res.json();
}

// ── Aggregate API data → DashboardUserRow[] ───────────────────────────────────

function buildDashboardRows(
  data: TeamReportApiResponse,
  month: number,
  year: number,
  targetSeconds: number,
): DashboardUserRow[] {
  return data.users.map((user) => {
    const worklogsByIssue = data.worklogsByUser[user.accountId] ?? {};
    const issues = data.issuesByUser[user.accountId] ?? [];

    let totalSeconds = 0;
    const dailyActivity: Record<string, number> = {};
    const projectMap = new Map<string, { projectKey: string; projectName: string; totalSeconds: number }>();

    for (const issue of issues) {
      const worklogs = worklogsByIssue[issue.key] ?? [];
      let issueSeconds = 0;
      for (const wl of worklogs) {
        const date = wl.started.slice(0, 10);
        totalSeconds += wl.timeSpentSeconds;
        issueSeconds += wl.timeSpentSeconds;
        dailyActivity[date] = (dailyActivity[date] ?? 0) + wl.timeSpentSeconds;
      }
      if (issueSeconds > 0) {
        const prev = projectMap.get(issue.projectKey);
        projectMap.set(issue.projectKey, {
          projectKey: issue.projectKey,
          projectName: issue.projectName,
          totalSeconds: (prev?.totalSeconds ?? 0) + issueSeconds,
        });
      }
    }

    return {
      accountId: user.accountId,
      displayName: user.displayName,
      totalSeconds,
      targetSeconds,
      projectBreakdown: Array.from(projectMap.values()).sort((a, b) => b.totalSeconds - a.totalSeconds),
      dailyActivity,
    };
  }).sort((a, b) => b.totalSeconds - a.totalSeconds);
}

// ── Month/Year helpers ────────────────────────────────────────────────────────

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

const selectStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderRadius: 4,
  border: `1px solid ${token('color.border')}`,
  background: token('color.background.input'),
  color: token('color.text'),
  fontSize: 14,
  cursor: 'pointer',
};

// ── Main component ────────────────────────────────────────────────────────────

export default function TeamDashboard() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [targetConfig, setTargetConfig] = useState<TargetHoursConfig>(() => {
    if (typeof window === 'undefined') return DEFAULT_TARGET_HOURS;
    try {
      const stored = window.localStorage.getItem('jira-target-hours');
      return stored ? JSON.parse(stored) : DEFAULT_TARGET_HOURS;
    } catch {
      return DEFAULT_TARGET_HOURS;
    }
  });
  const [editingTarget, setEditingTarget] = useState(false);
  const [tempTarget, setTempTarget] = useState(String(targetConfig.monthlyHours));

  const targetSeconds = targetConfig.monthlyHours * 3600;

  const { data: projects } = useQuery<JiraProject[]>({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 10 * 60 * 1000,
  });

  const { data, isLoading, error, refetch } = useQuery<TeamReportApiResponse>({
    queryKey: ['team-dashboard', month, year, selectedProject],
    queryFn: () => fetchTeamReport(month, year, selectedProject || undefined),
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });

  const rows: DashboardUserRow[] = useMemo(
    () => (data ? buildDashboardRows(data, month, year, targetSeconds) : []),
    [data, month, year, targetSeconds],
  );

  const saveTarget = useCallback(() => {
    const val = Number(tempTarget);
    if (!isNaN(val) && val > 0) {
      const cfg = { monthlyHours: val };
      setTargetConfig(cfg);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('jira-target-hours', JSON.stringify(cfg));
      }
    }
    setEditingTarget(false);
  }, [tempTarget]);

  // Bar chart data: one bar per user
  const barData = rows.map((r) => ({
    name: r.displayName.split(' ')[0], // First name only for chart
    fullName: r.displayName,
    logged: secondsToHours(r.totalSeconds),
    target: targetConfig.monthlyHours,
  }));

  return (
    <div style={{ color: token('color.text') }}>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div>
          <h2 className="text-xl font-semibold">Team Dashboard</h2>
          <p className="text-sm mt-1" style={{ color: token('color.text.subtlest') }}>
            Track team progress and logged hours
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Target hours config */}
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: token('color.text.subtle') }}>Target:</span>
            {editingTarget ? (
              <>
                <input
                  type="number"
                  value={tempTarget}
                  onChange={(e) => setTempTarget(e.target.value)}
                  style={{ ...selectStyle, width: 70 }}
                  min={1}
                  max={744}
                />
                <span className="text-sm" style={{ color: token('color.text.subtle') }}>h/month</span>
                <button
                  onClick={saveTarget}
                  style={{ ...selectStyle, background: token('color.background.brand.bold'), color: token('color.text.inverse'), border: 'none', fontWeight: 600 }}
                >Save</button>
              </>
            ) : (
              <button
                onClick={() => { setTempTarget(String(targetConfig.monthlyHours)); setEditingTarget(true); }}
                style={{ ...selectStyle, fontWeight: 600 }}
              >
                {targetConfig.monthlyHours}h/month
              </button>
            )}
          </div>

          <select
            style={selectStyle}
            value={selectedProject}
            onChange={(e) => setSelectedProject(e.target.value)}
          >
            <option value="">All Projects</option>
            {(projects ?? []).map((p) => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>

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
            onClick={() => refetch()}
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
            {isLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded mb-6" style={{ background: token('color.background.danger'), color: token('color.text.danger') }}>
          {(error as Error).message}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex flex-col gap-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 rounded animate-pulse" style={{ background: token('color.background.neutral') }} />
          ))}
        </div>
      )}

      {/* No data */}
      {!isLoading && rows.length === 0 && !error && (
        <div className="p-8 rounded text-center" style={{ background: token('color.background.neutral'), color: token('color.text.subtlest') }}>
          No data found for {format(new Date(year, month - 1, 1), 'MMMM yyyy')}.
        </div>
      )}

      {!isLoading && rows.length > 0 && (
        <>
          {/* Hours vs Target bar chart */}
          <div
            className="rounded-lg p-5 mb-6"
            style={{ background: token('color.background.neutral'), border: `1px solid ${token('color.border')}` }}
          >
            <h3 className="font-semibold mb-4">Hours Logged vs Target</h3>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={barData} margin={{ top: 4, right: 16, left: -8, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis unit="h" tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(value, name) => [`${value}h`, name === 'logged' ? 'Logged' : 'Target']}
                  labelFormatter={(label) => barData.find((d) => d.name === label)?.fullName ?? label}
                />
                <Legend formatter={(v) => v === 'logged' ? 'Logged Hours' : 'Monthly Target'} />
                <Bar dataKey="logged" name="logged" radius={[4, 4, 0, 0]}>
                  {barData.map((_, i) => (
                    <Cell key={i} fill={getUserColor(i)} />
                  ))}
                </Bar>
                <Bar dataKey="target" name="target" fill="#DFE1E6" radius={[4, 4, 0, 0]} opacity={0.6} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* User cards */}
          <div className="flex flex-col gap-4">
            {rows.map((user, idx) => (
              <UserCard key={user.accountId} user={user} color={getUserColor(idx)} month={month} year={year} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── User card ─────────────────────────────────────────────────────────────────

function UserCard({ user, color, month, year }: { user: DashboardUserRow; color: string; month: number; year: number }) {
  const [expanded, setExpanded] = useState(false);
  const progress = Math.min((user.totalSeconds / user.targetSeconds) * 100, 100);
  const overTarget = user.totalSeconds > user.targetSeconds;
  const alertLevel = getAlertLevel(user.totalSeconds, user.targetSeconds, month, year);

  // Build heatmap days
  const monthStart = startOfMonth(new Date(year, month - 1, 1));
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const maxDaySeconds = Math.max(...days.map((d) => user.dailyActivity[format(d, 'yyyy-MM-dd')] ?? 0), 1);

  // Project pie data
  const pieData = user.projectBreakdown.map((p, i) => ({
    name: p.projectName,
    value: secondsToHours(p.totalSeconds),
    fill: getUserColor(i + 2),
  }));

  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: `1px solid ${token('color.border')}` }}
    >
      {/* Card header */}
      <div
        className="flex items-center justify-between px-5 py-4 cursor-pointer"
        style={{ background: token('color.background.neutral') }}
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm"
            style={{ background: color, color: '#fff' }}
          >
            {user.displayName.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="font-semibold flex items-center gap-2">
              {user.displayName}
              {alertLevel && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '2px 7px',
                    borderRadius: 10,
                    background: ALERT_STYLES[alertLevel].bg,
                    color: ALERT_STYLES[alertLevel].color,
                  }}
                >
                  {ALERT_STYLES[alertLevel].label}
                </span>
              )}
            </div>
            <div className="text-xs" style={{ color: token('color.text.subtlest') }}>
              {user.projectBreakdown.length} project{user.projectBreakdown.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-6">
          {/* Progress bar */}
          <div className="w-40 hidden sm:block">
            <div className="flex justify-between text-xs mb-1" style={{ color: token('color.text.subtle') }}>
              <span>{formatSeconds(user.totalSeconds)}</span>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: token('color.background.neutral.hovered') }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progress}%`, background: overTarget ? '#36B37E' : color }}
              />
            </div>
          </div>

          <div className="text-right">
            <div className="font-bold text-lg" style={{ color }}>
              {formatSeconds(user.totalSeconds)}
            </div>
            <div className="text-xs" style={{ color: token('color.text.subtlest') }}>
              of {formatSeconds(user.targetSeconds)} target
            </div>
          </div>

          <span style={{ color: token('color.text.subtle'), fontSize: 18 }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-6" style={{ borderTop: `1px solid ${token('color.border')}` }}>
          {/* Activity heatmap */}
          <div>
            <div className="text-sm font-semibold mb-3">Daily Activity</div>
            <div className="flex flex-wrap gap-1">
              {days.map((day) => {
                const dateStr = format(day, 'yyyy-MM-dd');
                const secs = user.dailyActivity[dateStr] ?? 0;
                const intensity = secs > 0 ? 0.2 + (secs / maxDaySeconds) * 0.8 : 0;
                const dayNum = day.getDate();
                return (
                  <div
                    key={dateStr}
                    title={`${format(day, 'EEE, MMM d')}: ${secs > 0 ? formatSeconds(secs) : 'no logs'}`}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 3,
                      background: secs > 0 ? color : token('color.background.neutral'),
                      opacity: secs > 0 ? intensity : 0.5,
                      border: `1px solid ${token('color.border')}`,
                      cursor: 'default',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 9,
                      color: secs > 0 ? '#fff' : token('color.text.disabled'),
                    }}
                  >
                    {dayNum}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Project breakdown */}
          <div>
            <div className="text-sm font-semibold mb-3">By Project</div>
            {user.projectBreakdown.length === 0 ? (
              <div className="text-sm" style={{ color: token('color.text.subtlest') }}>No project data</div>
            ) : (
              <div className="flex flex-col gap-2">
                {user.projectBreakdown.map((proj, i) => {
                  const pct = user.totalSeconds > 0 ? (proj.totalSeconds / user.totalSeconds) * 100 : 0;
                  return (
                    <div key={proj.projectKey}>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{proj.projectName}</span>
                        <span className="font-semibold">{formatSeconds(proj.totalSeconds)} ({Math.round(pct)}%)</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: token('color.background.neutral.hovered') }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: getUserColor(i + 2) }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Mini pie chart */}
            {pieData.length > 0 && (
              <div className="mt-4 flex justify-center">
                <PieChart width={140} height={140}>
                  <Pie
                    data={pieData}
                    cx={65}
                    cy={65}
                    innerRadius={35}
                    outerRadius={60}
                    dataKey="value"
                    paddingAngle={2}
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => [`${v}h`, '']} />
                </PieChart>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
