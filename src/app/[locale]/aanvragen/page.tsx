import JofraPublicPage from "@/frontend/features/jofra-landing/JofraPublicPage";
import { jofraMetadata } from "@/lib/jofra-metadata";

export function generateMetadata({ params }: { params: { locale: string } }) {
  return jofraMetadata(params.locale, "request");
}

export default function RequestPage() {
  return <JofraPublicPage />;
}
