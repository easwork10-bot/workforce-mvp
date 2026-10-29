export default function ArrowIcon({ direction = "up-right" }: {
  direction?: "up-right" | "down" | "right" | "up";
}) {
  const paths = {
    "up-right": "M6 18 18 6M6 6h12v12",
    down: "M12 4v16M5 13l7 7 7-7",
    right: "M4 12h16M13 5l7 7-7 7",
    up: "M12 20V4M5 11l7-7 7 7",
  };
  return (
    <svg className="jofra-arrow-icon" viewBox="0 0 24 24" width="24" height="24"
      fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
      strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={paths[direction]} />
    </svg>
  );
}
