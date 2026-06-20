import { useState, type ReactNode } from "react";

/**
 * Shows a small floating label when the wrapped element is hovered. The label is
 * fixed-positioned from the element's on-screen rect so it is never clipped by a scrolling
 * container, and ignores pointer events so it never blocks the element underneath.
 */
export function Tooltip({
  content,
  side = "right",
  children,
}: {
  content: ReactNode;
  side?: "right" | "top";
  children: ReactNode;
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  if (!content) return <>{children}</>;

  const show = (e: React.MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos(side === "top" ? { x: r.left + r.width / 2, y: r.top - 8 } : { x: r.right + 10, y: r.top + r.height / 2 });
  };

  return (
    <div onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos && (
        <div
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
    </div>
  );
}
