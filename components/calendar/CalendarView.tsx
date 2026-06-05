'use client';

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { token } from '@atlaskit/tokens';
import { useQuery } from '@tanstack/react-query';
import { format, isToday, differenceInMinutes, startOfDay, parseISO, addDays } from 'date-fns';
import type { JiraWorklog, JiraIssue } from '@/src/types/jira';
import type { CalendarSettings, CalendarEvent } from '@/types/calendar';
import { TIME_AXIS_WIDTH, DEFAULT_SETTINGS } from '@/lib/calendar-constants';
import { useCalendarGrid } from '@/hooks/useCalendarGrid';
import { useCalendarNavigation } from '@/hooks/useCalendarNavigation';
import { useCalendarEvents } from '@/hooks/useCalendarEvents';
import { useEventDrag } from '@/hooks/useEventDrag';
import { useEventResize } from '@/hooks/useEventResize';
import { useSlotSelection } from '@/hooks/useSlotSelection';
import { useContextMenu } from '@/hooks/useContextMenu';
import { useCalendarKeyboard } from '@/hooks/useCalendarKeyboard';
import { useTeamMembers } from '@/hooks/useTeamMembers';
import { useMultiUserWorklogs } from '@/hooks/useMultiUserWorklogs';
import CalendarDayColumn from './CalendarDayColumn';
import CalendarToolbar from './CalendarToolbar';
import CalendarSettingsPopover from './CalendarSettingsPopover';
import CalendarContextMenu from './CalendarContextMenu';
import UserSelector from './UserSelector';
import IssueSidebar from './IssueSidebar';
import IssuePickerModal from './IssuePickerModal';
import EditWorklogModal from './EditWorklogModal';
import DropZoneOverlay from './DropZoneOverlay';
import { useIssueDragDrop } from '@/hooks/useIssueDragDrop';
import { toJiraDatetime } from '@/lib/date-utils';
import { apiFetch } from '@/lib/api-client';
import Button from '@atlaskit/button/new';
import type { WorklogTemplate } from '@/types/template';

const SETTINGS_VERSION = 2;

interface CalendarViewProps {
  worklogs?: JiraWorklog[];
  issues: JiraIssue[];
  onCreateWorklog?: (issueKey: string, started: string, timeSpentSeconds: number) => Promise<void>;
  onUpdateWorklog?: (issueKey: string, worklogId: string, started: string, timeSpentSeconds: number) => Promise<void>;
  onDeleteWorklog?: (issueKey: string, worklogId: string) => Promise<void>;
  projectKey?: string;
  multiUserMode?: boolean;
  selectedUsers?: Array<{accountId: string; displayName: string; color: string}>;
}

