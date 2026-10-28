import JofraLanding from "../../src/frontend/features/jofra-landing/JofraLanding";
import JofraPublicPage from "../../src/frontend/features/jofra-landing/JofraPublicPage";

export type JofraPageName = "home" | "request" | "recruitment";

export function JofraPage({ page }: { page: JofraPageName }) {
  if (page === "home") return <JofraLanding />;
  return <JofraPublicPage recruitment={page === "recruitment"} />;
}
