'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  HomeIcon,
  CameraIcon,
  FilmIcon,
  PhotoIcon,
  Bars3BottomLeftIcon,
} from '@heroicons/react/24/outline';
import {
  HomeIcon as HomeIconSolid,
  CameraIcon as CameraIconSolid,
  FilmIcon as FilmIconSolid,
  PhotoIcon as PhotoIconSolid,
} from '@heroicons/react/24/solid';

// Primary navigation items for bottom tabs (limited to 5 for mobile)
const bottomNavItems = [
  { name: 'Home', href: '/', icon: HomeIcon, iconActive: HomeIconSolid },
  { name: 'Devices', href: '/devices', icon: CameraIcon, iconActive: CameraIconSolid },
  { name: 'Streams', href: '/streams', icon: FilmIcon, iconActive: FilmIconSolid },
  { name: 'Snapshots', href: '/snapshots', icon: PhotoIcon, iconActive: PhotoIconSolid },
  { name: 'More', href: '#more', icon: Bars3BottomLeftIcon, iconActive: Bars3BottomLeftIcon },
];

interface MobileBottomNavProps {
  onMoreClick?: () => void;
}

export default function MobileBottomNav({ onMoreClick }: MobileBottomNavProps) {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 z-50 safe-area-bottom">
      <div className="flex items-center justify-around h-16">
        {bottomNavItems.map((item) => {
          const isMore = item.href === '#more';
          const isActive = !isMore && (
            pathname === item.href ||
            (item.href !== '/' && pathname?.startsWith(item.href))
          );
          const Icon = isActive ? item.iconActive : item.icon;

          if (isMore) {
            return (
              <button
                key={item.name}
                onClick={onMoreClick}
                className="flex flex-col items-center justify-center flex-1 h-full text-gray-500 hover:text-gray-700 transition-colors"
              >
                <Icon className="h-6 w-6" />
                <span className="text-xs mt-1">{item.name}</span>
              </button>
            );
          }

          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                isActive
                  ? 'text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <Icon className="h-6 w-6" />
              <span className="text-xs mt-1">{item.name}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