export default function CalendarView({
  issues,
  onCreateWorklog,
  onUpdateWorklog,
  onDeleteWorklog,
  projectKey,
}: CalendarViewProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dayColumnRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // T017: Settings state with localStorage persistence
  const [settings, setSettings] = useState<CalendarSettings>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('calendar-settings');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed._version === SETTINGS_VERSION) {
            return { ...DEFAULT_SETTINGS, ...parsed };
          }
          return { ...DEFAULT_SETTINGS, ...parsed, startHour: DEFAULT_SETTINGS.startHour, _version: SETTINGS_VERSION };
        } catch { /* ignore */ }
      }
    }
    return { ...DEFAULT_SETTINGS, _version: SETTINGS_VERSION };
  });
  const [showSettings, setShowSettings] = useState(false);

  // Persist settings to localStorage on change
  useEffect(() => {
    localStorage.setItem('calendar-settings', JSON.stringify({ ...settings, _version: SETTINGS_VERSION }));
  }, [settings]);

  // T014: Error toast state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const errorTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current);
    errorTimeoutRef.current = setTimeout(() => setErrorMessage(null), 5000);
  }, []);

  // T018: Recently used issues (localStorage)
  const [recentIssueKeys, setRecentIssueKeys] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('recent-issue-keys');
        return saved ? JSON.parse(saved) : [];
      } catch { return []; }
    }
    return [];
  });
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Issue picker modal state (for slot selection flow)
  const [issuePickerState, setIssuePickerState] = useState<{
    isOpen: boolean;
    startDate: Date | null;
    timeSpentSeconds: number;
  }>({ isOpen: false, startDate: null, timeSpentSeconds: 0 });

  // Edit worklog modal state
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);

  // Helper to add an issue key to recent list
  const addRecentIssue = useCallback((key: string) => {
    setRecentIssueKeys(prev => {
      const filtered = prev.filter(k => k !== key);
      const updated = [key, ...filtered].slice(0, 10);
      localStorage.setItem('recent-issue-keys', JSON.stringify(updated));
      return updated;
    });
  }, []);

  // Core hooks
  const grid = useCalendarGrid(settings);
  const nav = useCalendarNavigation();

  // Auto-fetch current user — needed before useTeamMembers so it can be passed as fallback
  const { data: currentUser } = useQuery({
    queryKey: ['myself'],
    queryFn: async () => {
      const res = await apiFetch('/api/myself');
      if (!res.ok) return null;
      const data = await res.json();
      return data.user ?? null; // /api/myself returns { user: {...} }
    },
    staleTime: 10 * 60 * 1000, // 10 minutes — current user rarely changes
  });

  // T012: Team members and multi-user worklogs
  // Pass currentUser as fallback so the UserSelector is never empty when no project is selected
  const team = useTeamMembers(currentUser ?? null);
  const multiUserMode = team.selectedAccountIds.size > 1;

  // Auto-select current user when data arrives
  useEffect(() => {
    if (currentUser?.accountId && team.selectedAccountIds.size === 0) {
      team.toggleUser(currentUser.accountId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.accountId]);

  // Fetch team members when projectKey is provided
  useEffect(() => {
    if (projectKey) {
      team.fetchTeamMembers(projectKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey]);

  // Derive date range and issue keys for multi-user worklogs
  const dateRange = useMemo(() => {
    if (nav.visibleDays.length === 0) return { startDate: '', endDate: '' };
    const first = nav.visibleDays[0];
    const last = nav.visibleDays[nav.visibleDays.length - 1];
    return {
      startDate: format(first, 'yyyy-MM-dd'),
      endDate: format(addDays(last, 1), 'yyyy-MM-dd'),
    };
  }, [nav.visibleDays]);

  // Fetch issues scoped to visible date range
  const { data: ownIssues, isLoading: isLoadingIssues } = useQuery({
    queryKey: ['calendar-issues-scoped', projectKey, dateRange.startDate, dateRange.endDate],
    queryFn: async () => {
      if (!dateRange.startDate || !dateRange.endDate) return [];
      let res: Response;
      if (projectKey) {
        const jql = `project = "${projectKey}" AND (worklogDate >= "${dateRange.startDate}" AND worklogDate <= "${dateRange.endDate}" OR assignee = currentUser()) ORDER BY updated DESC`;
        res = await apiFetch(`/api/issues?jql=${encodeURIComponent(jql)}&maxResults=50`);
      } else {
        res = await apiFetch(`/api/my-issues?startDate=${dateRange.startDate}&endDate=${dateRange.endDate}`);
      }
      if (!res.ok) return issues; // fall back to parent-provided issues
      const data = await res.json();
      return (data.issues || []) as JiraIssue[];
    },
    enabled: dateRange.startDate !== '' && dateRange.endDate !== '',
    staleTime: 2 * 60 * 1000,
    placeholderData: issues,
  });

  const effectiveIssues = ownIssues ?? issues;
  const issueKeys = useMemo(() => effectiveIssues.map(i => i.key), [effectiveIssues]);

  const multiUserWorklogs = useMultiUserWorklogs({
    issueKeys,
    startDate: dateRange.startDate,
    endDate: dateRange.endDate,
    accountIds: Array.from(team.selectedAccountIds),
  });

  // Always use multiUserWorklogs — single source of truth for worklog data
  const effectiveWorklogs = multiUserWorklogs.worklogs;

  // Build selectedUsers array for per-user totals
  const selectedUsers = useMemo(() => {
    return team.teamMembers
      .filter(m => team.selectedAccountIds.has(m.accountId))
      .map(m => ({ accountId: m.accountId, displayName: m.displayName, color: m.color }));
  }, [team.teamMembers, team.selectedAccountIds]);

  const events = useCalendarEvents({
    worklogs: effectiveWorklogs,
    issues: effectiveIssues,
    visibleDays: nav.visibleDays,
    minutesToTop: grid.minutesToTop,
    minutesToPixels: grid.minutesToPixels,
    settings: grid.settings,
    multiUserMode,
  });

  // Register day column DOM elements for cross-day detection
  const registerDayRef = useCallback((day: Date, el: HTMLDivElement | null) => {
    const key = format(day, 'yyyy-MM-dd');
    if (el) {
      dayColumnRefs.current.set(key, el);
    } else {
      dayColumnRefs.current.delete(key);
    }
  }, []);

  // T013a: Handle drag end — update worklog with new start time (duration preserved)
  const handleDragEnd = useCallback(async (eventId: string, newStart: Date, newEnd: Date) => {
    const calEvent = events.calendarEvents.find(e => e.id === eventId);
    if (!calEvent) return;

    const timeSpentSeconds = Math.round((newEnd.getTime() - newStart.getTime()) / 1000);

    try {
      const res = await apiFetch('/api/worklogs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey: calEvent.issueKey,
          worklogId: calEvent.id,
          started: toJiraDatetime(newStart),
          timeSpentSeconds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      // Success: refetch data
      multiUserWorklogs.refetch();
    } catch (err) {
      showError(`Failed to move worklog: ${(err as Error).message}`);
    }
  }, [events.calendarEvents, showError, multiUserWorklogs]);

  // T013b: Handle resize end — update worklog with new start/duration
  const handleResizeEnd = useCallback(async (eventId: string, newStart: Date, newEnd: Date) => {
    const calEvent = events.calendarEvents.find(e => e.id === eventId);
    if (!calEvent) return;

    const timeSpentSeconds = Math.round((newEnd.getTime() - newStart.getTime()) / 1000);

    try {
      const res = await apiFetch('/api/worklogs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey: calEvent.issueKey,
          worklogId: calEvent.id,
          started: toJiraDatetime(newStart),
          timeSpentSeconds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      multiUserWorklogs.refetch();
    } catch (err) {
      showError(`Failed to resize worklog: ${(err as Error).message}`);
    }
  }, [events.calendarEvents, showError, multiUserWorklogs]);

  // T013c: Handle slot selection complete — open issue picker modal
  const handleSelectionComplete = useCallback(async (day: Date, startMinutes: number, endMinutes: number) => {
    const timeSpentSeconds = (endMinutes - startMinutes) * 60;
    const startDate = new Date(day);
    startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

    // Clear selection visual immediately
    slotSelection.clearSelection();

    // Open issue picker modal with the selection data
    setIssuePickerState({
      isOpen: true,
      startDate,
      timeSpentSeconds,
    });
  }, []);

  // Handle issue selected from picker — POST worklog + refresh
  const handleIssueSelected = useCallback(async (issueKey: string) => {
    const { startDate, timeSpentSeconds } = issuePickerState;
    if (!startDate) return;

    // Close modal immediately for responsiveness
    setIssuePickerState({ isOpen: false, startDate: null, timeSpentSeconds: 0 });

    try {
      const res = await apiFetch('/api/worklogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey,
          started: toJiraDatetime(startDate),
          timeSpentSeconds,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed (${res.status})`);
      }
      addRecentIssue(issueKey);
      multiUserWorklogs.refetch();
    } catch (err) {
      showError(`Failed to create worklog: ${(err as Error).message}`);
    }
  }, [issuePickerState, addRecentIssue, showError, multiUserWorklogs]);

  // Event click handler — open edit modal
  const handleEventClick = useCallback((eventId: string) => {
    const calEvent = events.calendarEvents.find(e => e.id === eventId);
    if (calEvent) {
      setEditingEvent(calEvent);
    }
  }, [events.calendarEvents]);

  // T012: Initialize interaction hooks
  const drag = useEventDrag({
    dayColumnRefs: dayColumnRefs,
    visibleDays: nav.visibleDays,
    settings: grid.settings,
    pixelsToMinutes: grid.pixelsToMinutes,
    snapToNearestGrid: grid.snapToNearestGrid,
    minutesToTop: grid.minutesToTop,
    minutesToPixels: grid.minutesToPixels,
    setOptimisticOverride: events.setOptimisticOverride,
    clearOptimisticOverride: events.clearOptimisticOverride,
    onDragEnd: handleDragEnd,
    onClick: handleEventClick,
  });

  const resize = useEventResize({
    settings: grid.settings,
    pixelsToMinutes: grid.pixelsToMinutes,
    snapStartToGrid: grid.snapStartToGrid,
    snapEndToGrid: grid.snapEndToGrid,
    minutesToTop: grid.minutesToTop,
    minutesToPixels: grid.minutesToPixels,
    setOptimisticOverride: events.setOptimisticOverride,
    clearOptimisticOverride: events.clearOptimisticOverride,
    onResizeEnd: handleResizeEnd,
  });

  const slotSelection = useSlotSelection({
    dayColumnRefs: dayColumnRefs,
    visibleDays: nav.visibleDays,
    settings: grid.settings,
    pixelsToMinutes: grid.pixelsToMinutes,
    snapStartToGrid: grid.snapStartToGrid,
    snapEndToGrid: grid.snapEndToGrid,
    minutesToTop: grid.minutesToTop,
    minutesToPixels: grid.minutesToPixels,
    onSelectionComplete: handleSelectionComplete,
  });

  // T016: Context menu hook
  const contextMenu = useContextMenu();

  // T019: Keyboard shortcuts
  useCalendarKeyboard({
    clearSelection: slotSelection.clearSelection,
    closeMenu: contextMenu.closeMenu,
    goToToday: nav.goToToday,
    prevWeek: nav.goToPrev,
    nextWeek: nav.goToNext,
    openNewWorklog: useCallback(() => {
      // Open issue picker for today at 9 AM with a 1-hour default
      const today = new Date();
      today.setHours(9, 0, 0, 0);
      setIssuePickerState({ isOpen: true, startDate: today, timeSpentSeconds: 3600 });
    }, []),
    editSelected: useCallback(() => {
      if (contextMenu.menuState.targetEvent) {
        setEditingEvent(contextMenu.menuState.targetEvent.calendarEvent);
        contextMenu.closeMenu();
      }
    }, [contextMenu]),
    deleteSelected: useCallback(async () => {
      const dayEvent = contextMenu.menuState.targetEvent;
      if (!dayEvent) return;
      const calEvent = dayEvent.calendarEvent;
      try {
        const res = await fetch(
          `/api/worklogs?issueKey=${encodeURIComponent(calEvent.issueKey)}&worklogId=${encodeURIComponent(calEvent.id)}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed (${res.status})`);
        }
        multiUserWorklogs.refetch();
      } catch (err) {
        showError(`Failed to delete worklog: ${(err as Error).message}`);
      }
      contextMenu.closeMenu();
    }, [contextMenu, multiUserWorklogs, showError]),
  });

  // T017: Issue drag-to-assign hook
  const issueDragDrop = useIssueDragDrop({
    dayColumnRefs,
    visibleDays: nav.visibleDays,
    settings: grid.settings,
    pixelsToMinutes: grid.pixelsToMinutes,
    snapStartToGrid: grid.snapStartToGrid,
    minutesToTop: grid.minutesToTop,
    minutesToPixels: grid.minutesToPixels,
    defaultDurationMinutes: 60,
    onDrop: async (issueKey, issueSummary, day, startMinutes, durationMinutes) => {
      const startDate = new Date(day);
      startDate.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
      const timeSpentSeconds = durationMinutes * 60;

      try {
        const res = await apiFetch('/api/worklogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issueKey,
            started: toJiraDatetime(startDate),
            timeSpentSeconds,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed (${res.status})`);
        }
        addRecentIssue(issueKey);
        multiUserWorklogs.refetch();
      } catch (err) {
        showError(`Failed to log time: ${(err as Error).message}`);
      }
    },
  });

  // T020: Now indicator position — auto-updates every 60 seconds
  const computeNowTop = useCallback(() => {
    const now = new Date();
    const minutesSinceMidnight = differenceInMinutes(now, startOfDay(now));
    const startMin = grid.settings.startHour * 60;
    const endMin = grid.settings.endHour * 60;
    if (minutesSinceMidnight < startMin || minutesSinceMidnight > endMin) return null;
    return grid.minutesToTop(minutesSinceMidnight);
  }, [grid]);

  const [nowIndicatorTop, setNowIndicatorTop] = useState<number | null>(computeNowTop);

  useEffect(() => {
    setNowIndicatorTop(computeNowTop());
    const interval = setInterval(() => {
      setNowIndicatorTop(computeNowTop());
    }, 60000);
    return () => clearInterval(interval);
  }, [computeNowTop]);

  // Scroll to current time on mount
  const hasScrolledRef = useRef(false);
  useEffect(() => {
    if (!hasScrolledRef.current && scrollContainerRef.current && nowIndicatorTop != null) {
      const scrollTarget = Math.max(0, nowIndicatorTop - 100); // 100px above now
      scrollContainerRef.current.scrollTop = scrollTarget;
      hasScrolledRef.current = true;
    }
  }, [nowIndicatorTop]);

  // T021: Compute daily totals from worklogs
  const dayTotals = React.useMemo(() => {
    const totals = new Map<string, number>();
    for (const day of nav.visibleDays) {
      const dateKey = format(day, 'yyyy-MM-dd');
      totals.set(dateKey, 0);
    }
    for (const wl of effectiveWorklogs) {
      const wlDay = format(parseISO(wl.started), 'yyyy-MM-dd');
      const current = totals.get(wlDay);
      if (current !== undefined) {
        totals.set(wlDay, current + wl.timeSpentSeconds);
      }
    }
    return totals;
  }, [effectiveWorklogs, nav.visibleDays]);

  // T011: Compute per-user daily totals
  const userDayTotals = useMemo(() => {
    const totals = new Map<string, Map<string, number>>();
    for (const wl of effectiveWorklogs) {
      const accountId = wl.author.accountId;
      if (!totals.has(accountId)) {
        totals.set(accountId, new Map<string, number>());
      }
      const userMap = totals.get(accountId)!;
      const wlDay = format(parseISO(wl.started), 'yyyy-MM-dd');
      userMap.set(wlDay, (userMap.get(wlDay) || 0) + wl.timeSpentSeconds);
    }
    return totals;
  }, [effectiveWorklogs]);

  return (
    <div className="flex flex-col h-full rounded-lg overflow-hidden" style={{
      backgroundColor: token('elevation.surface'),
      border: `1px solid ${token('color.border')}`,
    }}>
      {/* T014: Error toast */}
      {errorMessage && (
        <div className="px-4 py-2 flex items-center justify-between" style={{
          backgroundColor: token('color.background.danger'),
          borderBottom: `1px solid ${token('color.border.danger')}`,
        }}>
          <span className="text-sm" style={{ color: token('color.text.danger') }}>{errorMessage}</span>
          <Button appearance="subtle" spacing="compact" onClick={() => setErrorMessage(null)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Loading indicator for worklog fetching */}
      {(multiUserWorklogs.isFetching || isLoadingIssues) && (
        <div className="h-0.5 overflow-hidden" style={{ backgroundColor: token('color.background.neutral') }}>
          <div
            className="h-full animate-pulse"
            style={{
              width: multiUserWorklogs.isFetching && !isLoadingIssues ? '100%' : '60%',
              backgroundColor: token('color.background.brand.bold'),
              transition: 'width 0.5s ease',
            }}
          />
        </div>
      )}

      {/* T015: Extracted toolbar */}
      <div className="relative">
        <CalendarToolbar
          rangeLabel={nav.rangeLabel}
          viewMode={nav.viewMode}
          onPrev={nav.goToPrev}
          onNext={nav.goToNext}
          onToday={nav.goToToday}
          onViewModeChange={nav.setViewMode}
          onSettingsClick={() => setShowSettings(s => !s)}
          userSelector={
            <UserSelector
              teamMembers={team.teamMembers}
              selectedAccountIds={team.selectedAccountIds}
              isLoading={team.isLoading}
              onToggleUser={team.toggleUser}
              onSelectAll={team.selectAll}
              onDeselectAll={team.deselectAll}
            />
          }
        />

        {/* T017: Settings popover */}
        {showSettings && (
          <CalendarSettingsPopover
            settings={settings}
            onSettingsChange={setSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
      </div>

      {/* T021: Daily totals row */}
      <div className="flex" style={{ borderBottom: `2px solid ${token('color.border')}`, backgroundColor: token('color.background.neutral.subtle') }}>
        <div className="flex-shrink-0" style={{ width: TIME_AXIS_WIDTH, borderRight: `1px solid ${token('color.border')}` }}>
          <div className="px-1 py-1.5 text-[11px] font-semibold text-right uppercase tracking-wide" style={{ color: token('color.text.subtlest') }}>Total</div>
        </div>
        <div
          className="flex-1 grid"
          style={{ gridTemplateColumns: `repeat(${nav.visibleDays.length}, minmax(0, 1fr))` }}
        >
          {nav.visibleDays.map((day) => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const totalSeconds = dayTotals.get(dateKey) ?? 0;
            const totalHours = Math.round((totalSeconds / 3600) * 10) / 10;
            return (
              <div
                key={dateKey}
                className="text-center py-1.5 text-xs font-semibold tabular-nums first:border-l-0"
                style={{ color: totalHours > 0 ? token('color.text') : token('color.text.disabled'), borderLeft: `1px solid ${token('color.border')}` }}
              >
                {totalHours}h
              </div>
            );
          })}
        </div>
      </div>

      {/* T011: Per-user daily totals breakdown */}
      {multiUserMode && selectedUsers.length >= 2 && (
        <div className="border-b" style={{ borderColor: token('color.border'), backgroundColor: token('color.background.neutral.subtle') }}>
          {selectedUsers.map((user) => {
            const userTotals = userDayTotals.get(user.accountId);
            const firstName = user.displayName.split(/\s+/)[0];
            return (
              <div key={user.accountId} className="flex">
                <div className="flex-shrink-0 pl-3 pr-1 py-0.5 flex items-center gap-1" style={{ width: TIME_AXIS_WIDTH, borderRight: `1px solid ${token('color.border')}` }}>
                  <span
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: user.color }}
                  />
                  <span className="text-[10px] truncate" style={{ color: token('color.text.subtlest') }}>{firstName}</span>
                </div>
                <div
                  className="flex-1 grid"
                  style={{ gridTemplateColumns: `repeat(${nav.visibleDays.length}, minmax(0, 1fr))` }}
                >
                  {nav.visibleDays.map((day) => {
                    const dateKey = format(day, 'yyyy-MM-dd');
                    const seconds = userTotals?.get(dateKey) ?? 0;
                    const hours = Math.round((seconds / 3600) * 10) / 10;
                    return (
                      <div
                        key={dateKey}
                        className="text-center py-0.5 text-[10px] first:border-l-0"
                        style={{ color: token('color.text.disabled'), borderLeft: `1px solid ${token('color.border')}` }}
                      >
                        {hours > 0 ? `${hours}h` : ''}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* T017: Calendar grid + Issue sidebar layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Scrollable calendar grid */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-auto calendar-scroll"
          onDragEnter={issueDragDrop.handleDragEnter}
          onDragOver={issueDragDrop.handleDragOver}
          onDragLeave={issueDragDrop.handleDragLeave}
          onDrop={issueDragDrop.handleDrop}
        >
          <div className="flex relative" style={{ minHeight: grid.totalHeight + 60 }}>
            {/* Loading overlay while worklogs are being fetched */}
            {(multiUserWorklogs.isLoading && multiUserWorklogs.worklogs.length === 0) && (
              <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
                style={{ backgroundColor: 'rgba(255,255,255,0.6)' }}>
                <div className="flex flex-col items-center gap-3 pointer-events-auto">
                  <svg className="animate-spin h-8 w-8" style={{ color: token('color.background.brand.bold') }} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span className="text-sm font-medium" style={{ color: token('color.text.subtle') }}>Loading worklogs...</span>
                </div>
              </div>
            )}

            {/* Time axis (left column) */}
            <div
              className="sticky left-0 z-10 flex-shrink-0"
              style={{
                width: TIME_AXIS_WIDTH,
                backgroundColor: token('elevation.surface'),
                borderRight: `1px solid ${token('color.border')}`,
              }}
            >
              {/* Empty header spacer */}
              <div className="sticky top-0 z-[2] py-2" style={{
                backgroundColor: token('elevation.surface'),
                borderBottom: `1px solid ${token('color.border')}`,
              }}>
                <div style={{ height: '2.875rem' }} /> {/* Match day header height: day name + date circle */}
              </div>
              {/* Hour labels */}
              <div className="relative" style={{ height: grid.totalHeight }}>
                {grid.slots
                  .filter((slot) => slot.isHourMark)
                  .map((slot) => (
                    <div
                      key={slot.time}
                      className="absolute right-2 text-[11px] font-medium -translate-y-1/2 tabular-nums"
                      style={{ top: slot.top, color: token('color.text.subtlest') }}
                    >
                      {slot.time}
                    </div>
                  ))}
              </div>
            </div>

            {/* Day columns (CSS Grid) */}
            <div
              className="flex-1 grid relative"
              style={{
                gridTemplateColumns: `repeat(${nav.visibleDays.length}, minmax(0, 1fr))`,
              }}
            >
              {nav.visibleDays.map((day) => {
                const dateKey = format(day, 'yyyy-MM-dd');
                const dayEvents = events.dayEventsMap.get(dateKey) ?? [];

                // T012: Compute selection pixels for this day column
                const selectionPixelsForDay = (slotSelection.selectionPixels &&
                  format(slotSelection.selectionPixels.day, 'yyyy-MM-dd') === dateKey)
                  ? { startTop: slotSelection.selectionPixels.startTop, height: slotSelection.selectionPixels.height }
                  : null;

                return (
                  <CalendarDayColumn
                    key={dateKey}
                    day={day}
                    events={dayEvents}
                    slots={grid.slots}
                    totalHeight={grid.totalHeight}
                    onEventPointerDown={drag.handleEventPointerDown}
                    onResizeStart={resize.handleResizeStart}
                    onSlotPointerDown={slotSelection.handleSlotPointerDown}
                    onContextMenu={contextMenu.handleContextMenu}  // T022: Context menu
                    nowIndicatorTop={isToday(day) ? nowIndicatorTop : null}
                    registerRef={registerDayRef}
                    selection={selectionPixelsForDay}
                    dragEventId={drag.dragEventId}
                    resizeEventId={resize.resizeEventId}
                    multiUserMode={multiUserMode}
                  />
                );
              })}

              {/* T016: Drop zone overlay — positioned within the correct day column */}
              {issueDragDrop.isDraggingOver && issueDragDrop.dropTarget && (() => {
                const dayIndex = nav.visibleDays.findIndex(
                  d => format(d, 'yyyy-MM-dd') === format(issueDragDrop.dropTarget!.day, 'yyyy-MM-dd')
                );
                const totalDays = nav.visibleDays.length;
                if (dayIndex < 0) return null;
                return (
                  <div
                    className="absolute pointer-events-none"
                    style={{
                      top: 0,
                      bottom: 0,
                      left: `${(dayIndex / totalDays) * 100}%`,
                      width: `${(1 / totalDays) * 100}%`,
                    }}
                  >
                    {/* Spacer for sticky day header */}
                    <div className="sticky top-0 z-20 py-2"><div className="h-7" /></div>
                    <div className="relative" style={{ height: grid.totalHeight }}>
                      <DropZoneOverlay dropTarget={issueDragDrop.dropTarget} />
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>

        {/* T014: Issue sidebar */}
        <IssueSidebar
          issues={effectiveIssues}
          recentIssueKeys={recentIssueKeys}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed(c => !c)}
          onApplyTemplate={useCallback(async (template: WorklogTemplate) => {
            const today = new Date();
            today.setHours(9, 0, 0, 0);
            const timeSpentSeconds = Math.round(template.defaultHours * 3600);
            try {
              const res = await apiFetch('/api/worklogs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  issueKey: template.issueKey,
                  started: toJiraDatetime(today),
                  timeSpentSeconds,
                }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed (${res.status})`);
              }
              addRecentIssue(template.issueKey);
              multiUserWorklogs.refetch();
            } catch (err) {
              showError(`Failed to log time from template: ${(err as Error).message}`);
            }
          }, [addRecentIssue, multiUserWorklogs, showError])}
        />
      </div>

      {/* T022: Context menu */}
      <CalendarContextMenu
        isOpen={contextMenu.menuState.isOpen}
        position={contextMenu.menuState.position}
        onEdit={() => {
          contextMenu.handleEdit((dayEvent) => {
            setEditingEvent(dayEvent.calendarEvent);
          });
        }}
        onDuplicate={() => {
          contextMenu.handleDuplicate(async (dayEvent) => {
            const calEvent = dayEvent.calendarEvent;
            const durationSeconds = Math.round(
              (calEvent.end.getTime() - calEvent.start.getTime()) / 1000
            );
            // Create duplicate at the next slot after the original
            const newStart = new Date(calEvent.end);
            try {
              const res = await apiFetch('/api/worklogs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  issueKey: calEvent.issueKey,
                  started: toJiraDatetime(newStart),
                  timeSpentSeconds: durationSeconds,
                }),
              });
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed (${res.status})`);
              }
              multiUserWorklogs.refetch();
            } catch (err) {
              showError(`Failed to duplicate worklog: ${(err as Error).message}`);
            }
          });
        }}
        onDelete={() => {
          contextMenu.handleDelete(async (dayEvent) => {
            contextMenu.closeMenu();
            const calEvent = dayEvent.calendarEvent;
            try {
              const res = await apiFetch(
                `/api/worklogs?issueKey=${encodeURIComponent(calEvent.issueKey)}&worklogId=${encodeURIComponent(calEvent.id)}`,
                { method: 'DELETE' }
              );
              if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || `Failed (${res.status})`);
              }
              multiUserWorklogs.refetch();
            } catch (err) {
              showError(`Failed to delete worklog: ${(err as Error).message}`);
            }
          });
        }}
        onClose={contextMenu.closeMenu}
      />

      {/* Edit worklog modal */}
      <EditWorklogModal
        isOpen={editingEvent !== null}
        calendarEvent={editingEvent}
        onClose={() => setEditingEvent(null)}
        onSaved={() => {
          setEditingEvent(null);
          multiUserWorklogs.refetch();
        }}
      />

      {/* Issue picker modal for slot selection */}
      <IssuePickerModal
        issues={effectiveIssues}
        isOpen={issuePickerState.isOpen}
        onClose={() => setIssuePickerState({ isOpen: false, startDate: null, timeSpentSeconds: 0 })}
        onSelect={handleIssueSelected}
        recentIssueKeys={recentIssueKeys}
        duration={issuePickerState.timeSpentSeconds}
        startTime={issuePickerState.startDate}
      />
    </div>
  );
}
