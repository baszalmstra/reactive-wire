import {
  Children,
  cloneElement,
  useId,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";

type TriggerProps = {
  "aria-describedby"?: string;
  onMouseEnter?: (event: MouseEvent<HTMLElement>) => void;
  onMouseLeave?: (event: MouseEvent<HTMLElement>) => void;
  onFocus?: (event: FocusEvent<HTMLElement>) => void;
  onBlur?: (event: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

/** A floating description available from both pointer hover and keyboard focus. */
export function Tooltip({
  content,
  side = "right",
  children,
}: {
  content: ReactNode;
  side?: "right" | "top";
  children: ReactElement<TriggerProps>;
}) {
  const id = useId();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const child = Children.only(children);

  if (!content) return child;

  const show = (element: HTMLElement) => {
    const r = element.getBoundingClientRect();
    setPos(side === "top" ? { x: r.left + r.width / 2, y: r.top - 8 } : { x: r.right + 10, y: r.top + r.height / 2 });
  };
  const describedBy = [child.props["aria-describedby"], id].filter(Boolean).join(" ");

  const trigger = cloneElement(child, {
    "aria-describedby": describedBy,
    onMouseEnter: (event: MouseEvent<HTMLElement>) => {
      child.props.onMouseEnter?.(event);
      show(event.currentTarget);
    },
    onMouseLeave: (event: MouseEvent<HTMLElement>) => {
      child.props.onMouseLeave?.(event);
      setPos(null);
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      child.props.onFocus?.(event);
      show(event.currentTarget);
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      child.props.onBlur?.(event);
      setPos(null);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      child.props.onKeyDown?.(event);
      if (event.key === "Escape") setPos(null);
    },
  });

  return (
    <>
      {trigger}
      {pos && (
        <div
          id={id}
          role="tooltip"
          style={{
            position: "fixed",
            left: pos.x,
            top: pos.y,
            transform: side === "top" ? "translate(-50%,-100%)" : "translateY(-50%)",
          }}
          className="z-50 pointer-events-none max-w-[220px] rounded-md border border-rw-line bg-rw-panel2 px-2.5 py-1.5 text-[11px] leading-snug text-rw-text shadow-rw"
        >
          {content}
        </div>
      )}
    </>
  );
}
