/**
 * Generates natural language text for starting a task that Claude can understand.
 * This text triggers the dwf-work-task skill when pasted into Claude.
 */
export function getClaudeTaskCommand(issueNumber: number, taskNumber: number): string {
  return `Start working on task ${taskNumber} for issue #${issueNumber}`;
}
