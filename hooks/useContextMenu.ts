'use client';

import { useState, useCallback, useEffect } from 'react';
import type { DayEvent } from '@/types/calendar';

interface ContextMenuState {
  isOpen: boolean;
  position: { x: number; y: number };
  targetEvent: DayEvent | null;
}

interface UseContextMenuReturn {
  menuState: ContextMenuState;
  handleContextMenu: (e: React.MouseEvent, dayEvent: DayEvent) => void;
  closeMenu: () => void;
  handleEdit: (callback: (event: DayEvent) => void) => void;
  handleDuplicate: (callback: (event: DayEvent) => void) => void;
  handleDelete: (callback: (event: DayEvent) => void) => void;
}

const INITIAL_STATE: ContextMenuState = {
  isOpen: false,
  position: { x: 0, y: 0 },
  targetEvent: null,
};

export function useContextMenu(): UseContextMenuReturn {
  const [menuState, setMenuState] = useState<ContextMenuState>(INITIAL_STATE);

  const closeMenu = useCallback(() => {
    setMenuState(INITIAL_STATE);
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, dayEvent: DayEvent) => {
      e.preventDefault();
      setMenuState({
        isOpen: true,
        position: { x: e.clientX, y: e.clientY },
        targetEvent: dayEvent,
      });
    },
    [],
  );

  const handleEdit = useCallback(
    (callback: (event: DayEvent) => void) => {
      if (menuState.targetEvent) {
        callback(menuState.targetEvent);
        closeMenu();
      }
    },
    [menuState.targetEvent, closeMenu],
  );

  const handleDuplicate = useCallback(
    (callback: (event: DayEvent) => void) => {
      if (menuState.targetEvent) {
        callback(menuState.targetEvent);
        closeMenu();
      }
    },
    [menuState.targetEvent, closeMenu],
  );

  const handleDelete = useCallback(
    (callback: (event: DayEvent) => void) => {
      if (menuState.targetEvent) {
        closeMenu();
        callback(menuState.targetEvent);
      }
    },
    [menuState.targetEvent, closeMenu],
  );

  // Close on document click or Escape key
  useEffect(() => {
    if (!menuState.isOpen) return;

    const handleClick = (e: MouseEvent) => {
      // Don't close if clicking inside the context menu itself
      const target = e.target as HTMLElement;
      if (target.closest('[data-context-menu]')) return;
      closeMenu();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMenu();
    };

    // Delay adding the listener so the opening right-click doesn't immediately close it
    const timeoutId = setTimeout(() => {
      document.addEventListener('click', handleClick);
    }, 0);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('click', handleClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuState.isOpen, closeMenu]);

  // Close on any parent scroll
  useEffect(() => {
    if (!menuState.isOpen) return;

    const handleScroll = () => closeMenu();

    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [menuState.isOpen, closeMenu]);

  return {
    menuState,
    handleContextMenu,
    closeMenu,
    handleEdit,
    handleDuplicate,
    handleDelete,
  };
}
