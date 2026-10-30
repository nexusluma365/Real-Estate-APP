import { useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { Seo } from '../components/Seo';
import { track } from '../lib/analytics';
import { captureAttribution } from '../lib/attribution';

const questions = [
  ['Does second-chance mean I will be approved?', 'No. Every property sets its own screening rules. RentReady helps you find published information to review and confirm with the leasing office.'],
  ['Do I have to pay before I can search?', 'No. You can browse regular apartment listings for free. Premium second-chance listing details may require an active membership.'],
  ['What if there are no verified matches in my city?', 'The Finder tells you when it has no verified second-chance matches. Do not subscribe expecting guaranteed inventory in every city.'],
  ['Can I cancel?', 'Premium renews monthly until canceled. Review cancellation and billing terms before paying.'],
];
const benefits = [
  ['Search by location', 'Start with the city where you want to rent.'],
  ['Review real listing information', 'Check the property details and contact the leasing team to confirm availability and requirements.'],
  ['Prepare before applying', 'Understand the questions to ask about credit, rental history, income and application fees.'],
];

export default function SecondChanceSearch() {
  const { pathname, search } = useLocation();
  const [city, setCity] = useState(() => new URLSearchParams(window.location.search).get('city') || '');
  useEffect(() => {
    captureAttribution(search, pathname, 'second-chance-apartments');
    track('landing_view', { variant: 'finder_search_intent' });
  }, [pathname, search]);
  const go = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const params = new URLSearchParams();
    params.set('mode', 'second-chance');
    if (city.trim()) params.set('q', city.trim());
    const incoming = new URLSearchParams(search);
    for (const key of ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','gbraid','wbraid','gad_source']) {
      const value = incoming.get(key);
      if (value) params.set(key, value);
    }
    track('primary_cta_click', { cta_location: 'second_chance_search', variant: 'finder_search_intent' });
    window.location.assign(`/finder/${params.toString() ? `?${params}` : ''}`);
  };
  return (
    <Layout>
      <Seo title="Find Second-Chance Apartments Near You | RentReady" description="Search rental listings and review screening information where available. Browse free, verify property requirements, and see premium membership terms before paying." />
      <main style={{background:'linear-gradient(135deg,#f6f3eb,#fff)',padding:'clamp(48px,8vw,100px) 20px'}}>
        <div style={{maxWidth:1000,margin:'0 auto'}}>
          <p style={{fontWeight:700,letterSpacing:2,color:'#84662e',textTransform:'uppercase'}}>RentReady Finder</p>
          <h1 style={{fontSize:'clamp(38px,6vw,70px)',lineHeight:1.08,letterSpacing:'-0.045em',maxWidth:820,margin:'20px 0'}}>Bad credit or a past rental issue? Find apartments worth checking.</h1>
          <p style={{fontSize:'clamp(17px,2vw,22px)',lineHeight:1.6,maxWidth:720}}>Search by city, see available apartment information, and explore properties with published flexible-screening policies when we have them. Check requirements with the leasing office before you pay an application fee.</p>
          <form onSubmit={go} style={{display:'flex',gap:12,flexWrap:'wrap',margin:'30px 0 12px'}}>
            <label htmlFor="renter-city" style={{position:'absolute',width:1,height:1,overflow:'hidden'}}>City or ZIP code</label>
            <input id="renter-city" value={city} onChange={e=>setCity(e.target.value)} placeholder="Enter city or ZIP code" style={{flex:'1 1 240px',minHeight:54,border:'1px solid #a9abb0',borderRadius:12,padding:'12px 18px',fontSize:17}}/>
            <button type="submit" style={{minHeight:54,padding:'12px 28px',border:0,borderRadius:12,background:'#15253a',color:'white',fontWeight:700,fontSize:17,cursor:'pointer'}}>Search Apartments →</button>
          </form>
          <p style={{fontSize:14,color:'#4b5563'}}>Search and browse regular listings for free. Premium access is optional: $5 for the first month, then $19.99/month until canceled. Pricing and cancellation terms appear before payment.</p>
          <p style={{fontSize:15,fontWeight:600,marginTop:22}}>Search first. See what is available in your city. Decide whether Premium is worth it.</p>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:18,marginTop:48}}>
            {benefits.map(([title,body])=><div key={title} style={{background:'white',border:'1px solid #e4e5e7',borderRadius:18,padding:24}}><h2 style={{fontSize:20,margin:'0 0 10px'}}>{title}</h2><p style={{lineHeight:1.55,margin:0}}>{body}</p></div>)}
          </div>
          <section aria-labelledby="how-it-works" style={{marginTop:54}}>
            <h2 id="how-it-works" style={{fontSize:'clamp(25px,3vw,34px)',letterSpacing:'-.025em'}}>Know what happens next</h2>
            <ol style={{lineHeight:1.9,fontSize:17,paddingLeft:26}}>
              <li><strong>Search your city.</strong> Explore apartments currently shown in Finder.</li>
              <li><strong>Check the evidence.</strong> Where available, review the source and date for any published flexible-screening policy.</li>
              <li><strong>Choose whether to unlock.</strong> Premium unlocks eligible gated listing details where available. Confirm your city has useful listings before you subscribe.</li>
              <li><strong>Contact the property.</strong> Ask about screening, availability and fees before applying.</li>
            </ol>
          </section>
          <section aria-labelledby="frequently-asked" style={{marginTop:44}}>
            <h2 id="frequently-asked" style={{fontSize:'clamp(25px,3vw,34px)',letterSpacing:'-.025em'}}>Questions before you search</h2>
            {questions.map(([question,answer]) => <details key={question} style={{padding:'16px 0',borderBottom:'1px solid #d7d9dd'}}>
              <summary style={{cursor:'pointer',fontWeight:700,fontSize:17}}>{question}</summary>
              <p style={{lineHeight:1.6,maxWidth:780}}>{answer}</p>
            </details>)}
          </section>
          <p style={{marginTop:32,lineHeight:1.6}}>Important: A listing appearing in search does not mean the property accepts every credit or rental history. Confirm requirements, availability, fees and application criteria directly with the property before paying an application fee.</p>
          <p style={{marginTop:16}}>Want to prepare your application first? <a href="/apartment-application-denied" style={{textDecoration:'underline'}}>Learn what property managers may review.</a></p>
        </div>
      </main>
    </Layout>
  );
}
