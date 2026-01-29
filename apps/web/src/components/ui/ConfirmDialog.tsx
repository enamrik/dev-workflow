"use client";

import { useEffect, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

interface ConfirmDialogProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  isLoading?: boolean;
}

/**
 * ConfirmDialog - Modal dialog for confirming destructive or irreversible actions
 *
 * Usage:
 * ```tsx
 * <ConfirmDialog
 *   isOpen={showConfirm}
 *   onConfirm={handleDelete}
 *   onCancel={() => setShowConfirm(false)}
 *   title="Delete Issue"
 *   message="Are you sure you want to delete this issue? This cannot be undone."
 *   confirmLabel="Delete"
 *   variant="danger"
 * />
 * ```
 */
export function ConfirmDialog({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  isLoading = false,
}: ConfirmDialogProps) {
  // Close on Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        onCancel();
      }
    },
    [onCancel, isLoading]
  );

  useEffect(() => {
    if (!isOpen) return;

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleKeyDown]);

  // Prevent body scroll when dialog is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const variantStyles = {
    danger: {
      icon: "text-red-600 bg-red-100",
      button: "bg-red-600 hover:bg-red-700 focus:ring-red-500",
    },
    warning: {
      icon: "text-amber-600 bg-amber-100",
      button: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-500",
    },
    default: {
      icon: "text-blue-600 bg-blue-100",
      button: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-500",
    },
  };

  const styles = variantStyles[variant];

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
        onClick={!isLoading ? onCancel : undefined}
        aria-hidden="true"
      />
      {/* Dialog */}
      <div
        className="fixed z-50 left-4 right-4 top-1/2 -translate-y-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:w-full sm:max-w-md"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="bg-white rounded-xl shadow-2xl border border-gray-200 p-6">
          {/* Icon and title */}
          <div className="flex items-start gap-4">
            {/* Warning icon */}
            <div
              className={clsx(
                "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center",
                styles.icon
              )}
            >
              {variant === "danger" ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>

            <div className="flex-1">
              <h3 id="confirm-dialog-title" className="text-lg font-semibold text-gray-900">
                {title}
              </h3>
              <div id="confirm-dialog-message" className="mt-2 text-sm text-gray-600">
                {message}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className={clsx(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                "text-gray-700 bg-gray-100 hover:bg-gray-200",
                "focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2",
                isLoading && "opacity-50 cursor-not-allowed"
              )}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isLoading}
              className={clsx(
                "px-4 py-2 text-sm font-medium rounded-lg transition-colors",
                "text-white",
                styles.button,
                "focus:outline-none focus:ring-2 focus:ring-offset-2",
                isLoading && "opacity-50 cursor-wait"
              )}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  {confirmLabel}
                </span>
              ) : (
                confirmLabel
              )}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}
