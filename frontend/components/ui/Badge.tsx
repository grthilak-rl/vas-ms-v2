'use client';

import { HTMLAttributes } from 'react';

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple';
export type BadgeSize = 'sm' | 'md';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  dotAnimate?: boolean;
  children: React.ReactNode;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-100 text-gray-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  error: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
  purple: 'bg-purple-100 text-purple-800',
};

const solidVariantStyles: Record<BadgeVariant, string> = {
  default: 'bg-gray-600 text-white',
  success: 'bg-green-600 text-white',
  warning: 'bg-yellow-600 text-white',
  error: 'bg-red-600 text-white',
  info: 'bg-blue-600 text-white',
  purple: 'bg-purple-600 text-white',
};

const dotColors: Record<BadgeVariant, string> = {
  default: 'bg-gray-500',
  success: 'bg-green-500',
  warning: 'bg-yellow-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
  purple: 'bg-purple-500',
};

const sizeStyles: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
};

export default function Badge({
  variant = 'default',
  size = 'sm',
  dot = false,
  dotAnimate = false,
  className = '',
  children,
  ...props
}: BadgeProps) {
  const baseStyles = 'inline-flex items-center gap-1.5 font-medium rounded-full';

  return (
    <span
      className={`${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {dot && (
        <span
          className={`w-2 h-2 rounded-full ${dotColors[variant]} ${dotAnimate ? 'animate-pulse' : ''}`}
        />
      )}
      {children}
    </span>
  );
}

// Specialized badge for stream/device status
export type StatusType = 'active' | 'inactive' | 'starting' | 'error' | 'live';

interface StatusBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  status: StatusType;
  size?: BadgeSize;
}

const statusConfig: Record<StatusType, { label: string; variant: BadgeVariant; dot: boolean; dotAnimate: boolean }> = {
  active: { label: 'Active', variant: 'success', dot: true, dotAnimate: false },
  inactive: { label: 'Inactive', variant: 'default', dot: false, dotAnimate: false },
  starting: { label: 'Starting...', variant: 'warning', dot: true, dotAnimate: true },
  error: { label: 'Error', variant: 'error', dot: true, dotAnimate: false },
  live: { label: 'Live', variant: 'error', dot: true, dotAnimate: true },
};

export function StatusBadge({ status, size = 'sm', className = '', ...props }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge
      variant={config.variant}
      size={size}
      dot={config.dot}
      dotAnimate={config.dotAnimate}
      className={className}
      {...props}
    >
      {config.label}
    </Badge>
  );
}

// Specialized badge for bookmark/snapshot source
export type SourceType = 'live' | 'historical' | 'ai_generated';

interface SourceBadgeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  source: SourceType;
  size?: BadgeSize;
  solid?: boolean;
}

export function SourceBadge({ source, size = 'sm', solid = true, className = '', ...props }: SourceBadgeProps) {
  const baseStyles = 'inline-flex items-center gap-1.5 font-medium rounded-lg shadow-lg';

  const sourceConfig: Record<SourceType, { label: string; bgColor: string; dotAnimate: boolean }> = {
    live: { label: 'Live', bgColor: 'bg-red-600 text-white', dotAnimate: true },
    historical: { label: 'Historical', bgColor: 'bg-blue-600 text-white', dotAnimate: false },
    ai_generated: { label: 'AI Generated', bgColor: 'bg-purple-600 text-white', dotAnimate: false },
  };

  const config = sourceConfig[source];
  const sizeClass = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-2.5 py-1.5 text-xs';

  return (
    <span
      className={`${baseStyles} ${config.bgColor} ${sizeClass} ${className}`}
      {...props}
    >
      {source !== 'ai_generated' && (
        <span className={`w-2 h-2 bg-white rounded-full ${config.dotAnimate ? 'animate-pulse' : ''}`} />
      )}
      {source === 'ai_generated' && (
        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
          <path d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" />
        </svg>
      )}
      {config.label}
    </span>
  );
}
