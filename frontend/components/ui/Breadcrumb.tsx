'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRightIcon, HomeIcon } from '@heroicons/react/24/outline';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items?: BreadcrumbItem[];
  showHome?: boolean;
  className?: string;
}

// Route label mappings for auto-generation
const routeLabels: Record<string, string> = {
  '': 'Dashboard',
  'devices': 'Devices',
  'streams': 'Streams',
  'snapshots': 'Snapshots',
  'bookmarks': 'Bookmarks',
  'analytics': 'Analytics',
  'settings': 'Settings',
};

export default function Breadcrumb({
  items,
  showHome = true,
  className = '',
}: BreadcrumbProps) {
  const pathname = usePathname();

  // Auto-generate breadcrumbs from pathname if items not provided
  const breadcrumbItems: BreadcrumbItem[] = items || generateBreadcrumbs(pathname);

  if (breadcrumbItems.length === 0 && !showHome) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb" className={`flex items-center ${className}`}>
      <ol className="flex items-center space-x-1 text-sm">
        {showHome && (
          <li className="flex items-center">
            <Link
              href="/"
              className="text-gray-500 hover:text-gray-700 transition-colors"
              aria-label="Home"
            >
              <HomeIcon className="h-4 w-4" />
            </Link>
          </li>
        )}

        {breadcrumbItems.map((item, index) => {
          const isLast = index === breadcrumbItems.length - 1;

          return (
            <li key={index} className="flex items-center">
              <ChevronRightIcon className="h-4 w-4 text-gray-400 mx-1 flex-shrink-0" />
              {isLast || !item.href ? (
                <span className="text-gray-900 font-medium truncate max-w-[200px]">
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className="text-gray-500 hover:text-gray-700 transition-colors truncate max-w-[200px]"
                >
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function generateBreadcrumbs(pathname: string | null): BreadcrumbItem[] {
  if (!pathname || pathname === '/') {
    return [];
  }

  const segments = pathname.split('/').filter(Boolean);
  const items: BreadcrumbItem[] = [];
  let currentPath = '';

  segments.forEach((segment, index) => {
    currentPath += `/${segment}`;
    const isLast = index === segments.length - 1;

    // Check if it's a UUID (dynamic route parameter)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
    const isShortId = /^[0-9a-f]{8}$/i.test(segment);

    let label = routeLabels[segment] || segment;

    // For UUIDs, show truncated version
    if (isUuid) {
      label = `${segment.substring(0, 8)}...`;
    } else if (isShortId) {
      label = segment;
    } else {
      // Capitalize first letter if not in routeLabels
      label = routeLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1);
    }

    items.push({
      label,
      href: isLast ? undefined : currentPath,
    });
  });

  return items;
}

// Page header component with breadcrumb integration
interface PageHeaderProps {
  title: string;
  description?: string;
  breadcrumbItems?: BreadcrumbItem[];
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbItems,
  actions,
  className = '',
}: PageHeaderProps) {
  return (
    <div className={`space-y-4 ${className}`}>
      <Breadcrumb items={breadcrumbItems} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">{title}</h1>
          {description && (
            <p className="mt-1 sm:mt-2 text-sm sm:text-base text-gray-600">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex-shrink-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
