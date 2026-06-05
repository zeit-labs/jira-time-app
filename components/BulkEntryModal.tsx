'use client';

import { useState, useCallback } from 'react';
import { token } from '@atlaskit/tokens';
import Button, { IconButton } from '@atlaskit/button/new';
import CrossIcon from '@atlaskit/icon/core/cross';
import Textfield from '@atlaskit/textfield';
import Modal, { ModalBody, ModalFooter, ModalHeader, ModalTitle, ModalTransition } from '@atlaskit/modal-dialog';
import { formatDateISO, toJiraDatetimeAt9AM } from '@/lib/date-utils';
import { apiFetch } from '@/lib/api-client';

interface BulkEntry {
  id: string;
  issueKey: string;
  date: string; // YYYY-MM-DD
  hours: string;
  status: 'pending' | 'saving' | 'success' | 'error';
  error?: string;
}

interface BulkEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void; // Trigger data refetch
}

export default function BulkEntryModal({ isOpen, onClose, onComplete }: BulkEntryModalProps) {
  const [entries, setEntries] = useState<BulkEntry[]>([createEmptyEntry()]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  function createEmptyEntry(): BulkEntry {
    return {
      id: crypto.randomUUID(),
      issueKey: '',
      date: formatDateISO(new Date()),
      hours: '',
      status: 'pending',
    };
  }

  const addRow = useCallback(() => {
    setEntries((prev) => [...prev, createEmptyEntry()]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const updateEntry = useCallback((id: string, field: keyof BulkEntry, value: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, [field]: value } : e)),
    );
  }, []);

  const submitAll = useCallback(async () => {
    // Filter valid entries
    const valid = entries.filter(
      (e) => e.issueKey.trim() && e.date && e.hours.trim() && parseFloat(e.hours) > 0,
    );
    if (valid.length === 0) return;

    setIsSubmitting(true);
    setProgress({ done: 0, total: valid.length });

    let completed = 0;
    const updatedEntries = [...entries];

    for (const entry of valid) {
      const idx = updatedEntries.findIndex((e) => e.id === entry.id);
      updatedEntries[idx] = { ...updatedEntries[idx], status: 'saving' };
      setEntries([...updatedEntries]);

      try {
        const hours = parseFloat(entry.hours);
        const timeSpentSeconds = Math.round(hours * 3600);
        const started = toJiraDatetimeAt9AM(entry.date);

        const res = await apiFetch('/api/worklogs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            issueKey: entry.issueKey.trim(),
            timeSpentSeconds,
            started,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `Failed (${res.status})`);
        }

        updatedEntries[idx] = { ...updatedEntries[idx], status: 'success' };
      } catch (err) {
        updatedEntries[idx] = {
          ...updatedEntries[idx],
          status: 'error',
          error: (err as Error).message,
        };
      }

      completed++;
      setProgress({ done: completed, total: valid.length });
      setEntries([...updatedEntries]);
    }

    setIsSubmitting(false);
    onComplete();
  }, [entries, onComplete]);

  const handleClose = useCallback(() => {
    if (!isSubmitting) {
      setEntries([createEmptyEntry()]);
      onClose();
    }
  }, [isSubmitting, onClose]);

  return (
    <ModalTransition>
      {isOpen && (
        <Modal onClose={handleClose} width="large">
          <ModalHeader>
            <ModalTitle>Bulk Time Entry</ModalTitle>
            <IconButton
              icon={CrossIcon}
              label="Close"
              onClick={handleClose}
              isDisabled={isSubmitting}
              appearance="subtle"
            />
          </ModalHeader>
          <ModalBody>
            {isSubmitting && (
              <div className="mb-4 p-3 rounded text-sm" style={{
                backgroundColor: token('color.background.information'),
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: token('color.border.information'),
                color: token('color.text.information'),
              }}>
                Saving... {progress.done}/{progress.total} entries
              </div>
            )}

            <div className="space-y-3">
              {entries.map((entry) => (
                <div key={entry.id} className="flex items-center gap-2">
                  <div className="flex-1">
                    <Textfield
                      placeholder="PROJ-123"
                      value={entry.issueKey}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateEntry(entry.id, 'issueKey', e.target.value)}
                      isDisabled={isSubmitting}
                    />
                  </div>
                  <div>
                    <Textfield
                      type="date"
                      value={entry.date}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateEntry(entry.id, 'date', e.target.value)}
                      isDisabled={isSubmitting}
                    />
                  </div>
                  <div style={{ width: 80 }}>
                    <Textfield
                      placeholder="Hours"
                      value={entry.hours}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateEntry(entry.id, 'hours', e.target.value)}
                      isDisabled={isSubmitting}
                    />
                  </div>
                  {/* Status indicator */}
                  <span className="w-6 text-center">
                    {entry.status === 'saving' && '\u23F3'}
                    {entry.status === 'success' && '\u2705'}
                    {entry.status === 'error' && (
                      <span title={entry.error} className="cursor-help">{'\u274C'}</span>
                    )}
                  </span>
                  <IconButton
                    icon={CrossIcon}
                    label="Remove row"
                    onClick={() => removeRow(entry.id)}
                    isDisabled={isSubmitting || entries.length === 1}
                    appearance="subtle"
                    spacing="compact"
                  />
                </div>
              ))}
            </div>

            <div className="mt-3">
              <Button
                onClick={addRow}
                isDisabled={isSubmitting}
                appearance="subtle"
                spacing="compact"
              >
                + Add another entry
              </Button>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              onClick={handleClose}
              isDisabled={isSubmitting}
              appearance="subtle"
            >
              Cancel
            </Button>
            <Button
              onClick={submitAll}
              isDisabled={isSubmitting}
              isLoading={isSubmitting}
              appearance="primary"
            >
              {isSubmitting ? `Saving ${progress.done}/${progress.total}...` : 'Submit All'}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </ModalTransition>
  );
}
