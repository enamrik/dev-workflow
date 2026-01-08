"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useIssues, useUrlState } from "@/hooks";
import { useProjectContext } from "@/contexts";
import { IssueTable } from "@/components/issues";
import {
  Card,
  CardHeader,
  CardTitle,
  LoadingState,
  ErrorState,
  Checkbox,
  SearchInput,
  Pagination,
} from "@/components/ui";

const DEFAULT_PAGE_SIZE = 25;

export default function IssuesPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <LoadingState message="Loading..." />
        </Card>
      }
    >
      <IssuesPageContent />
    </Suspense>
  );
}

function IssuesPageContent() {
  // Enable URL state persistence
  useUrlState();

  const searchParams = useSearchParams();
  const router = useRouter();
  const { projectId, sourceId, isLoading: projectsLoading } = useProjectContext();
  const showClosed = searchParams.get("showClosed") === "true";
  const searchQuery = searchParams.get("q") ?? "";
  const currentPage = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10);

  const {
    data: issues = [],
    isLoading: issuesLoading,
    error,
    refetch,
  } = useIssues({
    project: projectId || undefined,
    source: sourceId || undefined,
  });

  const isLoading = projectsLoading || issuesLoading;

  const filteredIssues = useMemo(() => {
    let result = issues;

    // Filter by status
    if (!showClosed) {
      result = result.filter((item) => item.issue.status !== "CLOSED");
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.issue.title.toLowerCase().includes(query) ||
          item.issue.description.toLowerCase().includes(query)
      );
    }

    return result;
  }, [issues, showClosed, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredIssues.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedIssues = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredIssues.slice(start, start + pageSize);
  }, [filteredIssues, safePage, pageSize]);

  function updateParams(updates: Record<string, string | null>) {
    const newParams = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === "") {
        newParams.delete(key);
      } else {
        newParams.set(key, value);
      }
    }
    router.push(`/issues?${newParams.toString()}`);
  }

  function handleShowClosedChange(checked: boolean) {
    updateParams({ showClosed: checked ? "true" : null, page: null });
  }

  function handleSearchChange(query: string) {
    updateParams({ q: query || null, page: null });
  }

  function handlePageChange(page: number) {
    updateParams({ page: page === 1 ? null : String(page) });
  }

  function handlePageSizeChange(size: number) {
    updateParams({
      pageSize: size === DEFAULT_PAGE_SIZE ? null : String(size),
      page: null,
    });
  }

  if (isLoading) {
    return (
      <Card>
        <LoadingState message="Loading issues..." />
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <ErrorState
          message={error instanceof Error ? error.message : "Failed to load issues"}
          onRetry={() => refetch()}
        />
      </Card>
    );
  }

  const issueCount = filteredIssues.length;
  const issuesWord = issueCount === 1 ? "issue" : "issues";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Issues</CardTitle>
        <span className="text-gray-600 text-sm">
          {issueCount} {issuesWord}
        </span>
      </CardHeader>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <SearchInput
          value={searchQuery}
          onChange={handleSearchChange}
          placeholder="Search issues..."
          className="w-full sm:max-w-md"
        />
        <Checkbox label="Show closed" checked={showClosed} onChange={handleShowClosedChange} />
      </div>

      <IssueTable issues={paginatedIssues} />

      <Pagination
        currentPage={safePage}
        totalPages={totalPages}
        pageSize={pageSize}
        totalItems={filteredIssues.length}
        onPageChange={handlePageChange}
        onPageSizeChange={handlePageSizeChange}
      />
    </Card>
  );
}
