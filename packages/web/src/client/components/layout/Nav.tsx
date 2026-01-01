import { NavLink } from "react-router-dom";
import { clsx } from "clsx";

const navItems = [
  { to: "/", label: "Board" },
  { to: "/issues", label: "Issues" },
  { to: "/milestones", label: "Milestones" },
];

export function Nav() {
  return (
    <nav className="flex items-center gap-1">
      {navItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            clsx(
              "px-3 py-2 rounded text-sm font-medium transition-colors",
              isActive
                ? "bg-primary-50 text-primary-600"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-800"
            )
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}
