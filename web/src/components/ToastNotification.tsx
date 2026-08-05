import React from 'react';

export interface ToastState {
  message: string;
  type?: 'success' | 'error' | 'info';
}

interface ToastProps {
  toast: ToastState | null;
  onClose?: () => void;
}

export function ToastNotification({ toast, onClose }: ToastProps) {
  if (!toast) return null;

  const bgColor = toast.type === 'error' ? '#991b1b' : toast.type === 'info' ? '#1e3a8a' : '#14532d';
  const borderColor = toast.type === 'error' ? '#ef4444' : toast.type === 'info' ? '#3b82f6' : '#22c55e';
  const icon = toast.type === 'error' ? '✕' : toast.type === 'info' ? 'ℹ' : '✓';

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 99999,
        backgroundColor: bgColor,
        border: `1px solid ${borderColor}`,
        color: '#ffffff',
        padding: '10px 16px',
        borderRadius: '6px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: '13px',
        fontWeight: 500,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        maxWidth: '480px',
        wordBreak: 'break-word',
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <span style={{ fontSize: '15px', fontWeight: 'bold' }}>{icon}</span>
      <span style={{ flex: 1, lineHeight: '1.4' }}>{toast.message}</span>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#a1a1aa',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '2px 4px',
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
