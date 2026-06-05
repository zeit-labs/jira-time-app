'use client';

import React, { useEffect, useState } from 'react';
import { token } from '@atlaskit/tokens';
import CalendarIcon from '@atlaskit/icon/core/calendar';
import GridIcon from '@atlaskit/icon/core/grid';
import ChartBarIcon from '@atlaskit/icon/core/chart-bar';
import PeopleGroupIcon from '@atlaskit/icon/core/people-group';
import PersonAvatarIcon from '@atlaskit/icon/core/person-avatar';
import type { JiraProject } from '@/src/types/jira';
import ProjectSelector from './ProjectSelector';
import { useAuth } from '@/hooks/useAuth';

type ViewMode = 'grid' | 'calendar' | 'report' | 'dashboard';

interface NavItem {
  id: ViewMode;
  label: string;
  icon: React.ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'grid',
    label: 'Weekly Grid',
    icon: <GridIcon label="" color="currentColor" />,
  },
  {
    id: 'calendar',
    label: 'Calendar',
    icon: <CalendarIcon label="" color="currentColor" />,
  },
  {
    id: 'report',
    label: 'My Report',
    icon: <ChartBarIcon label="" color="currentColor" />,
  },
  {
    id: 'dashboard',
    label: 'Team Dashboard',
    icon: <PeopleGroupIcon label="" color="currentColor" />,
  },
];

interface AppHeaderProps {
  activeView: ViewMode;
  onViewChange: (view: ViewMode) => void;
  projects: JiraProject[];
  selectedProject: JiraProject | null;
  onSelectProject: (project: JiraProject | null) => void;
  isLoadingProjects: boolean;
  showProjectSelector: boolean;
}

export default function AppHeader({
  activeView,
  onViewChange,
  projects,
  selectedProject,
  onSelectProject,
  isLoadingProjects,
  showProjectSelector,
}: AppHeaderProps) {
  const [scrolled, setScrolled] = useState(false);
  const { user } = useAuth();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 4);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const currentUser = user ? { displayName: user.displayName, avatarUrls: user.avatarUrls } : null;

  return (
    <header
      className="sticky top-0 z-50 w-full"
      style={{
        backgroundColor: token('elevation.surface'),
        borderBottom: `1px solid ${token('color.border')}`,
        opacity: scrolled ? 1 : undefined,
        boxShadow: scrolled ? `0 2px 8px ${token('color.background.neutral')}` : undefined,
        transition: 'box-shadow 0.15s ease, border-color 0.15s ease',
      }}
    >
      <div className="flex items-center h-14 px-5 gap-4 max-w-[1600px] mx-auto">

        {/* ── Brand ────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 flex-shrink-0 select-none">
          <div
            className="w-7 h-7 rounded-md flex items-center justify-center"
            style={{ backgroundColor: token('color.background.brand.bold') }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" stroke="white" strokeWidth="1.5"/>
              <path d="M8 4.5V8.5L10.5 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span
            className="text-[15px] font-bold tracking-tight hidden sm:block"
            style={{ color: token('color.text') }}
          >
            Jira Time Logger
          </span>
        </div>

        {/* ── Nav tabs ─────────────────────────────────────── */}
        <nav className="flex items-center gap-0.5 flex-1 justify-center" role="tablist" aria-label="Views">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => onViewChange(item.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors duration-100 outline-none focus-visible:ring-2"
                style={{
                  color: isActive ? token('color.text.selected') : token('color.text.subtle'),
                  backgroundColor: isActive ? token('color.background.selected') : 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  ['--tw-ring-color' as string]: token('color.border.focused'),
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                      token('color.background.neutral.subtle.hovered');
                    (e.currentTarget as HTMLButtonElement).style.color = token('color.text');
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = token('color.text.subtle');
                  }
                }}
              >
                <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                  {item.icon}
                </span>
                <span className="hidden md:block whitespace-nowrap">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Right controls ───────────────────────────────── */}
        <div className="flex items-center gap-3 flex-shrink-0">
          {showProjectSelector && (
            <div className="hidden sm:block">
              <ProjectSelector
                projects={projects}
                selectedProject={selectedProject}
                onSelect={onSelectProject}
                isLoading={isLoadingProjects}
              />
            </div>
          )}

          {/* User avatar */}
          <UserAvatar user={currentUser ?? null} />

          {/* Logout */}
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
/* ── User avatar chip ───────────────────────────────── */
interface UserAvatarProps {
  user: { displayName: string; avatarUrls?: Record<string, string> } | null;
}

function UserAvatar({ user }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false);

  if (!user || !user.displayName) {
    return (
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center"
        style={{ backgroundColor: token('color.background.neutral') }}
        title="Not signed in"
      >
        <PersonAvatarIcon label="User" color={token('color.icon.subtle')} />
      </div>
    );
  }

  const avatarUrl = user.avatarUrls?.['24x24'] ?? user.avatarUrls?.['32x32'];
  const displayName = user.displayName ?? '';
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  return (
    <div
      className="flex items-center gap-2 pl-2 pr-3 py-1 rounded-full cursor-default select-none"
      style={{
        backgroundColor: token('color.background.neutral'),
        border: `1px solid ${token('color.border')}`,
      }}
      title={user.displayName ?? 'Unknown user'}
    >
      {avatarUrl && !imgError ? (
        <img
          src={avatarUrl}
          alt={displayName}
          width={22}
          height={22}
          className="rounded-full"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold"
          style={{
            backgroundColor: token('color.background.brand.bold'),
            color: 'white',
          }}
        >
          {initials || '?'}
        </div>
      )}
      <span className="text-xs font-medium hidden lg:block max-w-[120px] truncate" style={{ color: token('color.text') }}>
        {displayName.split(/\s+/)[0] || 'User'}
      </span>
    </div>
  );
}

/* ── Logout button ───────────────────────────────── */
function LogoutButton() {
  const { logout } = useAuth();

  return (
    <button
      onClick={logout}
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors duration-100 outline-none focus-visible:ring-2"
      style={{
        color: token('color.text.subtle'),
        backgroundColor: 'transparent',
        border: `1px solid ${token('color.border')}`,
        cursor: 'pointer',
        ['--tw-ring-color' as string]: token('color.border.focused'),
      }}
      title="Log out"
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = token('color.background.danger');
        (e.currentTarget as HTMLButtonElement).style.color = token('color.text.danger');
        (e.currentTarget as HTMLButtonElement).style.borderColor = token('color.border.danger');
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
        (e.currentTarget as HTMLButtonElement).style.color = token('color.text.subtle');
        (e.currentTarget as HTMLButtonElement).style.borderColor = token('color.border');
      }}
    >
      Log out
    </button>
  );
}
