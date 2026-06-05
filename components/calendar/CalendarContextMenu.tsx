'use client';

import React from 'react';
import { token } from '@atlaskit/tokens';
import EditIcon from '@atlaskit/icon/core/edit';
import CopyIcon from '@atlaskit/icon/core/copy';
import DeleteIcon from '@atlaskit/icon/core/delete';

interface CalendarContextMenuProps {
  isOpen: boolean;
  position: { x: number; y: number };
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export default React.memo(function CalendarContextMenu({
  isOpen,
  position,
  onEdit,
  onDuplicate,
  onDelete,
  onClose,
}: CalendarContextMenuProps) {
  if (!isOpen) return null;

  const menuItemStyle: React.CSSProperties = {
    color: token('color.text'),
  };

  const handleHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = token('color.background.neutral.subtle.hovered');
  };
  const handleLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'transparent';
  };

  const menuWidth = 160;
  const menuHeight = 120;
  const clampedX = Math.min(position.x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(position.y, window.innerHeight - menuHeight - 8);

  return (
    <div
      data-context-menu
      className="fixed z-50 rounded-md py-1 min-w-[160px]"
      style={{
        left: Math.max(0, clampedX),
        top: Math.max(0, clampedY),
        backgroundColor: token('elevation.surface.overlay'),
        border: `1px solid ${token('color.border')}`,
        boxShadow: token('elevation.shadow.overlay'),
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        onClick={() => { onEdit(); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2"
        style={menuItemStyle}
        onMouseEnter={handleHover}
        onMouseLeave={handleLeave}
      >
        <EditIcon label="" size="small" />
        Edit
      </button>

      <button
        onClick={() => { onDuplicate(); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2"
        style={menuItemStyle}
        onMouseEnter={handleHover}
        onMouseLeave={handleLeave}
      >
        <CopyIcon label="" size="small" />
        Duplicate
      </button>

      <div className="my-0.5 mx-2" style={{ borderTop: `1px solid ${token('color.border')}` }} />

      <button
        onClick={() => { onDelete(); onClose(); }}
        className="w-full px-3 py-1.5 text-left text-sm flex items-center gap-2"
        style={{ color: token('color.text.danger') }}
        onMouseEnter={handleHover}
        onMouseLeave={handleLeave}
      >
        <DeleteIcon label="" size="small" />
        Delete
      </button>
    </div>
  );
});
