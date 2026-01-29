'use client';

import { forwardRef, InputHTMLAttributes } from 'react';

export type InputSize = 'sm' | 'md' | 'lg';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  inputSize?: InputSize;
  error?: boolean;
  errorMessage?: string;
  fullWidth?: boolean;
}

const sizeStyles: Record<InputSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-3 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
};

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      inputSize = 'md',
      error = false,
      errorMessage,
      fullWidth = true,
      className = '',
      type = 'text',
      ...props
    },
    ref
  ) => {
    const baseStyles = 'border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors';
    const normalStyles = 'border-gray-300 focus:ring-blue-500 focus:border-blue-500 text-gray-900 placeholder-gray-400';
    const errorStyles = 'border-red-300 focus:ring-red-500 focus:border-red-500 text-gray-900';
    const disabledStyles = 'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed';

    return (
      <div className={fullWidth ? 'w-full' : ''}>
        <input
          ref={ref}
          type={type}
          className={`${baseStyles} ${error ? errorStyles : normalStyles} ${disabledStyles} ${sizeStyles[inputSize]} ${fullWidth ? 'w-full' : ''} ${className}`}
          {...props}
        />
        {error && errorMessage && (
          <p className="mt-1 text-sm text-red-600">{errorMessage}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';

export default Input;

// Monospace variant for URLs, code, etc.
export const MonoInput = forwardRef<HTMLInputElement, InputProps>(
  (props, ref) => {
    return <Input ref={ref} {...props} className={`font-mono ${props.className || ''}`} />;
  }
);

MonoInput.displayName = 'MonoInput';
