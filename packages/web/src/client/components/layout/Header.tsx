import { Link } from "react-router-dom";
import { Nav } from "./Nav";

export function Header() {
  return (
    <header className="bg-white border-b border-gray-200 px-4 sm:px-8 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link to="/" className="hover:text-primary-600 transition-colors">
          <h1 className="text-xl font-semibold text-gray-800">
            Dev Workflow Tracker
          </h1>
        </Link>
        <Nav />
      </div>
    </header>
  );
}
