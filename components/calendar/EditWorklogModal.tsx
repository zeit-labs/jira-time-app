'use client';

import { useState, useEffect } from 'react';
import { token } from '@atlaskit/tokens';
import { format } from 'date-fns';
import Button from '@atlaskit/button/new';
import Textfield from '@atlaskit/textfield';
import TextArea from '@atlaskit/textarea';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import type { CalendarEvent } from '@/types/calendar';
import { toJiraDatetime } from '@/lib/date-utils';
import { apiFetch } from '@/lib/api-client';
import { adfToText } from '@/lib/adf-helpers';

interface EditWorklogModalProps {
  isOpen: boolean;
  calendarEvent: CalendarEvent | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function EditWorklogModal({ isOpen, calendarEvent, onClose, onSaved }: EditWorklogModalProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [hours, setHours] = useState('');
  const [comment, setComment] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Populate fields when event changes
  useEffect(() => {
    if (calendarEvent) {
      setDate(format(calendarEvent.start, 'yyyy-MM-dd'));
      setTime(format(calendarEvent.start, 'HH:mm'));
      const durationHours = (calendarEvent.end.getTime() - calendarEvent.start.getTime()) / (1000 * 60 * 60);
      setHours(String(Math.round(durationHours * 100) / 100));
      setComment(adfToText(calendarEvent.worklog?.comment));
      setError(null);
    }
  }, [calendarEvent]);

  const showModal = isOpen && calendarEvent !== null;

  const handleSave = async () => {
    const numHours = parseFloat(hours);
    if (isNaN(numHours) || numHours <= 0) {
      setError('Please enter a valid duration');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      const startedDate = new Date(`${date}T${time}:00`);
      const timeSpentSeconds = Math.round(numHours * 3600);

      const body: Record<string, unknown> = {
        issueKey: calendarEvent!.issueKey,
        worklogId: calendarEvent!.id,
        timeSpentSeconds,
        started: toJiraDatetime(startedDate),
      };
      if (comment.trim()) {
        body.comment = comment.trim();
      }

      const res = await apiFetch('/api/worklogs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Failed to update (${res.status})`);
      }

      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalTransition>
      {showModal && (
        <Modal onClose={onClose} width="medium">
          <ModalHeader>
            <ModalTitle>Edit Worklog</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm mb-4" style={{ color: token('color.text.subtlest') }}>
              <span className="font-medium" style={{ color: token('color.link') }}>{calendarEvent!.issueKey}</span>{' '}
              {calendarEvent!.issueSummary}
            </p>

            {error && (
              <div className="mb-3 p-2 rounded text-sm" style={{
                backgroundColor: token('color.background.danger'),
                border: `1px solid ${token('color.border.danger')}`,
                color: token('color.text.danger'),
              }}>
                {error}
              </div>
            )}

            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1" style={{ color: token('color.text') }}>Date</label>
                  <Textfield
                    type="date"
                    value={date}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium mb-1" style={{ color: token('color.text') }}>Start Time</label>
                  <Textfield
                    type="time"
                    value={time}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTime(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: token('color.text') }}>Duration (hours)</label>
                <Textfield
                  type="number"
                  value={hours}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setHours(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-1" style={{ color: token('color.text') }}>Comment (optional)</label>
                <TextArea
                  value={comment}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
                  minimumRows={2}
                  placeholder="Add a note..."
                  resize="none"
                />
              </div>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={onClose}
              appearance="subtle"
              isDisabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              appearance="primary"
              isDisabled={isSaving}
              isLoading={isSaving}
            >
              Save Changes
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}
