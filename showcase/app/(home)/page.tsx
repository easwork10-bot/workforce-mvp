import Link from "next/link";
import "../showcase.css";

export default function ShowcaseHome() {
  return (
    <main className="showcase-home">
      <h1>Jofra Verkeer</h1>
      <p>Veiligheid in beweging.</p>
      <nav aria-label="Choose a language">
        <Link href="/nl/">Nederlands</Link>
        <Link href="/ar/">العربية</Link>
      </nav>
    </main>
  );
}
