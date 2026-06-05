const CREDENTIALS_KEY = 'jira-credentials';
const CURRENT_USER_KEY = 'jira-current-user';

export interface JiraCredentials {
  instanceUrl: string;
  userEmail: string;
  apiToken: string;
}

export interface CurrentUser {
  accountId: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export function getCredentials(): JiraCredentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CREDENTIALS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as JiraCredentials;
    if (!parsed.instanceUrl || !parsed.userEmail || !parsed.apiToken) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCredentials(creds: JiraCredentials): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(creds));
}

export function clearCredentials(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(CREDENTIALS_KEY);
  window.localStorage.removeItem(CURRENT_USER_KEY);
}

export function getCurrentUser(): CurrentUser | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CURRENT_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CurrentUser;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: CurrentUser): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(user));
}

export function isAuthenticated(): boolean {
  return getCredentials() !== null;
}
