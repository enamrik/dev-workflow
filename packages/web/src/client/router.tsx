import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/layout/Layout";
import { IssuesPage } from "./pages/IssuesPage";
import { IssueDetailPage } from "./pages/IssueDetailPage";
import { BoardPage } from "./pages/BoardPage";
import { MilestonesPage } from "./pages/MilestonesPage";
import { NotFoundPage } from "./pages/NotFoundPage";

export function AppRouter() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<BoardPage />} />
        <Route path="/issues" element={<IssuesPage />} />
        <Route path="/issues/:number" element={<IssueDetailPage />} />
        <Route path="/milestones" element={<MilestonesPage />} />
        <Route path="/projects/:projectId" element={<BoardPage />} />
        <Route path="/projects/:projectId/issues" element={<IssuesPage />} />
        <Route
          path="/projects/:projectId/issues/:number"
          element={<IssueDetailPage />}
        />
        <Route
          path="/projects/:projectId/milestones"
          element={<MilestonesPage />}
        />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
