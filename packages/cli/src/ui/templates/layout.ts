export function renderLayout(title: string, content: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} - dev-workflow</title>
  <link rel="stylesheet" href="/styles/main.css">
</head>
<body>
  <header>
    <h1>dev-workflow</h1>
    <nav>
      <a href="/">Issues</a>
    </nav>
  </header>
  <main>${content}</main>
  <script src="/app.js"></script>
</body>
</html>
  `.trim();
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
