"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useProjectContext } from "@/contexts";
import { useUrlState } from "@/hooks";

const coreNavItems = [
  { href: "/", label: "Board" },
  { href: "/issues", label: "Issues" },
  { href: "/milestones", label: "Milestones" },
];

const systemNavItems = [
  { href: "/worktrees", label: "Worktrees" },
  { href: "/workers", label: "Workers" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname();
  const { projectId, setProjectId, allProjects } = useProjectContext();
  const { state, setProperty } = useUrlState();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isMobileSystemExpanded, setIsMobileSystemExpanded] = useState(false);
  const [isMobileContextExpanded, setIsMobileContextExpanded] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);

  // Get pinned items from URL state
  const pinnedHrefs = state.pinnedNavItems ?? [];

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
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

  // Get current project name for the context badge
  const currentProject = allProjects.find((p) => p.id === projectId);
  const contextLabel = currentProject?.name || "All Projects";

  // GitHub links for the selected project
  const githubRepoUrl = currentProject?.githubSync?.repoUrl;
  const githubProjectUrl = currentProject?.githubSync?.projectUrl;

  return (
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex flex-col">
          <Link
            href="/"
            className="text-lg font-semibold text-gray-800 hover:text-gray-600 transition-colors whitespace-nowrap"
          >
            Dev Workflow
          </Link>
          {/* Context pill with project name and GitHub links */}
          <div className="flex items-center border border-gray-200 rounded-full bg-gray-50 divide-x divide-gray-200">
            <span className="px-2 py-0.5 text-xs text-gray-600">{contextLabel}</span>
            {githubRepoUrl && (
              <a
                href={githubRepoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-gray-100 transition-colors"
              >
                <GitHubIcon className="w-3 h-3" />
                <span>Repo</span>
              </a>
            )}
            {githubProjectUrl && (
              <a
                href={githubProjectUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs text-blue-600 hover:text-blue-800 hover:bg-gray-100 transition-colors"
              >
                <ProjectIcon className="w-3 h-3" />
                <span>Board</span>
              </a>
            )}
          </div>
        </div>

        {/* Desktop nav */}
        <nav className="hidden sm:flex items-center gap-1">
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
              <div className="absolute right-0 mt-1 w-56 bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50">
                {/* Project selection */}
                {allProjects.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Project
                    </div>
                    <div className="px-3 py-2">
                      <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">All projects</option>
                        {allProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="border-t border-gray-200 my-1" />
                  </>
                )}

                {/* System section */}
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

        {/* Mobile hamburger button */}
        <div className="sm:hidden" ref={mobileMenuRef}>
          <button
            onClick={() => {
              setIsMobileMenuOpen(!isMobileMenuOpen);
              // Reset collapsible sections when opening menu
              if (!isMobileMenuOpen) {
                setIsMobileSystemExpanded(false);
                setIsMobileContextExpanded(false);
              }
            }}
            className="p-2 rounded text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-colors"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>

          {/* Mobile menu dropdown */}
          {isMobileMenuOpen && (
            <div className="absolute right-0 top-14 left-0 mx-4 bg-white rounded-md shadow-lg border border-gray-200 py-2 z-50">
              {/* Core nav items */}
              <div className="py-2">
                {coreNavItems.map((item) => {
                  const isActive =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={clsx(
                        "block px-4 py-3 text-base font-medium transition-colors",
                        isActive ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}

                {/* Pinned system items appear here */}
                {pinnedSystemItems.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setIsMobileMenuOpen(false)}
                      className={clsx(
                        "block px-4 py-3 text-base font-medium transition-colors",
                        isActive ? "bg-blue-50 text-blue-600" : "text-gray-700 hover:bg-gray-50"
                      )}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>

              {/* Collapsible Project section */}
              {allProjects.length > 0 && (
                <div className="border-t border-gray-200">
                  <button
                    onClick={() => setIsMobileContextExpanded(!isMobileContextExpanded)}
                    className="w-full px-4 py-3 flex items-center justify-between text-left active:bg-transparent focus:outline-none"
                  >
                    <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                      Project
                    </span>
                    <ChevronDownIcon
                      className={clsx(
                        "transform transition-transform",
                        isMobileContextExpanded ? "rotate-180" : ""
                      )}
                    />
                  </button>

                  {isMobileContextExpanded && (
                    <div className="px-4 pb-3">
                      <select
                        value={projectId}
                        onChange={(e) => setProjectId(e.target.value)}
                        className="w-full px-3 py-2 text-base border border-gray-300 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">All projects</option>
                        {allProjects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* Collapsible System section - all items always visible here */}
              <div className="border-t border-gray-200">
                <button
                  onClick={() => setIsMobileSystemExpanded(!isMobileSystemExpanded)}
                  className="w-full px-4 py-3 flex items-center justify-between text-left active:bg-transparent focus:outline-none"
                >
                  <span className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                    System
                  </span>
                  <ChevronDownIcon
                    className={clsx(
                      "transform transition-transform",
                      isMobileSystemExpanded ? "rotate-180" : ""
                    )}
                  />
                </button>

                {isMobileSystemExpanded && (
                  <div>
                    {systemNavItems.map((item) => {
                      const isPinned = pinnedHrefs.includes(item.href);
                      const isActive = pathname.startsWith(item.href);
                      return (
                        <div key={item.href} className="flex items-center hover:bg-gray-50">
                          <button
                            onClick={() => togglePin(item.href)}
                            className="p-3 hover:bg-gray-100 transition-colors"
                            aria-label={isPinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
                          >
                            {isPinned ? (
                              <PinFilledIcon className="w-5 h-5 text-blue-600" />
                            ) : (
                              <PinOutlineIcon className="w-5 h-5 text-gray-400" />
                            )}
                          </button>
                          <Link
                            href={item.href}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={clsx(
                              "flex-1 py-3 pr-4 text-base font-medium transition-colors",
                              isActive ? "text-blue-600" : "text-gray-700"
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
            </div>
          )}
        </div>
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

function MenuIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
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

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("w-3 h-3", className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
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

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z"
      />
    </svg>
  );
}

function ProjectIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2"
      />
    </svg>
  );
}
