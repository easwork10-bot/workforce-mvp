import JofraPublicPage from "../../../../src/frontend/features/jofra-landing/JofraPublicPage";
import { jofraMetadata } from "../../../../src/lib/jofra-metadata";

export function generateMetadata() {
  return jofraMetadata("nl", "request");
}

export default function DutchRequestPage() {
  return <JofraPublicPage />;
}
