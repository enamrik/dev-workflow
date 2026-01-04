"use client";

import React, { useState, useEffect, useRef, useCallback, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

interface ModalProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  maxHeight?: number;
}

export function Modal({
  trigger,
  children,
  className,
  contentClassName,
  maxHeight = 500,
}: ModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  }, []);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  // Prevent body scroll when modal is open
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

  return (
    <>
      <div
        ref={triggerRef}
        onClick={handleToggle}
        className={clsx("cursor-pointer", className)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            handleToggle(e as unknown as React.MouseEvent);
          }
        }}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        {trigger}
      </div>
      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
              onClick={handleClose}
              aria-hidden="true"
            />
            {/* Modal */}
            <div
              ref={contentRef}
              className={clsx(
                "fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
                "w-full max-w-lg",
                "bg-white rounded-xl shadow-2xl border border-gray-200",
                contentClassName
              )}
              style={{ maxHeight }}
              role="dialog"
              aria-modal="true"
            >
              <div className="overflow-y-auto scrollbar-auto-hide" style={{ maxHeight }}>
                {children}
              </div>
            </div>
          </>,
          document.body
        )}
    </>
  );
}
