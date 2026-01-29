'use client';

import NextImage, { ImageProps as NextImageProps } from 'next/image';
import { useState, ImgHTMLAttributes } from 'react';

/**
 * Optimized Image component that:
 * - Uses next/image for static assets (better caching, lazy loading, formats)
 * - Falls back to native <img> for blob URLs (which next/image doesn't support)
 * - Provides consistent loading states and error handling
 */

interface OptimizedImageProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  className?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  priority?: boolean;
  placeholder?: 'blur' | 'empty';
  blurDataURL?: string;
  onLoad?: () => void;
  onError?: () => void;
}

export default function OptimizedImage({
  src,
  alt,
  width,
  height,
  fill = false,
  className = '',
  objectFit = 'cover',
  priority = false,
  placeholder,
  blurDataURL,
  onLoad,
  onError,
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Check if it's a blob URL (can't use next/image for these)
  const isBlobUrl = src.startsWith('blob:');
  const isDataUrl = src.startsWith('data:');
  const isExternalUrl = src.startsWith('http://') || src.startsWith('https://');

  const handleLoad = () => {
    setIsLoading(false);
    onLoad?.();
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
    onError?.();
  };

  // Use native img for blob URLs and data URLs
  if (isBlobUrl || isDataUrl) {
    return (
      <img
        src={src}
        alt={alt}
        className={className}
        style={{
          objectFit,
          width: fill ? '100%' : width,
          height: fill ? '100%' : height,
        }}
        onLoad={handleLoad}
        onError={handleError}
      />
    );
  }

  // Use next/image for everything else
  if (fill) {
    return (
      <NextImage
        src={src}
        alt={alt}
        fill
        className={className}
        style={{ objectFit }}
        priority={priority}
        placeholder={placeholder}
        blurDataURL={blurDataURL}
        onLoad={handleLoad}
        onError={handleError}
      />
    );
  }

  return (
    <NextImage
      src={src}
      alt={alt}
      width={width || 100}
      height={height || 100}
      className={className}
      style={{ objectFit }}
      priority={priority}
      placeholder={placeholder}
      blurDataURL={blurDataURL}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}

/**
 * Thumbnail Image component for grid displays
 * Optimized for 16:9 aspect ratio thumbnails with loading states
 */
interface ThumbnailImageProps {
  src: string | null;
  alt: string;
  isLoading?: boolean;
  onClick?: () => void;
  className?: string;
  fallbackIcon?: React.ReactNode;
}

export function ThumbnailImage({
  src,
  alt,
  isLoading = false,
  onClick,
  className = '',
  fallbackIcon,
}: ThumbnailImageProps) {
  const [imageError, setImageError] = useState(false);
  const [imageLoading, setImageLoading] = useState(true);

  const showFallback = !src || imageError || isLoading;

  return (
    <div
      className={`relative overflow-hidden bg-gray-900 ${onClick ? 'cursor-pointer' : ''} ${className}`}
      style={{ aspectRatio: '16/9' }}
      onClick={onClick}
    >
      {showFallback ? (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
          {isLoading ? (
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2" />
              <span className="text-xs text-gray-400">Loading...</span>
            </div>
          ) : (
            fallbackIcon || (
              <div className="w-12 h-12 text-gray-500">
                <svg fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
              </div>
            )
          )}
        </div>
      ) : (
        <>
          {imageLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 z-10">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
            </div>
          )}
          <img
            src={src}
            alt={alt}
            className="w-full h-full object-cover"
            onLoad={() => setImageLoading(false)}
            onError={() => setImageError(true)}
          />
        </>
      )}
    </div>
  );
}

/**
 * Avatar Image component
 * Circular image with fallback to initials
 */
interface AvatarImageProps {
  src?: string | null;
  alt: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const avatarSizes = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

export function AvatarImage({
  src,
  alt,
  name,
  size = 'md',
  className = '',
}: AvatarImageProps) {
  const [imageError, setImageError] = useState(false);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  if (!src || imageError) {
    return (
      <div
        className={`rounded-full bg-blue-600 flex items-center justify-center text-white font-medium ${avatarSizes[size]} ${className}`}
      >
        {name ? getInitials(name) : alt.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`rounded-full object-cover ${avatarSizes[size]} ${className}`}
      onError={() => setImageError(true)}
    />
  );
}
