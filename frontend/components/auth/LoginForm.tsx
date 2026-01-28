'use client';

import { useState, useEffect } from 'react';
import { useAuth, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '@/contexts/AuthContext';

export default function LoginForm() {
  const { login, loginWithDefaults, isLoading } = useAuth();
  const [clientId, setClientId] = useState(DEFAULT_CLIENT_ID);
  const [clientSecret, setClientSecret] = useState(DEFAULT_CLIENT_SECRET);
  const [error, setError] = useState('');
  const [autoLoginAttempted, setAutoLoginAttempted] = useState(false);

  // Try auto-login with default credentials on mount
  useEffect(() => {
    if (!autoLoginAttempted) {
      setAutoLoginAttempted(true);
      loginWithDefaults().catch(() => {
        // Silent fail - user will see the login form
      });
    }
  }, [autoLoginAttempted, loginWithDefaults]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!clientId || !clientSecret) {
      setError('Please enter both Client ID and Client Secret');
      return;
    }

    const success = await login(clientId, clientSecret);
    if (!success) {
      setError('Authentication failed. Please check your credentials.');
    }
  };

  const handleUseDefaults = () => {
    setClientId(DEFAULT_CLIENT_ID);
    setClientSecret(DEFAULT_CLIENT_SECRET);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="max-w-md w-full bg-white rounded-lg shadow-md p-8">
        <div className="text-center mb-8">
          <div className="h-16 w-16 bg-blue-600 rounded-lg flex items-center justify-center mx-auto mb-4">
            <svg className="h-10 w-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">VAS-MS V2</h1>
          <p className="text-gray-600 mt-2">Video Aggregation Service</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="clientId" className="block text-sm font-medium text-gray-700">
              Client ID
            </label>
            <input
              id="clientId"
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-4 py-2 border"
              placeholder="e.g., vas-portal"
              disabled={isLoading}
            />
          </div>

          <div>
            <label htmlFor="clientSecret" className="block text-sm font-medium text-gray-700">
              Client Secret
            </label>
            <input
              id="clientSecret"
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              className="mt-1 block w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-4 py-2 border"
              placeholder="your-client-secret"
              disabled={isLoading}
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 p-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Authenticating...' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4">
          <button
            type="button"
            onClick={handleUseDefaults}
            className="w-full text-sm text-blue-600 hover:text-blue-800 py-2"
          >
            Use default credentials
          </button>
        </div>

        <div className="mt-6 p-4 bg-gray-50 rounded-lg">
          <h3 className="text-sm font-medium text-gray-700 mb-2">Default Credentials</h3>
          <div className="text-xs text-gray-600 space-y-1">
            <p><span className="font-medium">Client ID:</span> {DEFAULT_CLIENT_ID}</p>
            <p><span className="font-medium">Client Secret:</span> {DEFAULT_CLIENT_SECRET}</p>
          </div>
        </div>

        <div className="mt-4 p-4 bg-blue-50 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 mb-2">For RuthAI Integration</h3>
          <p className="text-xs text-blue-700">
            Create a dedicated client via <code className="bg-blue-100 px-1 rounded">POST /v2/auth/clients</code> with appropriate scopes.
            The client_secret is shown only once when created.
          </p>
        </div>
      </div>
    </div>
  );
}
