"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useProjectContext } from "@/contexts";
import { SourceProjectFilter } from "@/components/issues";
import { useUrlState } from "@/hooks";

const coreNavItems = [
  { href: "/", label: "Board" },
  { href: "/issues", label: "Issues" },
  { href: "/milestones", label: "Milestones" },
];

const systemNavItems = [
  { href: "/worktrees", label: "Worktrees" },
  { href: "/workers", label: "Workers" },
];

export function Nav() {
  const pathname = usePathname();
  const { projectId, setProjectId, sourceId, setSourceId, sources, projects } = useProjectContext();
  const { state, setProperty } = useUrlState();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Get pinned items from URL state
  const pinnedHrefs = state.pinnedNavItems ?? [];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const togglePin = (href: string) => {
    const newPinned = pinnedHrefs.includes(href)
      ? pinnedHrefs.filter((h) => h !== href)
      : [...pinnedHrefs, href];
    // Store empty array as undefined to keep URL clean
    setProperty("pinnedNavItems", newPinned.length > 0 ? newPinned : undefined);
  };

  const pinnedSystemItems = systemNavItems.filter((item) => pinnedHrefs.includes(item.href));

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link
            href="/"
            className="text-lg font-semibold text-gray-800 hover:text-gray-600 transition-colors"
          >
            Dev Workflow
          </Link>
          <SourceProjectFilter
            sources={sources}
            projects={projects}
            sourceId={sourceId}
            projectId={projectId}
            onSourceChange={setSourceId}
            onProjectChange={setProjectId}
          />
        </div>
        <nav className="flex items-center gap-1">
          {/* Core nav items */}
          {coreNavItems.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} pathname={pathname} />
          ))}

          {/* Pinned system items */}
          {pinnedSystemItems.map((item) => (
            <NavLink key={item.href} href={item.href} label={item.label} pathname={pathname} />
          ))}

          {/* System dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className={clsx(
                "px-2 py-2 rounded text-sm font-medium transition-colors flex items-center gap-1",
                isDropdownOpen
                  ? "bg-gray-100 text-gray-800"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
              )}
              aria-label="System menu"
            >
              <GearIcon />
              <ChevronDownIcon />
            </button>

            {isDropdownOpen && (
              <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  System
                </div>
                {systemNavItems.map((item) => {
                  const isPinned = pinnedHrefs.includes(item.href);
                  const isActive = pathname.startsWith(item.href);

                  return (
                    <div key={item.href} className="flex items-center px-2 py-1 hover:bg-gray-50">
                      <button
                        onClick={() => togglePin(item.href)}
                        className="p-1 mr-1 rounded hover:bg-gray-200"
                        aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                      >
                        {isPinned ? (
                          <PinFilledIcon className="w-4 h-4 text-blue-600" />
                        ) : (
                          <PinOutlineIcon className="w-4 h-4 text-gray-400" />
                        )}
                      </button>
                      <Link
                        href={item.href}
                        onClick={() => setIsDropdownOpen(false)}
                        className={clsx(
                          "flex-1 px-2 py-1 rounded text-sm transition-colors",
                          isActive
                            ? "text-blue-600 font-medium"
                            : "text-gray-700 hover:text-gray-900"
                        )}
                      >
                        {item.label}
                      </Link>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}

interface NavLinkProps {
  href: string;
  label: string;
  pathname: string;
}

function NavLink({ href, label, pathname }: NavLinkProps) {
  const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <Link
      href={href}
      className={clsx(
        "px-3 py-2 rounded text-sm font-medium transition-colors",
        isActive
          ? "bg-blue-50 text-blue-600"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
      )}
    >
      {label}
    </Link>
  );
}

function GearIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function PinFilledIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
    </svg>
  );
}

function PinOutlineIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
      />
    </svg>
  );
}
