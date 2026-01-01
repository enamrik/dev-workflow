import { clsx } from "clsx";

interface CheckboxProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function Checkbox({
  label,
  checked,
  onChange,
  className,
}: CheckboxProps) {
  return (
    <label
      className={clsx(
        "flex items-center gap-2 text-sm text-gray-600 cursor-pointer",
        "hover:text-gray-800 transition-colors",
        className
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={clsx(
          "w-4 h-4 rounded border-gray-300",
          "text-blue-600 focus:ring-blue-500 focus:ring-2",
          "cursor-pointer"
        )}
      />
      {label}
    </label>
  );
}
