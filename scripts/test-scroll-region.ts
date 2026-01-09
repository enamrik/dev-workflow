#!/usr/bin/env npx tsx

/**
 * Test script for terminal scroll regions
 *
 * This demonstrates using ANSI escape sequences to create a fixed header
 * while content scrolls below it.
 */

import { spawn } from "child_process";

// ANSI escape sequences
const ESC = "\x1b";
const CSI = `${ESC}[`;

const term = {
  // Save cursor position
  saveCursor: () => process.stdout.write(`${ESC}7`),
  // Restore cursor position
  restoreCursor: () => process.stdout.write(`${ESC}8`),
  // Move cursor to row, col (1-indexed)
  moveTo: (row: number, col: number) => process.stdout.write(`${CSI}${row};${col}H`),
  // Clear entire screen
  clearScreen: () => process.stdout.write(`${CSI}2J`),
  // Clear line
  clearLine: () => process.stdout.write(`${CSI}2K`),
  // Set scroll region (top and bottom row, 1-indexed)
  setScrollRegion: (top: number, bottom: number) => process.stdout.write(`${CSI}${top};${bottom}r`),
  // Reset scroll region to full screen
  resetScrollRegion: () => process.stdout.write(`${CSI}r`),
  // Colors
  bold: (text: string) => `${CSI}1m${text}${CSI}0m`,
  cyan: (text: string) => `${CSI}36m${text}${CSI}0m`,
  yellow: (text: string) => `${CSI}33m${text}${CSI}0m`,
  dim: (text: string) => `${CSI}2m${text}${CSI}0m`,
  // Hide/show cursor
  hideCursor: () => process.stdout.write(`${CSI}?25l`),
  showCursor: () => process.stdout.write(`${CSI}?25h`),
};

const HEADER_LINES = 4; // Number of lines for the fixed header

function drawHeader(taskInfo: { title: string; issue: number; task: number }) {
  const cols = process.stdout.columns || 80;
  const border = "═".repeat(cols);

  term.saveCursor();
  term.moveTo(1, 1);

  // Line 1: Top border
  term.clearLine();
  process.stdout.write(term.cyan(`╔${border.slice(0, -2)}╗`));

  // Line 2: Task info
  term.moveTo(2, 1);
  term.clearLine();
  const info = ` 🤖 Worker Task #${taskInfo.issue}.${taskInfo.task}: ${taskInfo.title} `;
  const padding = " ".repeat(Math.max(0, cols - info.length - 4));
  process.stdout.write(term.cyan("║") + term.bold(term.yellow(info)) + padding + term.cyan("║"));

  // Line 3: Status line
  term.moveTo(3, 1);
  term.clearLine();
  const status = ` Status: IN_PROGRESS | Mode: isolated `;
  const statusPadding = " ".repeat(Math.max(0, cols - status.length - 4));
  process.stdout.write(term.cyan("║") + term.dim(status) + statusPadding + term.cyan("║"));

  // Line 4: Bottom border
  term.moveTo(4, 1);
  term.clearLine();
  process.stdout.write(term.cyan(`╚${border.slice(0, -2)}╝`));

  term.restoreCursor();
}

function setupScrollRegion() {
  const rows = process.stdout.rows || 24;

  // Clear screen and set up scroll region below header
  term.clearScreen();
  term.setScrollRegion(HEADER_LINES + 1, rows);
  term.moveTo(HEADER_LINES + 1, 1);
}

function cleanup() {
  term.resetScrollRegion();
  term.showCursor();
  term.moveTo(process.stdout.rows || 24, 1);
  console.log("\n" + term.cyan("═".repeat(60)));
  console.log(term.bold("Session ended. Scroll region reset."));
}

async function main() {
  const taskInfo = {
    title: "Test scroll regions for worker UI",
    issue: 999,
    task: 1,
  };

  // Handle cleanup on exit
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  // Set up the UI
  setupScrollRegion();
  drawHeader(taskInfo);

  // Redraw header on terminal resize
  process.stdout.on("resize", () => {
    const rows = process.stdout.rows || 24;
    term.setScrollRegion(HEADER_LINES + 1, rows);
    drawHeader(taskInfo);
  });

  // Move cursor to scroll region
  term.moveTo(HEADER_LINES + 1, 1);

  // Option 1: Just output some test content
  if (process.argv.includes("--test")) {
    console.log("Starting test output...\n");
    for (let i = 1; i <= 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      console.log(
        `Line ${i}: This is test output that should scroll while the header stays fixed.`
      );
    }
    return;
  }

  // Spawn claude sessions in a loop
  let sessionNumber = 1;

  while (true) {
    // Update header with session info
    taskInfo.title = `Test scroll regions - Session ${sessionNumber}`;
    drawHeader(taskInfo);

    console.log(term.dim(`\n--- Starting Claude session ${sessionNumber} ---\n`));

    const sessionEnded = await new Promise<boolean>((resolve) => {
      // Pass prompt as positional arg (should start interactive with this prompt)
      const prompt = `You are in test session ${sessionNumber}. Say hello and mention the session number. Then wait for user input.`;

      const child = spawn("claude", [prompt], {
        stdio: "inherit",
        env: process.env,
      });

      let killed = false;

      // After 15 seconds, start countdown and kill
      const killTimer = setTimeout(() => {
        killed = true;

        // Countdown from 5
        let countdown = 5;
        const countdownInterval = setInterval(() => {
          // Update header with countdown
          term.saveCursor();
          term.moveTo(3, 1);
          term.clearLine();
          const cols = process.stdout.columns || 80;
          const status = ` Status: ENDING IN ${countdown}s... `;
          const statusPadding = " ".repeat(Math.max(0, cols - status.length - 4));
          process.stdout.write(
            term.cyan("║") + term.yellow(term.bold(status)) + statusPadding + term.cyan("║")
          );
          term.restoreCursor();

          countdown--;

          if (countdown < 0) {
            clearInterval(countdownInterval);
            child.kill("SIGTERM");
          }
        }, 1000);
      }, 15000);

      child.on("exit", (code) => {
        clearTimeout(killTimer);
        console.log(term.dim(`\nClaude exited with code: ${code}`));

        if (killed) {
          resolve(true); // Continue to next session
        } else {
          resolve(false); // User exited manually, stop loop
        }
      });
    });

    if (!sessionEnded) {
      console.log(term.dim("\nUser ended session. Exiting..."));
      break;
    }

    sessionNumber++;
    console.log(term.dim("\nStarting next session in 2 seconds..."));
    await new Promise((r) => setTimeout(r, 2000));
  }
}

main().catch(console.error);
