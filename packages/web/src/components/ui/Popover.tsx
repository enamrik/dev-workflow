"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { clsx } from "clsx";

interface PopoverProps {
  trigger: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  maxHeight?: number;
}

export function Popover({
  trigger,
  children,
  className,
  contentClassName,
  maxHeight = 400,
}: PopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const rect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Default: position below trigger, centered horizontally
    let top = rect.bottom + 8;
    let left = rect.left + rect.width / 2;

    // Adjust if popover would go off right edge (assume ~320px content width)
    const contentWidth = 320;
    if (left + contentWidth / 2 > viewportWidth - 16) {
      left = viewportWidth - contentWidth / 2 - 16;
    }
    if (left - contentWidth / 2 < 16) {
      left = contentWidth / 2 + 16;
    }

    // If would go off bottom, position above trigger instead
    if (top + maxHeight > viewportHeight - 16) {
      top = rect.top - 8;
    }

    setPosition({ top, left });
  }, [maxHeight]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isOpen) {
        updatePosition();
      }
      setIsOpen((prev) => !prev);
    },
    [isOpen, updatePosition]
  );

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

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        contentRef.current &&
        !contentRef.current.contains(target)
      ) {
        handleClose();
      }
    };

    // Use setTimeout to avoid immediately closing from the same click
    const timeoutId = setTimeout(() => {
      document.addEventListener("click", handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener("click", handleClickOutside);
    };
  }, [isOpen, handleClose]);

  // Update position on scroll/resize
  useEffect(() => {
    if (!isOpen) return;

    const handlePositionUpdate = () => updatePosition();

    window.addEventListener("scroll", handlePositionUpdate, true);
    window.addEventListener("resize", handlePositionUpdate);

    return () => {
      window.removeEventListener("scroll", handlePositionUpdate, true);
      window.removeEventListener("resize", handlePositionUpdate);
    };
  }, [isOpen, updatePosition]);

  const positionAbove = position.top < 100; // Rough check for above positioning

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
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        {trigger}
      </div>
      {isOpen &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={contentRef}
            className={clsx(
              "fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200",
              "transform -translate-x-1/2",
              positionAbove && "-translate-y-full",
              contentClassName
            )}
            style={{
              top: position.top,
              left: position.left,
              maxHeight,
              width: 320,
            }}
            role="dialog"
            aria-modal="true"
          >
            <div className="overflow-y-auto" style={{ maxHeight }}>
              {children}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
