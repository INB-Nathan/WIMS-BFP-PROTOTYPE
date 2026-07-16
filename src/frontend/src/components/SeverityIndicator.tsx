import React from 'react';
import {
  IconCircleFilled,
  IconTriangleFilled,
  IconOctagonFilled,
  IconAlertTriangleFilled,
} from '@tabler/icons-react';

export type SeverityLevel = 'low' | 'medium' | 'high' | 'critical';

interface SeverityIndicatorProps {
  level: SeverityLevel;
  size?: number;
  className?: string;
}

const severityConfig: Record<
  SeverityLevel,
  {
    Icon: React.ComponentType<{
      size?: number;
      className?: string;
      style?: React.CSSProperties;
      'aria-label'?: string;
      role?: string;
    }>;
    color: string;
    label: string;
  }
> = {
  low: {
    Icon: IconCircleFilled,
    color: '#059669',
    label: 'Low severity',
  },
  medium: {
    Icon: IconTriangleFilled,
    color: '#d97706',
    label: 'Medium severity',
  },
  high: {
    Icon: IconOctagonFilled,
    color: '#ea580c',
    label: 'High severity',
  },
  critical: {
    Icon: IconAlertTriangleFilled,
    color: '#dc2626',
    label: 'Critical severity',
  },
};

export function SeverityIndicator({ level, size = 24, className = '' }: SeverityIndicatorProps) {
  const config = severityConfig[level] ?? severityConfig.low;
  const { Icon, color, label } = config;

  return (
    <Icon
      size={size}
      className={className}
      style={{ color }}
      aria-label={label}
      role="img"
    />
  );
}

export default SeverityIndicator;
