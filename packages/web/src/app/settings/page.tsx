"use client";

import { Suspense } from "react";
import { useProjectContext } from "@/contexts";
import { useUrlState } from "@/hooks";
import { Card, LoadingState, EmptyState } from "@/components/ui";

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <Card>
          <LoadingState message="Loading settings..." />
        </Card>
      }
    >
      <SettingsPageContent />
    </Suspense>
  );
}

function SettingsPageContent() {
  // Enable URL state persistence
  useUrlState();

  const { projectId, projects, sources, sourceId } = useProjectContext();

  // Find the selected project
  const selectedProject = projects.find((p) => p.id === projectId);

  // Find the selected source
  const selectedSource = sources.find((s) => s.id === sourceId);

  if (!selectedProject) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
          <p className="text-gray-600 mt-1">Project configuration and settings</p>
        </div>
        <Card>
          <EmptyState
            title="No Project Selected"
            description="Select a project from the dropdown to view its settings."
          />
        </Card>
      </div>
    );
  }

  const githubSync = selectedProject.githubSync;
  const isGitHubEnabled = githubSync?.enabled ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Settings</h1>
        <p className="text-gray-600 mt-1">
          Configuration for <span className="font-medium">{selectedProject.name}</span>
        </p>
      </div>

      {/* Project Management Provider Section */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Project Management Provider</h2>

        {isGitHubEnabled ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm text-gray-500">Provider</dt>
              <dd className="text-sm text-gray-900 mt-1">GitHub</dd>
            </div>
            <div>
              <dt className="text-sm text-gray-500">Sync Status</dt>
              <dd className="mt-1">
                <StatusBadge enabled={true} />
              </dd>
            </div>
            {githubSync?.repoUrl && (
              <div className="sm:col-span-2">
                <dt className="text-sm text-gray-500">Repository</dt>
                <dd className="text-sm text-gray-900 mt-1 font-mono break-all">
                  <a
                    href={githubSync.repoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {githubSync.repoUrl}
                  </a>
                </dd>
              </div>
            )}
            {githubSync?.projectId && (
              <div>
                <dt className="text-sm text-gray-500">Project Board ID</dt>
                <dd className="text-sm text-gray-900 mt-1 font-mono">{githubSync.projectId}</dd>
              </div>
            )}
            {githubSync?.projectUrl && (
              <div>
                <dt className="text-sm text-gray-500">Project Board</dt>
                <dd className="text-sm text-gray-900 mt-1">
                  <a
                    href={githubSync.projectUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    View Project
                  </a>
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <EmptyState
            title="GitHub Sync Not Configured"
            description="GitHub issue sync is not enabled for this project. Issues and tasks are managed locally."
          />
        )}
      </Card>

      {/* Datasource Section */}
      <Card>
        <h2 className="text-lg font-semibold text-gray-800 mb-4">Datasource</h2>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <dt className="text-sm text-gray-500">Project Name</dt>
            <dd className="text-sm text-gray-900 mt-1">{selectedProject.name}</dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">Project Slug</dt>
            <dd className="text-sm text-gray-900 mt-1 font-mono">{selectedProject.slug}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm text-gray-500">Track Directory</dt>
            <dd className="text-sm text-gray-900 mt-1 font-mono break-all">
              {selectedProject.trackDirectory}
            </dd>
          </div>
          {selectedProject.gitRoot && (
            <div className="sm:col-span-2">
              <dt className="text-sm text-gray-500">Git Root</dt>
              <dd className="text-sm text-gray-900 mt-1 font-mono break-all">
                {selectedProject.gitRoot}
              </dd>
            </div>
          )}
          {selectedSource && (
            <>
              <div>
                <dt className="text-sm text-gray-500">Source Type</dt>
                <dd className="text-sm text-gray-900 mt-1 capitalize">{selectedSource.type}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Source Name</dt>
                <dd className="text-sm text-gray-900 mt-1">{selectedSource.name}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-sm text-gray-500">Database Path</dt>
                <dd className="text-sm text-gray-900 mt-1 font-mono break-all">
                  {selectedSource.resolvedPath}
                </dd>
              </div>
            </>
          )}
        </dl>
      </Card>
    </div>
  );
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  if (enabled) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-800">
        Enabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 text-xs font-semibold rounded bg-gray-100 text-gray-600">
      Disabled
    </span>
  );
}
