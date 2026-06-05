import { NextRequest, NextResponse } from 'next/server';
import { JiraClient } from '@/src/api/jira-client';
import { getCredentialsFromRequest } from '@/src/config/env';
import {
  JiraAuthenticationError,
  JiraForbiddenError,
  JiraNotFoundError,
  JiraRateLimitError,
} from '@/src/errors/jira-errors';
import type { JiraWorklog, WorklogCreatePayload, WorklogUpdatePayload } from '@/src/types/jira';
import { textToADF } from '@/lib/adf-helpers';

function getClient(request: NextRequest): { client: JiraClient } | { error: NextResponse } {
  const config = getCredentialsFromRequest(request);
  if (!config) {
    return { error: NextResponse.json({ error: 'No Jira credentials provided.' }, { status: 401 }) };
  }
  return { client: new JiraClient(config) };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const issueKeysParam = searchParams.get('issueKeys');
  const startDate = searchParams.get('startDate');
  const endDate = searchParams.get('endDate');
  const accountIdsParam = searchParams.get('accountIds');
  const accountIds = accountIdsParam
    ? accountIdsParam.split(',').map((id) => id.trim()).filter(Boolean)
    : null;

  if (!issueKeysParam) {
    return NextResponse.json(
      { error: 'Missing required parameter: issueKeys' },
      { status: 400 },
    );
  }

  const issueKeys = issueKeysParam
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  if (issueKeys.length === 0) {
    return NextResponse.json(
      { error: 'issueKeys must contain at least one key' },
      { status: 400 },
    );
  }

  const clientOrError = getClient(request);
  if ('error' in clientOrError) return clientOrError.error;
  const client = clientOrError.client;

  try {
    // Fetch worklogs in batches to avoid Jira rate limiting (429 errors)
    const BATCH_SIZE = 5;
    const results: { key: string; worklogs: JiraWorklog[] }[] = [];

    for (let i = 0; i < issueKeys.length; i += BATCH_SIZE) {
      // Add 500ms delay between batches (not before the first)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      const batch = issueKeys.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map(async (key) => {
          try {
            const worklogOptions: { startedAfter?: number; startedBefore?: number } = {};
            if (startDate) {
              worklogOptions.startedAfter = new Date(startDate).getTime();
            }
            if (endDate) {
              const endOfDay = new Date(endDate);
              endOfDay.setHours(23, 59, 59, 999);
              worklogOptions.startedBefore = endOfDay.getTime();
            }
            const worklogs = await client.getWorklogs(key, worklogOptions);
            return { key, worklogs };
          } catch (err) {
            // If a single issue fails after retries, return empty worklogs rather than failing the whole request
            console.error(`Failed to fetch worklogs for ${key}:`, err);
            return { key, worklogs: [] as JiraWorklog[] };
          }
        }),
      );
      results.push(...batchResults);
    }

    const worklogsByIssue: Record<string, JiraWorklog[]> = {};

    for (const { key, worklogs } of results) {
      // Filter worklogs by date range if provided
      let filtered = worklogs;
      if (startDate && endDate) {
        const start = new Date(startDate);
        const end = new Date(endDate);
        // Set end to end of day
        end.setHours(23, 59, 59, 999);
        filtered = worklogs.filter((wl) => {
          const started = new Date(wl.started);
          return started >= start && started <= end;
        });
      }
      // Filter by accountIds (multi-user mode)
      if (accountIds && accountIds.length > 0) {
        filtered = filtered.filter((wl) =>
          accountIds.includes(wl.author.accountId)
        );
      }

      worklogsByIssue[key] = filtered;
    }

    return NextResponse.json({ worklogs: worklogsByIssue });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof JiraAuthenticationError) {
      return NextResponse.json(
        { error: 'Authentication failed. Check your Jira API credentials.' },
        { status: 401 },
      );
    }
    if (error instanceof JiraRateLimitError) {
      return NextResponse.json(
        { error: 'Rate limited by Jira. Please wait and try again.' },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { issueKey, timeSpentSeconds, started, comment } = body;

    if (!issueKey || !timeSpentSeconds || !started) {
      return NextResponse.json(
        { error: 'Missing required fields: issueKey, timeSpentSeconds, started' },
        { status: 400 },
      );
    }

    if (timeSpentSeconds < 60) {
      return NextResponse.json(
        { error: 'Time logged must be at least 1 minute (60 seconds).' },
        { status: 400 },
      );
    }

    const clientOrError = getClient(request);
    if ('error' in clientOrError) return clientOrError.error;
    const client = clientOrError.client;

    const payload: WorklogCreatePayload = {
      timeSpentSeconds,
      started,
    };
    if (comment) {
      payload.comment = typeof comment === 'string' ? textToADF(comment) : comment;
    }

    const worklog = await client.createWorklog(issueKey, payload);

    return NextResponse.json({ worklog }, { status: 201 });
  } catch (error) {
    return handleWorklogError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { issueKey, worklogId, timeSpentSeconds, started, comment } = body;

    if (!issueKey || !worklogId) {
      return NextResponse.json(
        { error: 'Missing required fields: issueKey, worklogId' },
        { status: 400 },
      );
    }

    if (timeSpentSeconds !== undefined && timeSpentSeconds < 60) {
      return NextResponse.json(
        { error: 'Time logged must be at least 1 minute (60 seconds).' },
        { status: 400 },
      );
    }

    const clientOrError = getClient(request);
    if ('error' in clientOrError) return clientOrError.error;
    const client = clientOrError.client;

    const updateData: Partial<WorklogUpdatePayload> = {};
    if (timeSpentSeconds !== undefined) updateData.timeSpentSeconds = timeSpentSeconds;
    if (started !== undefined) updateData.started = started;
    if (comment !== undefined) {
      updateData.comment = typeof comment === 'string' ? textToADF(comment) : comment;
    }

    const worklog = await client.updateWorklog(issueKey, worklogId, updateData);

    return NextResponse.json({ worklog });
  } catch (error) {
    return handleWorklogError(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const issueKey = searchParams.get('issueKey');
    const worklogId = searchParams.get('worklogId');

    if (!issueKey || !worklogId) {
      return NextResponse.json(
        { error: 'Missing required parameters: issueKey, worklogId' },
        { status: 400 },
      );
    }

    const clientOrError = getClient(request);
    if ('error' in clientOrError) return clientOrError.error;
    const client = clientOrError.client;
    await client.deleteWorklog(issueKey, worklogId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return handleWorklogError(error);
  }
}

/** Shared error handler for worklog mutation routes */
function handleWorklogError(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : 'Unknown error';

  if (error instanceof JiraAuthenticationError) {
    return NextResponse.json(
      { error: 'Authentication failed. Check your Jira API credentials.' },
      { status: 401 },
    );
  }
  if (error instanceof JiraForbiddenError) {
    return NextResponse.json(
      { error: 'No permission to log time on this issue.' },
      { status: 403 },
    );
  }
  if (error instanceof JiraNotFoundError) {
    return NextResponse.json(
      { error: 'Issue or worklog not found.' },
      { status: 404 },
    );
  }
  if (error instanceof JiraRateLimitError) {
    const retryMsg = error.retryAfter
      ? ` Retry in ${error.retryAfter} seconds.`
      : '';
    return NextResponse.json(
      { error: `Rate limited by Jira.${retryMsg} Please wait and try again.` },
      { status: 429 },
    );
  }
  return NextResponse.json({ error: message }, { status: 500 });
}
