/* eslint-disable @next/next/no-img-element -- Pre-encoded sources are shared with the static Pages build. */
import React from "react";

const photoWidths = {
  "01_s01_expertise_site_overview": [480, 960, 1536],
  "02_s01_expertise_close_control": [480, 960, 1536],
  "03_s02_waaromjofra_team_talk": [480, 960, 1200],
  "04_s03_mensen_portret": [480, 960, 1200],
  "05_s04_werkwijze_hand_signal": [472],
  "06_case_forklift_coordination": [480, 768],
  "07_case_night_operation": [480, 960, 1200],
  "worker": [480, 1086],
} satisfies Record<string, number[]>;

export default function JofraPhoto({ photo, alt, sizes, priority = false }: {
  photo: keyof typeof photoWidths;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  const base = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/jofra/assets/${photo}`;
  const widths = photoWidths[photo];
  const source = `${base}.webp`;
  const srcSet = widths.map((width, index) =>
    `${index === widths.length - 1 ? source : `${base}-${width}w.webp`} ${width}w`,
  ).join(", ");
  // Match Next/Image's handling of Next's newer React runtime versus static React 18.
  const priorityAttributes = priority
    ? (Boolean(React.use) ? { fetchPriority: "high" as const } : { fetchpriority: "high" })
    : {};

  return (
    <img
      {...priorityAttributes}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      alt={alt}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      sizes={sizes}
      srcSet={srcSet}
      src={source}
    />
  );
}
