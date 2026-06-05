import { NextRequest, NextResponse } from 'next/server';
import { JiraClient } from '@/src/api/jira-client';
import { getCredentialsFromRequest } from '@/src/config/env';
import { JiraAuthenticationError } from '@/src/errors/jira-errors';

export async function GET(request: NextRequest) {
  const config = getCredentialsFromRequest(request);
  if (!config) {
    return NextResponse.json({ error: 'No Jira credentials provided. Set them in .env.local or pass via request headers.' }, { status: 401 });
  }

  try {
    const client = new JiraClient(config);
    const user = await client.getMyself();
    return NextResponse.json({ user });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (error instanceof JiraAuthenticationError) {
      return NextResponse.json({ error: message }, { status: 401 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
