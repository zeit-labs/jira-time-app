'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  getCredentials,
  setCredentials,
  clearCredentials,
  getCurrentUser,
  setCurrentUser,
  isAuthenticated as checkIsAuthenticated,
  type JiraCredentials,
  type CurrentUser,
} from '@/lib/auth';
import { getAuthHeaders } from '@/lib/api-client';

interface AuthState {
  user: CurrentUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  error: string | null;
  login: (creds: JiraCredentials) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const validatedRef = useRef(false);

  useEffect(() => {
    if (validatedRef.current) return;
    validatedRef.current = true;

    if (!checkIsAuthenticated()) {
      setIsLoading(false);
      return;
    }

    const cachedUser = getCurrentUser();
    if (cachedUser) {
      setUser(cachedUser);
    }

    const headers = getAuthHeaders();
    fetch('/api/myself', { headers })
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json();
          const userData: CurrentUser = {
            accountId: data.user.accountId,
            displayName: data.user.displayName,
            avatarUrls: data.user.avatarUrls,
          };
          setUser(userData);
          setCurrentUser(userData);
        } else {
          setError('Stored credentials are invalid. Please log in again.');
          clearCredentials();
          setUser(null);
        }
      })
      .catch(() => {
        setError('Could not reach the Jira API. Check your connection.');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, []);

  const login = useCallback(async (creds: JiraCredentials): Promise<boolean> => {
    setError(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/myself', {
        headers: {
          'X-Jira-Instance': creds.instanceUrl,
          'X-Jira-Email': creds.userEmail,
          'X-Jira-Token': creds.apiToken,
        },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Authentication failed. Check your credentials.');
        return false;
      }

      const data = await res.json();
      const userData: CurrentUser = {
        accountId: data.user.accountId,
        displayName: data.user.displayName,
        avatarUrls: data.user.avatarUrls,
      };

      setCredentials(creds);
      setCurrentUser(userData);
      setUser(userData);
      return true;
    } catch {
      setError('Could not reach the Jira API. Check your instance URL and connection.');
      return false;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    clearCredentials();
    setUser(null);
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        error,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
