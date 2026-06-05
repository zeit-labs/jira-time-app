'use client';

import { useState } from 'react';
import { token } from '@atlaskit/tokens';
import { useAuth } from '@/hooks/useAuth';
import type { JiraCredentials } from '@/lib/auth';

export default function LoginPage() {
  const { login, error, isLoading } = useAuth();
  const [instanceUrl, setInstanceUrl] = useState('https://.atlassian.net');
  const [userEmail, setUserEmail] = useState('');
  const [apiToken, setApiToken] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  function validate(): boolean {
    const errors: Record<string, string> = {};
    if (!instanceUrl.trim() || !instanceUrl.includes('atlassian.net')) {
      errors.instanceUrl = 'Enter a valid Atlassian instance URL (e.g., https://your-domain.atlassian.net)';
    }
    if (!userEmail.trim() || !userEmail.includes('@')) {
      errors.userEmail = 'Enter a valid email address';
    }
    if (!apiToken.trim()) {
      errors.apiToken = 'API token is required';
    }
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    const creds: JiraCredentials = {
      instanceUrl: instanceUrl.trim().replace(/\/+$/, ''),
      userEmail: userEmail.trim(),
      apiToken: apiToken.trim(),
    };

    await login(creds);
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{ backgroundColor: token('elevation.surface.sunken') }}
    >
      <div
        className="w-full max-w-md rounded-xl p-8"
        style={{
          backgroundColor: token('elevation.surface'),
          boxShadow: `0 4px 24px ${token('color.background.neutral')}`,
        }}
      >
        {/* Brand */}
        <div className="flex items-center gap-3 mb-8">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: token('color.background.brand.bold') }}
          >
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="8" cy="8" r="6.5" stroke="white" strokeWidth="1.5" />
              <path d="M8 4.5V8.5L10.5 10" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1
              className="text-lg font-bold tracking-tight"
              style={{ color: token('color.text') }}
            >
              Jira Time Logger
            </h1>
            <p
              className="text-xs"
              style={{ color: token('color.text.subtle') }}
            >
              Sign in with your Jira credentials
            </p>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="mb-5 p-3 rounded-md text-sm"
            style={{
              backgroundColor: token('color.background.warning'),
              border: `1px solid ${token('color.border.warning')}`,
              color: token('color.text.warning'),
            }}
          >
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Instance URL */}
          <div>
            <label
              className="block text-sm font-semibold mb-1.5"
              style={{ color: token('color.text') }}
              htmlFor="instanceUrl"
            >
              Jira Instance URL
            </label>
            <input
              id="instanceUrl"
              type="text"
              value={instanceUrl}
              onChange={(e) => setInstanceUrl(e.target.value)}
              placeholder="https://your-domain.atlassian.net"
              className="w-full px-3 py-2 rounded-md text-sm outline-none border"
              style={{
                backgroundColor: token('elevation.surface.sunken'),
                borderColor: validationErrors.instanceUrl ? token('color.border.danger') : token('color.border'),
                color: token('color.text'),
              }}
              disabled={isLoading}
            />
            {validationErrors.instanceUrl && (
              <p className="text-xs mt-1" style={{ color: token('color.text.danger') }}>{validationErrors.instanceUrl}</p>
            )}
          </div>

          {/* Email */}
          <div>
            <label
              className="block text-sm font-semibold mb-1.5"
              style={{ color: token('color.text') }}
              htmlFor="userEmail"
            >
              Email
            </label>
            <input
              id="userEmail"
              type="email"
              value={userEmail}
              onChange={(e) => setUserEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-2 rounded-md text-sm outline-none border"
              style={{
                backgroundColor: token('elevation.surface.sunken'),
                borderColor: validationErrors.userEmail ? token('color.border.danger') : token('color.border'),
                color: token('color.text'),
              }}
              disabled={isLoading}
            />
            {validationErrors.userEmail && (
              <p className="text-xs mt-1" style={{ color: token('color.text.danger') }}>{validationErrors.userEmail}</p>
            )}
          </div>

          {/* API Token */}
          <div>
            <label
              className="block text-sm font-semibold mb-1.5"
              style={{ color: token('color.text') }}
              htmlFor="apiToken"
            >
              API Token
            </label>
            <input
              id="apiToken"
              type="password"
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
              placeholder="Enter your Jira API token"
              className="w-full px-3 py-2 rounded-md text-sm outline-none border"
              style={{
                backgroundColor: token('elevation.surface.sunken'),
                borderColor: validationErrors.apiToken ? token('color.border.danger') : token('color.border'),
                color: token('color.text'),
              }}
              disabled={isLoading}
            />
            {validationErrors.apiToken && (
              <p className="text-xs mt-1" style={{ color: token('color.text.danger') }}>{validationErrors.apiToken}</p>
            )}
          </div>

          {/* Help text */}
          <div
            className="text-xs p-3 rounded-md"
            style={{
              backgroundColor: token('color.background.neutral'),
              color: token('color.text.subtle'),
            }}
          >
            Create an API token at{' '}
            <a
              href="https://id.atlassian.com/manage-profile/security/api-tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: token('color.link') }}
            >
              Atlassian Account Settings
            </a>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 rounded-md text-sm font-semibold text-white transition-opacity"
            style={{
              backgroundColor: token('color.background.brand.bold'),
              opacity: isLoading ? 0.6 : 1,
            }}
          >
            {isLoading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
