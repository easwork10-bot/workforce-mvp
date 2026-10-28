import JofraPublicPage from "../../../../src/frontend/features/jofra-landing/JofraPublicPage";
import { jofraMetadata } from "../../../../src/lib/jofra-metadata";

export function generateMetadata({ params }: { params: { locale: string } }) {
  return jofraMetadata(params.locale, "recruitment");
}

export default function RecruitmentPage() {
  return <JofraPublicPage recruitment />;
}
