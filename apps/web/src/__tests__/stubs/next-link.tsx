import React from "react";

/**
 * Vitest stub for next/link. Renders a plain <a> tag.
 * Registered via vitest.config.ts resolve alias.
 */
export default function Link({
  href,
  children,
  ...props
}: {
  href: string;
  children: React.ReactNode;
  [key: string]: unknown;
}) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}
