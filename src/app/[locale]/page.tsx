import JofraLanding from "@/frontend/features/jofra-landing/JofraLanding";
import { jofraMetadata } from "@/lib/jofra-metadata";

export function generateMetadata({ params }: { params: { locale: string } }) {
  return jofraMetadata(params.locale);
}

export default function HomePage() {
  return <JofraLanding />;
}
