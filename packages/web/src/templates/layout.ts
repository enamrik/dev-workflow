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
    <a href="/" class="logo-link"><h1>dev-workflow</h1></a>
    <nav class="main-nav">
      <a href="/" class="nav-link" data-path="/">Issues</a>
      <a href="/board" class="nav-link" data-path="/board">Board</a>
      <a href="/milestones" class="nav-link" data-path="/milestones">Milestones</a>
    </nav>
  </header>
  <main>${content}</main>
  <script src="/app.js"></script>
  <script src="/websocket-client.js"></script>
  <script>
    // Highlight active nav link
    (function() {
      const path = window.location.pathname;
      const navLinks = document.querySelectorAll('.nav-link');
      navLinks.forEach(link => {
        const linkPath = link.getAttribute('data-path');
        if (path === linkPath || (linkPath !== '/' && path.startsWith(linkPath))) {
          link.classList.add('active');
        }
      });
    })();
  </script>
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
