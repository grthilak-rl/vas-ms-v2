'use client';

import { forwardRef, SelectHTMLAttributes } from 'react';

export type SelectSize = 'sm' | 'md' | 'lg';

interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  selectSize?: SelectSize;
  error?: boolean;
  errorMessage?: string;
  fullWidth?: boolean;
  options?: SelectOption[];
  placeholder?: string;
}

const sizeStyles: Record<SelectSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
  lg: 'px-4 py-3 text-base',
};

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      selectSize = 'md',
      error = false,
      errorMessage,
      fullWidth = false,
      options,
      placeholder,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles = 'border rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-0 transition-colors appearance-none bg-white bg-no-repeat';
    const normalStyles = 'border-gray-300 focus:ring-blue-500 focus:border-blue-500 text-gray-900';
    const errorStyles = 'border-red-300 focus:ring-red-500 focus:border-red-500 text-gray-900';
    const disabledStyles = 'disabled:bg-gray-100 disabled:text-gray-500 disabled:cursor-not-allowed';

    // Add custom dropdown arrow using CSS
    const arrowStyles = `bg-[url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")] bg-[length:1.5em_1.5em] bg-[right_0.5rem_center] pr-10`;

    return (
      <div className={fullWidth ? 'w-full' : ''}>
        <select
          ref={ref}
          className={`${baseStyles} ${error ? errorStyles : normalStyles} ${disabledStyles} ${sizeStyles[selectSize]} ${arrowStyles} ${fullWidth ? 'w-full' : ''} ${className}`}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  {option.label}
                </option>
              ))
            : children}
        </select>
        {error && errorMessage && (
          <p className="mt-1 text-sm text-red-600">{errorMessage}</p>
        )}
      </div>
    );
  }
);

Select.displayName = 'Select';

export default Select;
