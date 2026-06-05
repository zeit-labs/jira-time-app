import 'dotenv/config';
import type { NextRequest } from 'next/server';

export interface JiraConfig {
  instanceUrl: string;
  userEmail: string;
  apiToken: string;
}

function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value || value.trim() === '') return undefined;
  return value.trim();
}

export function loadConfig(): JiraConfig | null {
  const instanceUrl = getEnv('JIRA_INSTANCE_URL');
  const userEmail = getEnv('JIRA_USER_EMAIL');
  const apiToken = getEnv('JIRA_API_TOKEN');

  if (!instanceUrl || !userEmail || !apiToken) return null;

  return { instanceUrl, userEmail, apiToken };
}

export function getCredentialsFromRequest(request: NextRequest): JiraConfig | null {
  const instanceUrl = request.headers.get('X-Jira-Instance');
  const userEmail = request.headers.get('X-Jira-Email');
  const apiToken = request.headers.get('X-Jira-Token');

  if (instanceUrl && userEmail && apiToken) {
    return { instanceUrl, userEmail, apiToken };
  }

  return loadConfig();
}
