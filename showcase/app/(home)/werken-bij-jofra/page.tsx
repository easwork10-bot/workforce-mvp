import JofraPublicPage from "../../../../src/frontend/features/jofra-landing/JofraPublicPage";
import { jofraMetadata } from "../../../../src/lib/jofra-metadata";

export function generateMetadata() {
  return jofraMetadata("nl", "recruitment");
}

export default function DutchRecruitmentPage() {
  return <JofraPublicPage recruitment />;
}
