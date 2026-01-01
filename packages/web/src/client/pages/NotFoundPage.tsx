import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="card p-6 text-center">
      <h2 className="text-2xl font-semibold text-gray-800 mb-4">
        Page Not Found
      </h2>
      <p className="text-gray-600 mb-6">
        The page you're looking for doesn't exist.
      </p>
      <Link
        to="/"
        className="inline-block px-4 py-2 bg-primary-600 text-white rounded hover:bg-primary-700 transition-colors"
      >
        Go to Issues
      </Link>
    </div>
  );
}
