import { hydrateRoot } from "react-dom/client";
import { JofraPage } from "./page";
import { JofraRuntime } from "./runtime";

const root = document.getElementById("jofra-root");
if (!root) throw new Error("Missing Jofra Pages root element.");

const locale = root.dataset.locale;
const page = root.dataset.page;
const pathname = root.dataset.pathname;
if (
  (locale !== "nl" && locale !== "ar") ||
  (page !== "home" && page !== "request" && page !== "recruitment") ||
  !pathname
) {
  throw new Error("Invalid Jofra Pages route configuration.");
}

hydrateRoot(
  root,
  <JofraRuntime locale={locale} pathname={pathname}>
    <JofraPage page={page} />
  </JofraRuntime>,
);
