import JofraLanding from "../../../src/frontend/features/jofra-landing/JofraLanding";
import "./showcase.css";
import { jofraMetadata } from "../../../src/lib/jofra-metadata";

export function generateMetadata({ params }: { params: { locale: string } }) {
  return jofraMetadata(params.locale);
}

export default function ShowcasePage() {
  return <JofraLanding />;
}
