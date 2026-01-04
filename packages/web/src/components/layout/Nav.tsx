"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { useProjectContext } from "@/contexts";
import { ProjectFilter } from "@/components/issues";

const navItems = [
  { href: "/", label: "Board" },
  { href: "/issues", label: "Issues" },
  { href: "/milestones", label: "Milestones" },
  { href: "/worktrees", label: "Worktrees" },
];

export function Nav() {
  const pathname = usePathname();
  const { projectId, setProjectId, projects } = useProjectContext();

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
          <ProjectFilter projects={projects} value={projectId} onChange={setProjectId} />
        </div>
        <nav className="flex items-center gap-1">
          {navItems.map((item) => {
            const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  "px-3 py-2 rounded text-sm font-medium transition-colors",
                  isActive
                    ? "bg-blue-50 text-blue-600"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
