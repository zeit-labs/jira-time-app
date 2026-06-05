'use client';

import React from 'react';
import { token } from '@atlaskit/tokens';
import { format } from 'date-fns';
import type { DayEvent } from '@/types/calendar';
import { adfToText } from '@/lib/adf-helpers';

interface CalendarEventBlockProps {
  dayEvent: DayEvent;
  onPointerDown?: (e: React.PointerEvent, dayEvent: DayEvent) => void;
  onResizeStart?: (e: React.PointerEvent, dayEvent: DayEvent, edge: 'top' | 'bottom') => void;
  onContextMenu?: (e: React.MouseEvent, dayEvent: DayEvent) => void;
  isDragging?: boolean;
  isResizing?: boolean;
  multiUserMode?: boolean;
}

/** Extract 2-letter initials from a display name (e.g., "Muhammad Kurkar" → "MK", "AJ" → "AJ") */
function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

export default function CalendarEventBlock({
  dayEvent,
  onPointerDown,
  onResizeStart,
  onContextMenu,
  isDragging = false,
  isResizing = false,
  multiUserMode = false,
}: CalendarEventBlockProps) {
  const { calendarEvent, height, isClippedStart, isClippedEnd } = dayEvent;
  const isCompact = height < 40; // Less than ~1.5 slots
  const showAuthorBadge = multiUserMode && calendarEvent.authorDisplayName;
  const initials = showAuthorBadge ? getInitials(calendarEvent.authorDisplayName!) : '';

  const handlePointerDown = (e: React.PointerEvent) => {
    // Don't start drag from resize handles
    if ((e.target as HTMLElement).dataset.resize) return;
    onPointerDown?.(e, dayEvent);
  };

  const handleResizeTop = (e: React.PointerEvent) => {
    e.stopPropagation();
    onResizeStart?.(e, dayEvent, 'top');
  };

  const handleResizeBottom = (e: React.PointerEvent) => {
    e.stopPropagation();
    onResizeStart?.(e, dayEvent, 'bottom');
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu?.(e, dayEvent);
  };

  const timeLabel = `${format(calendarEvent.start, 'HH:mm')} – ${format(calendarEvent.end, 'HH:mm')}`;
  const worklogComment = calendarEvent.worklog?.comment
    ? adfToText(calendarEvent.worklog.comment)
    : '';

  return (
    <div
      data-event={calendarEvent.id}
      className={`
        absolute select-none overflow-hidden
        calendar-event
        ${isDragging ? 'calendar-event--dragging opacity-90 z-50 cursor-grabbing' : 'cursor-grab'}
        ${isResizing ? 'opacity-90 z-50' : ''}
        ${isClippedStart ? 'rounded-t-none' : 'rounded-t-md'}
        ${isClippedEnd ? 'rounded-b-none' : 'rounded-b-md'}
      `}
      style={{
        top: dayEvent.top,
        height: dayEvent.height,
        left: dayEvent.left,
        width: dayEvent.width,
        backgroundColor: calendarEvent.color,
        minHeight: 20,
        boxShadow: isDragging
          ? token('elevation.shadow.overlay')
          : `inset 0 0 0 1px rgba(255,255,255,0.15), ${token('elevation.shadow.raised')}`,
        borderLeft: `3px solid color-mix(in srgb, ${calendarEvent.color} 60%, black)`,
      }}
      onPointerDown={handlePointerDown}
      onContextMenu={handleContextMenu}
    >
      {/* Top resize handle */}
      {!isClippedStart && (
        <div
          data-resize="top"
          className="absolute top-0 left-0 right-0 h-2 cursor-n-resize z-10"
          style={{ background: 'linear-gradient(to bottom, rgba(255,255,255,0.2), transparent)' }}
          onPointerDown={handleResizeTop}
        />
      )}

      {/* Event content */}
      <div
        className={`px-1.5 text-xs leading-tight ${isCompact ? 'py-0.5' : 'py-1'}`}
        style={{ color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
      >
        {isCompact ? (
          <div className="flex items-center gap-1 truncate">
            <span className="font-bold">{calendarEvent.issueKey}</span>
            {showAuthorBadge && (
              <span
                className="w-4 h-4 rounded-full text-[8px] font-bold flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: calendarEvent.authorColor || '#6b7280',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                }}
              >
                {initials}
              </span>
            )}
            <span className="truncate opacity-80">{calendarEvent.issueSummary}</span>
          </div>
        ) : (
          <>
            <div className="font-bold truncate">{calendarEvent.issueKey}</div>
            <div className="opacity-80 truncate text-[11px]">{timeLabel}</div>
            {height >= 60 && (
              <div className="opacity-70 truncate mt-0.5 text-[11px]">{calendarEvent.issueSummary}</div>
            )}
            {worklogComment && height >= 80 && (
              <div
                className="opacity-60 mt-1 text-[11px]"
                style={{ wordBreak: 'break-word', overflowWrap: 'break-word', whiteSpace: 'normal', lineHeight: 1.4 }}
              >
                {worklogComment}
              </div>
            )}
          </>
        )}
      </div>

      {/* Author initials badge (non-compact, top-right) */}
      {showAuthorBadge && !isCompact && (
        <div
          className="absolute top-1 right-1 w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center text-white"
          style={{
            backgroundColor: calendarEvent.authorColor || '#6b7280',
            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
          }}
        >
          {initials}
        </div>
      )}

      {/* Bottom resize handle */}
      {!isClippedEnd && (
        <div
          data-resize="bottom"
          className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize z-10"
          style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.15), transparent)' }}
          onPointerDown={handleResizeBottom}
        />
      )}
    </div>
  );
}
