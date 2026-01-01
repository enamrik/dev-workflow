import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover } from "../Popover";

describe("Popover", () => {
  beforeEach(() => {
    // Reset any mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Let React handle cleanup naturally
  });

  it("renders the trigger element", () => {
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    expect(screen.getByText("Open Popover")).toBeInTheDocument();
  });

  it("does not show popover content by default", () => {
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    expect(screen.queryByText("Popover Content")).not.toBeInTheDocument();
  });

  it("opens popover on click", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    await user.click(screen.getByText("Open Popover"));

    expect(screen.getByText("Popover Content")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes popover on clicking trigger again", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    // Open popover
    await user.click(screen.getByText("Open Popover"));
    expect(screen.getByText("Popover Content")).toBeInTheDocument();

    // Close popover by clicking trigger again
    await user.click(screen.getByText("Open Popover"));
    expect(screen.queryByText("Popover Content")).not.toBeInTheDocument();
  });

  it("closes popover on Escape key press", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    // Open popover
    await user.click(screen.getByText("Open Popover"));
    expect(screen.getByText("Popover Content")).toBeInTheDocument();

    // Press Escape
    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByText("Popover Content")).not.toBeInTheDocument();
    });
  });

  it("closes popover on click outside", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Popover trigger={<span>Open Popover</span>}>
          <div>Popover Content</div>
        </Popover>
        <div data-testid="outside">Outside Element</div>
      </div>
    );

    // Open popover
    await user.click(screen.getByText("Open Popover"));
    expect(screen.getByText("Popover Content")).toBeInTheDocument();

    // Click outside
    await user.click(screen.getByTestId("outside"));

    await waitFor(() => {
      expect(screen.queryByText("Popover Content")).not.toBeInTheDocument();
    });
  });

  it("does not close popover when clicking inside content", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div data-testid="content">Popover Content</div>
      </Popover>
    );

    // Open popover
    await user.click(screen.getByText("Open Popover"));
    expect(screen.getByText("Popover Content")).toBeInTheDocument();

    // Click inside content
    await user.click(screen.getByTestId("content"));

    // Should still be open
    expect(screen.getByText("Popover Content")).toBeInTheDocument();
  });

  it("sets correct ARIA attributes", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    const trigger = screen.getByRole("button");
    expect(trigger).toHaveAttribute("aria-haspopup", "true");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    // Open popover
    await user.click(screen.getByText("Open Popover"));

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
  });

  it("opens popover on Enter key press", async () => {
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    // Focus on trigger
    const trigger = screen.getByRole("button");
    trigger.focus();

    // Press Enter
    fireEvent.keyDown(trigger, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Popover Content")).toBeInTheDocument();
    });
  });

  it("opens popover on Space key press", async () => {
    render(
      <Popover trigger={<span>Open Popover</span>}>
        <div>Popover Content</div>
      </Popover>
    );

    // Focus on trigger
    const trigger = screen.getByRole("button");
    trigger.focus();

    // Press Space
    fireEvent.keyDown(trigger, { key: " " });

    await waitFor(() => {
      expect(screen.getByText("Popover Content")).toBeInTheDocument();
    });
  });

  it("has scrollable content when maxHeight is exceeded", async () => {
    render(
      <Popover
        trigger={<span>Open Popover</span>}
        maxHeight={100}
      >
        <div style={{ height: 500 }}>Tall Content</div>
      </Popover>
    );

    await userEvent.click(screen.getByText("Open Popover"));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveStyle({ maxHeight: "100px" });

    // Check that the scroll container exists
    const scrollContainer = dialog.querySelector(".overflow-y-auto");
    expect(scrollContainer).toBeInTheDocument();
  });
});
