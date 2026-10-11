import { cx } from "../../lib/cx";

/** Single-select group rendered as buttons; behaves as a radio group for assistive tech. */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  label: string;
  options: readonly T[];
  value: T | undefined;
  onChange: (value: T) => void;
  /** Marks the group refused; `describedBy` is the id of the visible message. */
  invalid?: true | undefined;
  describedBy?: string | undefined;
}) {
  return (
    <div
      className="choice-group"
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option}
          role="radio"
          aria-checked={value === option}
          className={cx(value === option && "on")}
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}
