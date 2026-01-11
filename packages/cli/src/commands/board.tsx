import React from "react";
import { render } from "ink";
import { resolveConfigFromGit } from "@dev-workflow/core";
import { KanbanBoard } from "../components/KanbanBoard.js";
import { useKanbanData } from "../hooks/useKanbanData.js";

/**
 * Board command options
 */
export interface BoardOptions {
  /** Refresh interval in seconds (default: 3) */
  interval?: number;
}

/**
 * Main board app component
 */
function BoardApp({
  dbPath,
  projectId,
  intervalMs,
}: {
  dbPath: string;
  projectId: string;
  intervalMs: number;
}): React.ReactElement {
  const { data, error, loading, refresh } = useKanbanData(dbPath, projectId, intervalMs);

  return (
    <KanbanBoard
      data={data}
      loading={loading}
      error={error}
      intervalMs={intervalMs}
      onRefresh={refresh}
    />
  );
}

/**
 * Run the board command
 */
export async function runBoard(options: BoardOptions = {}): Promise<void> {
  const intervalMs = (options.interval ?? 3) * 1000;

  // Resolve project config from git
  let config;
  try {
    config = await resolveConfigFromGit();
  } catch (error) {
    console.error("❌ Failed to resolve project config.");
    if (error instanceof Error) {
      console.error(`   ${error.message}`);
    }
    console.error("\nMake sure you're in a dev-workflow initialized repository.");
    console.error("Run 'dev-workflow init' to initialize.");
    process.exit(1);
  }

  // Start the Ink app
  const { waitUntilExit } = render(
    <BoardApp
      dbPath={config.resolvedDatabase}
      projectId={config.projectId}
      intervalMs={intervalMs}
    />
  );

  // Wait for user to exit
  await waitUntilExit();
}
