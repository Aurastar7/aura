import React from 'react';
import { User } from '../types';

interface RoleBadgeProps {
  user: User;
  className?: string;
}

const roleMeta = (user: User): { label: string; color: string } | null => {
  if (user.role === 'admin') {
    return { label: 'Администратор', color: 'text-sky-500' };
  }
  if (user.role === 'moderator') {
    return { label: 'Модератор', color: 'text-orange-500' };
  }
  if (user.role === 'curator') {
    return { label: 'Куратор', color: 'text-emerald-500' };
  }
  if (user.verified) {
    return { label: 'Подтвержденный', color: 'text-sky-500' };
  }
  return null;
};

const RoleBadge: React.FC<RoleBadgeProps> = ({ user, className = '' }) => {
  const meta = roleMeta(user);
  if (!meta) return null;

  return (
    <span
      title={meta.label}
      aria-label={meta.label}
      className={`inline-flex items-center ${meta.color} ${className}`}
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 1.5 12.4 4l3.4-.3 1.1 3.2 3 1.7-1.7 3 1.7 3-3 1.7-1.1 3.2-3.4-.3L10 18.5 7.6 16l-3.4.3-1.1-3.2-3-1.7 1.7-3-1.7-3 3-1.7L4.2 3.7 7.6 4 10 1.5Zm3.2 6.7-3.9 3.9-2.5-2.4-1.1 1.1 3.6 3.6 5-5-1.1-1.2Z" />
      </svg>
    </span>
  );
};

export default RoleBadge;
