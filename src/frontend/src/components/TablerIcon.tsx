import React from 'react';
import type { Icon as TablerIcon } from '@tabler/icons-react';

interface TablerIconProps {
  icon: TablerIcon;
  size?: number;
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean;
}

/**
 * Wrapper component for Tabler filled icons.
 * Uses `currentColor` for theming — set text color on parent or pass className.
 */
export function TablerIconWrapper({
  icon: Icon,
  size = 20,
  className = '',
  'aria-label': ariaLabel,
  'aria-hidden': ariaHidden,
}: TablerIconProps) {
  if (!Icon) return null;

  return (
    <Icon
      size={size}
      className={className}
      aria-label={ariaLabel}
      aria-hidden={ariaHidden}
      role={ariaLabel ? 'img' : undefined}
    />
  );
}

export default TablerIconWrapper;
