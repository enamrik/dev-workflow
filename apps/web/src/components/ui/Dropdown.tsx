"use client";

import { useState, useRef, useEffect } from "react";
import { clsx } from "clsx";

interface DropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: "left" | "right";
}

export function Dropdown({ trigger, children, align = "right" }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="p-1.5 rounded-md hover:bg-gray-100 transition-colors text-gray-500 hover:text-gray-700"
      >
        {trigger}
      </button>

      {isOpen && (
        <div
          className={clsx(
            "absolute top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-2 min-w-[220px] z-20 whitespace-nowrap",
            align === "right" ? "right-0" : "left-0"
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

interface DropdownItemProps {
  children: React.ReactNode;
  onClick?: () => void;
}

export function DropdownItem({ children, onClick }: DropdownItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors"
    >
      {children}
    </button>
  );
}

interface DropdownToggleProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function DropdownToggle({ label, checked, onChange }: DropdownToggleProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50 transition-colors flex items-center justify-between gap-2"
    >
      <span>{label}</span>
      <span
        className={clsx(
          "w-4 h-4 rounded border flex items-center justify-center transition-colors",
          checked ? "bg-blue-600 border-blue-600 text-white" : "border-gray-300 bg-white"
        )}
      >
        {checked && (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>
    </button>
  );
}
