import { getCredentials } from './auth';

export function getAuthHeaders(): Record<string, string> {
  const creds = getCredentials();
  if (!creds) return {};
  return {
    'X-Jira-Instance': creds.instanceUrl,
    'X-Jira-Email': creds.userEmail,
    'X-Jira-Token': creds.apiToken,
  };
}

export async function apiFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  const headers = getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
}
