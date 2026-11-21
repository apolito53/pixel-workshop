import type { Metadata } from 'next';
import FinishingLauncher from '../finishing-launcher.tsx';

export const metadata: Metadata = {
  title: 'Image Finishing · Pixel Workshop',
  description: 'Fine-tune color and lighting, compare your edits, and export your image at full resolution.',
};

export default function FinishPage() {
  return <main className="workspace-entry">
    <section className="workspace-card" aria-labelledby="finishing-entry-title">
      <span className="eyebrow">PIXEL WORKSHOP</span>
      <h1 id="finishing-entry-title">The finishing touches.</h1>
      <p>Adjust color, light, and detail while keeping your original image. Everything here is processed in your browser.</p>
      <FinishingLauncher initiallyOpen />
      <a className="finishing-entry-link" href="/">← Back to Pixel Workshop</a>
    </section>
  </main>;
}
