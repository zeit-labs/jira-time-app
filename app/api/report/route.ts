import { NextRequest, NextResponse } from 'next/server';
import { JiraClient } from '@/src/api/jira-client';
import { getCredentialsFromRequest } from '@/src/config/env';
import { JiraAuthenticationError, JiraRateLimitError } from '@/src/errors/jira-errors';
import type { JiraWorklog } from '@/src/types/jira';

/**
 * GET /api/report
 * Fetches all issues + worklogs for a given user and month, ready for the monthly report.
 *
 * Query params:
 *   month       - 1-12
 *   year        - e.g. 2025
 *   accountId   - Jira accountId of the user (optional, defaults to current user)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const month = Number(searchParams.get('month'));
  const year = Number(searchParams.get('year'));
  const accountId = searchParams.get('accountId');

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Valid month (1-12) and year are required.' }, { status: 400 });
  }

  const config = getCredentialsFromRequest(request);
  if (!config) {
    return NextResponse.json({ error: 'No Jira credentials provided.' }, { status: 401 });
  }

  try {
    const client = new JiraClient(config);

    // Resolve the target user
    const myself = await client.getMyself();
    const targetAccountId = accountId ?? myself.accountId;
    const targetDisplayName = targetAccountId === myself.accountId ? myself.displayName : targetAccountId;

    // Date range for this month
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // Find all issues that have worklogs by this user in this month
    const jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor = "${targetAccountId}" ORDER BY updated DESC`;
    const result = await client.searchAllIssues(jql);

    if (result.issues.length === 0) {
      return NextResponse.json({
        issues: [],
        worklogsByIssue: {},
        authorAccountId: targetAccountId,
        authorName: targetDisplayName,
      });
    }

    // Fetch worklogs for all issues in batches
    const BATCH_SIZE = 5;
    const worklogsByIssue: Record<string, JiraWorklog[]> = {};
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate + 'T23:59:59.999Z').getTime();

    for (let i = 0; i < result.issues.length; i += BATCH_SIZE) {
      if (i > 0) await new Promise((r) => setTimeout(r, 200));
      const batch = result.issues.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (issue) => {
          try {
            const worklogs = await client.getWorklogs(issue.key, {
              startedAfter: startTs,
              startedBefore: endTs,
            });
            // Filter to only this user's logs
            worklogsByIssue[issue.key] = worklogs.filter(
              (wl) => wl.author.accountId === targetAccountId,
            );
          } catch {
            worklogsByIssue[issue.key] = [];
          }
        }),
      );
    }

    return NextResponse.json({
      issues: result.issues,
      worklogsByIssue,
      authorAccountId: targetAccountId,
      authorName: targetDisplayName,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof JiraAuthenticationError) {
      return NextResponse.json({ error: 'Authentication failed.' }, { status: 401 });
    }
    if (error instanceof JiraRateLimitError) {
      return NextResponse.json({ error: 'Rate limited by Jira. Please retry.' }, { status: 429 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
