import { NextRequest, NextResponse } from 'next/server';
import { JiraClient } from '@/src/api/jira-client';
import { getCredentialsFromRequest } from '@/src/config/env';
import {
  JiraAuthenticationError,
  JiraRateLimitError,
} from '@/src/errors/jira-errors';

export async function GET(request: NextRequest) {
  const project = request.nextUrl.searchParams.get('project');

  if (!project) {
    return NextResponse.json(
      { error: 'Missing required parameter: project' },
      { status: 400 },
    );
  }

  const config = getCredentialsFromRequest(request);
  if (!config) {
    return NextResponse.json({ error: 'No Jira credentials provided.' }, { status: 401 });
  }

  try {
    const client = new JiraClient(config);
    const users = await client.getAssignableUsers(project);

    // Filter to active users only
    const activeUsers = users.filter((u) => u.active);

    return NextResponse.json({ users: activeUsers });
  } catch (error) {
    console.error('Team members fetch error:', error);
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
