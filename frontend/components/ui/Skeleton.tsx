'use client';

import { HTMLAttributes } from 'react';

/**
 * Base Skeleton component with shimmer animation
 */
interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  className?: string;
  animate?: boolean;
}

export default function Skeleton({
  className = '',
  animate = true,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={`bg-gray-200 rounded ${animate ? 'animate-pulse' : ''} ${className}`}
      {...props}
    />
  );
}

/**
 * Text line skeleton
 */
interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

export function SkeletonText({ lines = 1, className = '' }: SkeletonTextProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-4 ${i === lines - 1 && lines > 1 ? 'w-3/4' : 'w-full'}`}
        />
      ))}
    </div>
  );
}

/**
 * Avatar/Circle skeleton
 */
interface SkeletonAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const avatarSizes = {
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
};

export function SkeletonAvatar({ size = 'md', className = '' }: SkeletonAvatarProps) {
  return <Skeleton className={`rounded-full ${avatarSizes[size]} ${className}`} />;
}

/**
 * Button skeleton
 */
interface SkeletonButtonProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const buttonSizes = {
  sm: 'h-8 w-20',
  md: 'h-10 w-24',
  lg: 'h-12 w-32',
};

export function SkeletonButton({ size = 'md', className = '' }: SkeletonButtonProps) {
  return <Skeleton className={`rounded-lg ${buttonSizes[size]} ${className}`} />;
}

/**
 * Card skeleton - matches Card component structure
 */
interface SkeletonCardProps {
  showHeader?: boolean;
  showFooter?: boolean;
  lines?: number;
  className?: string;
}

export function SkeletonCard({
  showHeader = true,
  showFooter = false,
  lines = 3,
  className = '',
}: SkeletonCardProps) {
  return (
    <div className={`bg-white shadow-sm rounded-lg border border-gray-200 ${className}`}>
      {showHeader && (
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48" />
            </div>
            <SkeletonButton size="sm" />
          </div>
        </div>
      )}
      <div className="p-6">
        <SkeletonText lines={lines} />
      </div>
      {showFooter && (
        <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
          <div className="flex gap-3">
            <SkeletonButton size="sm" />
            <SkeletonButton size="sm" />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Table row skeleton
 */
interface SkeletonTableRowProps {
  columns?: number;
  className?: string;
}

export function SkeletonTableRow({ columns = 5, className = '' }: SkeletonTableRowProps) {
  return (
    <tr className={`animate-pulse ${className}`}>
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-6 py-4">
          <Skeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

/**
 * Table skeleton with header and multiple rows
 */
interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({
  rows = 5,
  columns = 5,
  className = '',
}: SkeletonTableProps) {
  return (
    <div className={`bg-white shadow-sm rounded-lg border border-gray-200 overflow-hidden ${className}`}>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} className="px-6 py-3">
                <Skeleton className="h-3 w-20" />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {Array.from({ length: rows }).map((_, i) => (
            <SkeletonTableRow key={i} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Thumbnail/Image skeleton for grid displays
 */
interface SkeletonThumbnailProps {
  aspectRatio?: '16/9' | '4/3' | '1/1';
  className?: string;
}

export function SkeletonThumbnail({
  aspectRatio = '16/9',
  className = '',
}: SkeletonThumbnailProps) {
  return (
    <div
      className={`bg-white rounded-lg border border-gray-200 overflow-hidden ${className}`}
    >
      <Skeleton
        className="w-full"
        style={{ aspectRatio }}
      />
      <div className="p-3 space-y-2">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/**
 * Grid of thumbnail skeletons
 */
interface SkeletonGridProps {
  count?: number;
  columns?: 2 | 3 | 4 | 5;
  className?: string;
}

const gridColumns = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  5: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5',
};

export function SkeletonGrid({
  count = 8,
  columns = 4,
  className = '',
}: SkeletonGridProps) {
  return (
    <div className={`grid gap-4 ${gridColumns[columns]} ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonThumbnail key={i} />
      ))}
    </div>
  );
}

/**
 * Stats card skeleton
 */
export function SkeletonStatsCard({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-white shadow-sm rounded-lg border border-gray-200 p-6 ${className}`}>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-12 w-12 rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Dashboard stats grid skeleton
 */
export function SkeletonStatsGrid({ count = 4, className = '' }: { count?: number; className?: string }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonStatsCard key={i} />
      ))}
    </div>
  );
}

/**
 * Device/Stream list item skeleton
 */
export function SkeletonListItem({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-4 p-4 ${className}`}>
      <Skeleton className="h-12 w-12 rounded-lg" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
      <Skeleton className="h-6 w-16 rounded-full" />
    </div>
  );
}

/**
 * Page header skeleton
 */
export function SkeletonPageHeader({ className = '' }: { className?: string }) {
  return (
    <div className={`space-y-4 ${className}`}>
      <div className="flex items-center gap-2">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <SkeletonButton size="lg" />
      </div>
    </div>
  );
}
