import { Hero } from '../components/home/Hero';
import { FeatureCards } from '../components/home/FeatureCards';
import { AboutSection } from '../components/home/AboutSection';
import { FeaturedSection } from '../components/home/FeaturedSection';
import { SearchSection } from '../components/home/SearchSection';
import { HowItWorks } from '../components/home/HowItWorks';

/** Reference layout: hero → floating search card (with results) → ways in → communities → split feature → steps. */
export function HomePage() {
  return (
    <>
      <Hero />
      <SearchSection />
      <FeatureCards />
      <FeaturedSection />
      <AboutSection />
      <HowItWorks />
    </>
  );
}
