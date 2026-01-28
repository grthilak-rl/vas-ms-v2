'use client';

import { useState } from 'react';
import { BellIcon, CameraIcon, ArrowRightOnRectangleIcon, KeyIcon, Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { useAuth, DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET } from '@/contexts/AuthContext';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const mobileNavItems = [
  { name: 'Dashboard', href: '/' },
  { name: 'Devices', href: '/devices' },
  { name: 'Streams', href: '/streams' },
  { name: 'Snapshots', href: '/snapshots' },
  { name: 'Bookmarks', href: '/bookmarks' },
  { name: 'Analytics', href: '/analytics' },
  { name: 'Settings', href: '/settings' },
];

export default function Header() {
  const { isAuthenticated, isLoading, clientId, login, logout } = useAuth();
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [loginClientId, setLoginClientId] = useState(DEFAULT_CLIENT_ID);
  const [loginClientSecret, setLoginClientSecret] = useState(DEFAULT_CLIENT_SECRET);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const pathname = usePathname();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);
    setIsLoggingIn(true);

    const success = await login(loginClientId, loginClientSecret);
    if (success) {
      setShowLoginModal(false);
    } else {
      setLoginError('Invalid credentials. Please check your Client ID and Secret.');
    }
    setIsLoggingIn(false);
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <>
      <header className="bg-white shadow-sm border-b border-gray-200 z-50 relative">
        <div className="px-4 md:px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Mobile menu button */}
              <button
                onClick={() => setShowMobileMenu(!showMobileMenu)}
                className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                {showMobileMenu ? (
                  <XMarkIcon className="h-6 w-6" />
                ) : (
                  <Bars3Icon className="h-6 w-6" />
                )}
              </button>
              <div className="h-10 w-10 bg-blue-600 rounded-lg flex items-center justify-center">
                <CameraIcon className="h-6 w-6 text-white" />
              </div>
              <h1 className="text-lg md:text-2xl font-bold text-gray-900">
                <span className="hidden sm:inline">Video Aggregation Service</span>
                <span className="sm:hidden">VAS</span>
              </h1>
            </div>
            <div className="flex items-center space-x-2 md:space-x-4">
              <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg">
                <BellIcon className="h-6 w-6" />
              </button>

              {isLoading ? (
                <div className="flex items-center space-x-3">
                  <div className="animate-pulse bg-gray-200 h-4 w-24 rounded"></div>
                </div>
              ) : isAuthenticated ? (
                <div className="flex items-center space-x-3">
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900">{clientId || 'Authenticated'}</p>
                    <p className="text-xs text-gray-500">API Client</p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="h-10 w-10 rounded-full bg-green-600 hover:bg-green-700 flex items-center justify-center transition-colors"
                    title="Logout"
                  >
                    <ArrowRightOnRectangleIcon className="h-5 w-5 text-white" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowLoginModal(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                >
                  <KeyIcon className="h-5 w-5" />
                  <span>Login</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation Menu */}
        {showMobileMenu && (
          <div className="md:hidden border-t border-gray-200 bg-white">
            <nav className="px-4 py-2 space-y-1">
              {mobileNavItems.map((item) => {
                const isActive = pathname === item.href ||
                                (item.href !== '/' && pathname?.startsWith(item.href));
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setShowMobileMenu(false)}
                    className={`block px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {item.name}
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </header>

      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold text-gray-900">API Authentication</h2>
              <button
                onClick={() => setShowLoginModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-4">
              Enter your API client credentials to authenticate. Default credentials are pre-filled for convenience.
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client ID
                </label>
                <input
                  type="text"
                  value={loginClientId}
                  onChange={(e) => setLoginClientId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., vas-portal"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Client Secret
                </label>
                <input
                  type="password"
                  value={loginClientSecret}
                  onChange={(e) => setLoginClientSecret(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Your client secret"
                  required
                />
              </div>

              {loginError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{loginError}</p>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                  {isLoggingIn ? 'Authenticating...' : 'Login'}
                </button>
              </div>
            </form>

            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-700">
                <strong>For RuthAI Integration:</strong> Create a dedicated client via POST /v2/auth/clients
                with appropriate scopes. The returned client_secret is shown only once.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
