'use client';

import React from 'react';

/**
 * IconPark outline（用户选定 · MIT）
 * 画布底栏工具：MoveOne / HandDrag / Plus / Minus / AlignmentHorizontalCenter
 * 统一：48 视口 · stroke 4 · round · currentColor
 * 官网：https://iconpark.oceanengine.com/
 */

type IpProps = {
  className?: string;
  size?: number | string;
};

function IpIcon({ className, size = '1em', children }: IpProps & { children: React.ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** MoveOne · 指针 */
export function IpPointer({ className, size }: IpProps) {
  return (
    <IpIcon className={className} size={size}>
      <path d="M8 6 43 25 24 27 13.9948 44 8 6Z" />
    </IpIcon>
  );
}

/** HandDrag · 抓手 */
export function IpHand({ className, size }: IpProps) {
  return (
    <IpIcon className={className} size={size}>
      <path d="M10.9814 29.4453V7.66246C10.9814 5.88568 12.4218 4.44531 14.1986 4.44531C15.9754 4.44531 17.4157 5.88568 17.4157 7.66246V23.6479" />
      <path d="M17.4155 24.0001V19.8076C17.4155 18.2589 18.671 17.0034 20.2197 17.0034C21.7684 17.0034 23.0239 18.2589 23.0239 19.8076V24.4272" />
      <path d="M23 24.6583V21.8076C23 20.2589 24.2555 19.0034 25.8042 19.0034C27.3529 19.0034 28.6084 20.2589 28.6084 21.8076V25.0034" />
      <path d="M9.58303 27.1824C7.86719 28.3542 7.00928 30.2934 7.00928 33.0002C7.00928 37.0602 12.0001 44.0002 16.5006 44.0002C21.001 44.0002 23.6111 44.0002 28.016 44.0002C32.421 44.0002 35.0965 40.1495 35.0965 37.0602C35.0965 32.9069 35.0965 28.7536 35.0965 24.6002C35.0965 22.8072 33.6456 21.3522 31.8525 21.3472C30.0659 21.3422 28.6135 22.7865 28.6085 24.5731C28.6085 24.5761 28.6085 24.5791 28.6085 24.5821V24.6836" />
    </IpIcon>
  );
}

export function IpPlus({ className, size }: IpProps) {
  return (
    <IpIcon className={className} size={size}>
      <path d="M24.0605 10 24.0239 38" />
      <path d="M10 24H38" />
    </IpIcon>
  );
}

export function IpMinus({ className, size }: IpProps) {
  return (
    <IpIcon className={className} size={size}>
      <path d="M10.5 24H38.5" />
    </IpIcon>
  );
}

export function IpTidy({ className, size }: IpProps) {
  return (
    <IpIcon className={className} size={size}>
      <rect x="6" y="6" width="36" height="36" rx="3" />
      <path d="M22 30H26" />
      <path d="M18 24H30" />
      <path d="M20 18H28" />
    </IpIcon>
  );
}
