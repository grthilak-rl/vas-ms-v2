/**
 * JWT Authentication Management
 * Handles token storage, refresh, and expiry
 */

export interface TokenData {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scopes: string[];
  expires_at: number; // Unix timestamp when token expires
}

const TOKEN_STORAGE_KEY = 'vas_auth_token';
const CLIENT_ID_KEY = 'vas_client_id';
const CLIENT_SECRET_KEY = 'vas_client_secret';

/**
 * Save tokens to localStorage with expiration timestamp
 */
export function saveTokens(tokenData: Omit<TokenData, 'expires_at'>): void {
  const expiresAt = Date.now() + (tokenData.expires_in * 1000);
  const fullTokenData: TokenData = {
    ...tokenData,
    expires_at: expiresAt
  };
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(fullTokenData));
}

/**
 * Get tokens from localStorage
 */
export function getTokens(): TokenData | null {
  if (typeof window === 'undefined') return null;

  const stored = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

/**
 * Check if access token is expired or about to expire (within 5 minutes)
 */
export function isTokenExpired(tokenData: TokenData | null): boolean {
  if (!tokenData) return true;
  const expiresIn = tokenData.expires_at - Date.now();
  return expiresIn < (5 * 60 * 1000); // Refresh if less than 5 minutes remaining
}

/**
 * Clear all authentication data
 */
export function clearAuth(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

/**
 * Clear client credentials (used when credentials are invalid after rebuild)
 */
export function clearClientCredentials(): void {
  localStorage.removeItem(CLIENT_ID_KEY);
  localStorage.removeItem(CLIENT_SECRET_KEY);
}

/**
 * Save client credentials for automatic token refresh
 */
export function saveClientCredentials(clientId: string, clientSecret: string): void {
  localStorage.setItem(CLIENT_ID_KEY, clientId);
  localStorage.setItem(CLIENT_SECRET_KEY, clientSecret);
}

/**
 * Get client credentials
 */
export function getClientCredentials(): { clientId: string; clientSecret: string } | null {
  if (typeof window === 'undefined') return null;

  const clientId = localStorage.getItem(CLIENT_ID_KEY);
  const clientSecret = localStorage.getItem(CLIENT_SECRET_KEY);

  if (!clientId || !clientSecret) return null;

  return { clientId, clientSecret };
}

/**
 * Get valid access token (refreshes if needed)
 */
export async function getValidAccessToken(apiUrl: string): Promise<string | null> {
  const tokens = getTokens();

  // If no token or expired, try to refresh
  if (!tokens || isTokenExpired(tokens)) {
    const credentials = getClientCredentials();
    if (!credentials) return null;

    try {
      const newTokens = await requestNewTokens(apiUrl, credentials.clientId, credentials.clientSecret);
      if (newTokens) {
        saveTokens(newTokens);
        return newTokens.access_token;
      }
      return null;
    } catch (error) {
      console.error('Failed to refresh token:', error);
      clearAuth();
      return null;
    }
  }

  return tokens?.access_token || null;
}

/**
 * Request new tokens from backend
 */
export async function requestNewTokens(
  apiUrl: string,
  clientId: string,
  clientSecret: string,
  scopes?: string[]
): Promise<Omit<TokenData, 'expires_at'> | null> {
  try {
    const response = await fetch(`${apiUrl}/v2/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        scopes: scopes || [
          'streams:read',
          'streams:consume',
          'bookmarks:read',
          'bookmarks:write',
          'snapshots:read',
          'snapshots:write'
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Token request failed: ${response.status}`);
    }

    const data = await response.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type,
      expires_in: data.expires_in,
      scopes: data.scopes
    };
  } catch (error) {
    console.error('Token request error:', error);
    return null;
  }
}

/**
 * Initialize authentication with client credentials
 * Returns true if authentication successful
 */
export async function initializeAuth(
  apiUrl: string,
  clientId: string,
  clientSecret: string
): Promise<boolean> {
  try {
    const tokens = await requestNewTokens(apiUrl, clientId, clientSecret);
    if (!tokens) return false;

    saveTokens(tokens);
    saveClientCredentials(clientId, clientSecret);
    return true;
  } catch (error) {
    console.error('Authentication initialization failed:', error);
    return false;
  }
}
