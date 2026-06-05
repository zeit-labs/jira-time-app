import { NextRequest, NextResponse } from 'next/server';
import { JiraClient } from '@/src/api/jira-client';
import { getCredentialsFromRequest } from '@/src/config/env';
import { JiraAuthenticationError, JiraRateLimitError } from '@/src/errors/jira-errors';
import type { JiraWorklog } from '@/src/types/jira';

/**
 * GET /api/team-report
 * Fetches worklogs for all team members in a given month.
 *
 * Query params:
 *   month        - 1-12
 *   year         - e.g. 2025
 *   projectKey   - (optional) scope team members to a project
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const month = Number(searchParams.get('month'));
  const year = Number(searchParams.get('year'));
  const projectKey = searchParams.get('projectKey');

  if (!month || !year || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Valid month (1-12) and year are required.' }, { status: 400 });
  }

  const config = getCredentialsFromRequest(request);
  if (!config) {
    return NextResponse.json({ error: 'No Jira credentials provided.' }, { status: 401 });
  }

  try {
    const client = new JiraClient(config);

    // Date range
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const startTs = new Date(startDate).getTime();
    const endTs = new Date(endDate + 'T23:59:59.999Z').getTime();

    // Get team members list
    let users: { accountId: string; displayName: string }[] = [];
    if (projectKey) {
      const assignable = await client.getAssignableUsers(projectKey);
      users = assignable.filter((u) => u.active).map((u) => ({
        accountId: u.accountId,
        displayName: u.displayName,
      }));
    } else {
      // Fall back to users who have logged time this month
      const jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" ORDER BY updated DESC`;
      const result = await client.searchAllIssues(jql);
      const seen = new Map<string, string>();
      // We'll collect unique authors from worklogs below
      for (const issue of result.issues) {
        try {
          const worklogs = await client.getWorklogs(issue.key, { startedAfter: startTs, startedBefore: endTs });
          for (const wl of worklogs) {
            if (!seen.has(wl.author.accountId)) {
              seen.set(wl.author.accountId, wl.author.displayName);
            }
          }
        } catch { /* skip */ }
      }
      users = Array.from(seen.entries()).map(([accountId, displayName]) => ({ accountId, displayName }));
    }

    if (users.length === 0) {
      return NextResponse.json({ users: [], worklogsByUser: {}, issuesByUser: {} });
    }

    // For each user, fetch their issues and worklogs this month
    const worklogsByUser: Record<string, Record<string, JiraWorklog[]>> = {};
    const issuesByUser: Record<string, { key: string; summary: string; projectKey: string; projectName: string }[]> = {};

    const BATCH_SIZE = 3;
    for (let i = 0; i < users.length; i += BATCH_SIZE) {
      if (i > 0) await new Promise((r) => setTimeout(r, 300));
      const batch = users.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (user) => {
          try {
            const jql = `worklogDate >= "${startDate}" AND worklogDate <= "${endDate}" AND worklogAuthor = "${user.accountId}" ORDER BY updated DESC`;
            const result = await client.searchAllIssues(jql);

            issuesByUser[user.accountId] = result.issues.map((issue) => ({
              key: issue.key,
              summary: issue.fields.summary,
              projectKey: issue.fields.project.key,
              projectName: issue.fields.project.name,
            }));

            worklogsByUser[user.accountId] = {};
            const ISSUE_BATCH = 5;
            for (let j = 0; j < result.issues.length; j += ISSUE_BATCH) {
              if (j > 0) await new Promise((r) => setTimeout(r, 200));
              const issueBatch = result.issues.slice(j, j + ISSUE_BATCH);
              await Promise.all(
                issueBatch.map(async (issue) => {
                  try {
                    const worklogs = await client.getWorklogs(issue.key, {
                      startedAfter: startTs,
                      startedBefore: endTs,
                    });
                    worklogsByUser[user.accountId][issue.key] = worklogs.filter(
                      (wl) => wl.author.accountId === user.accountId,
                    );
                  } catch {
                    worklogsByUser[user.accountId][issue.key] = [];
                  }
                }),
              );
            }
          } catch {
            worklogsByUser[user.accountId] = {};
            issuesByUser[user.accountId] = [];
          }
        }),
      );
    }

    return NextResponse.json({ users, worklogsByUser, issuesByUser });
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
