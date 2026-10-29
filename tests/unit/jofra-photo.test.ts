import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import JofraPhoto from "@/frontend/features/jofra-landing/JofraPhoto";

const photos = [
  "01_s01_expertise_site_overview",
  "02_s01_expertise_close_control",
  "03_s02_waaromjofra_team_talk",
  "04_s03_mensen_portret",
  "05_s04_werkwijze_hand_signal",
  "06_case_forklift_coordination",
  "07_case_night_operation",
  "worker",
] as const;

afterEach(() => vi.unstubAllEnvs());

describe("shared responsive Jofra photographs", () => {
  it("references every WebP exactly as a candidate and ships no unused derivatives", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/workforce-mvp");
    const referenced = new Set<string>();
    for (const photo of photos) {
      const html = renderToStaticMarkup(JofraPhoto({ photo, alt: "Test", sizes: "100vw" }));
      const candidates = /srcSet="([^"]+)"/i.exec(html)![1].split(", ");
      let previousWidth = 0;
      for (const candidate of candidates) {
        const [url, descriptor] = candidate.split(" ");
        expect(url).toMatch(/^\/workforce-mvp\/jofra\/assets\/.+\.webp$/);
        expect(descriptor).toMatch(/^\d+w$/);
        const width = parseInt(descriptor, 10);
        expect(width).toBeGreaterThan(previousWidth);
        previousWidth = width;
        const filename = path.basename(url);
        const bytes = await readFile(path.join(process.cwd(), "public", "jofra", "assets", filename));
        expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
        expect(bytes.toString("ascii", 8, 12)).toBe("WEBP");
        referenced.add(filename);
      }
      expect(html).toContain('loading="lazy"');
      expect(html).toContain('decoding="async"');
      expect(html).toContain("position:absolute");
      expect(html).toContain(`src="/workforce-mvp/jofra/assets/${photo}.webp"`);
    }
    const files = await readdir(path.join(process.cwd(), "public", "jofra", "assets"));
    expect([...referenced].sort()).toEqual(files.filter(file => file.endsWith(".webp")).sort());
    expect(referenced.size).toBe(20);
    expect(files.some(file => file.endsWith(".jpg"))).toBe(false);
  });

  it("prioritizes the hero without requiring a runtime image service", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    const html = renderToStaticMarkup(JofraPhoto({
      photo: "04_s03_mensen_portret", alt: "Hero", sizes: "100vw", priority: true,
    }));
    expect(html).toContain('loading="eager"');
    expect(html).toMatch(/fetchpriority="high"/i);
    expect(html).toContain('src="/jofra/assets/04_s03_mensen_portret.webp"');
    expect(html).not.toContain("/_next/image");
  });
});
