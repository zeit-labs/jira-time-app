'use client';

import { useState, useCallback } from 'react';
import { token } from '@atlaskit/tokens';
import AppHeader from '@/components/AppHeader';
import WeeklyGrid from '@/components/WeeklyGrid';
import CalendarView from '@/components/calendar/CalendarView';
import MonthlyReportView from '@/components/MonthlyReportView';
import TeamDashboard from '@/components/TeamDashboard';
import LoginPage from '@/components/LoginPage';
import { useProjects } from '@/hooks/useProjects';
import { useAuth } from '@/hooks/useAuth';

type ViewMode = 'grid' | 'calendar' | 'report' | 'dashboard';

export default function Home() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: token('elevation.surface.sunken') }}>
        <div className="flex items-center gap-3" style={{ color: token('color.text.subtle') }}>
          <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">Loading...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <AppShell />;
}

function AppShell() {
  const [activeView, setActiveView] = useState<ViewMode>('grid');
  const { projects, selectedProject, setSelectedProject, isLoading: isLoadingProjects } = useProjects();

  const handleViewChange = useCallback((view: ViewMode) => {
    setActiveView(view);
  }, []);

  const showProjectSelector =
    activeView === 'grid' || activeView === 'calendar' || activeView === 'dashboard';

  return (
    <div className="flex flex-col min-h-screen" style={{ backgroundColor: token('elevation.surface.sunken') }}>
      <AppHeader
        activeView={activeView}
        onViewChange={handleViewChange}
        projects={projects}
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        isLoadingProjects={isLoadingProjects}
        showProjectSelector={showProjectSelector}
      />

      <main className="flex-1 px-5 py-6 max-w-[1600px] mx-auto w-full">
        {activeView === 'grid' && (
          <WeeklyGrid projectKey={selectedProject?.key} />
        )}

        {activeView === 'calendar' && (
          <div style={{ height: 'calc(100vh - 5rem)' }}>
            <CalendarView issues={[]} projectKey={selectedProject?.key} />
          </div>
        )}

        {activeView === 'report' && (
          <MonthlyReportView />
        )}

        {activeView === 'dashboard' && (
          <TeamDashboard />
        )}
      </main>
    </div>
  );
}
