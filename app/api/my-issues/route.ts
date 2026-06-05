import { NextRequest, NextResponse } from 'next/server';
import { JiraClient } from '@/src/api/jira-client';
import { getCredentialsFromRequest } from '@/src/config/env';
import {
  JiraAuthenticationError,
  JiraRateLimitError,
} from '@/src/errors/jira-errors';

export async function GET(request: NextRequest) {
  const config = getCredentialsFromRequest(request);
  if (!config) {
    return NextResponse.json({ error: 'No Jira credentials provided.' }, { status: 401 });
  }

  try {
    const client = new JiraClient(config);

    const searchParams = request.nextUrl.searchParams;
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Always include issues assigned to the current user (regardless of date / status)
    // so that Done or recently-resolved tickets are still available for time logging.
    // When a date range is given, also pull in issues where work was logged in that range.
    let jql: string;
    if (startDate && endDate) {
      jql = `(assignee = currentUser() OR (worklogAuthor = currentUser() AND worklogDate >= "${startDate}" AND worklogDate <= "${endDate}")) ORDER BY updated DESC`;
    } else {
      jql = '(assignee = currentUser() OR worklogAuthor = currentUser()) ORDER BY updated DESC';
    }
    const result = await client.searchAllIssues(jql, 100);

    return NextResponse.json({
      issues: result.issues,
      total: result.issues.length,
    });
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
