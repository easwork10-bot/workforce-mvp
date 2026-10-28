import JofraPublicPage from "../../../../src/frontend/features/jofra-landing/JofraPublicPage";
import "../showcase.css";
import { jofraMetadata } from "../../../../src/lib/jofra-metadata";

export function generateMetadata({ params }: { params: { locale: string } }) {
  return jofraMetadata(params.locale, "request");
}

export default function RequestPage() {
  return <JofraPublicPage />;
}
