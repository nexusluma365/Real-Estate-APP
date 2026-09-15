import './page.css';

const TERMS = {
  privacy: { title: 'Privacy Policy', intro: 'RentReady uses the information you provide to deliver your rental-readiness review, apartment-search features, customer support, and permitted communications.', sections: [
    ['Information we collect','We may collect contact details, rental-search preferences, self-reported income, rent budget, credit range, and payment-related transaction identifiers. RentReady does not use this form to pull your credit report.'],
    ['How we use it','We use your information to provide your requested RentReady services, personalize apartment-search results, process purchases, prevent fraud, provide support, and improve the service.'],
    ['Sharing','We may use service providers for payments, hosting, email, analytics, and apartment-search data. We do not sell your personal information. Property availability and leasing decisions are handled by the property or its representatives.'],
    ['Your choices','You may contact RentReady to request access, correction, or deletion where applicable. Payment records and other information may be retained when required for legal, fraud-prevention, or accounting purposes.']
  ]},
  terms: { title: 'Terms of Service', intro: 'RentReady is an educational rental-readiness and apartment-discovery service. It is not a landlord, property manager, credit bureau, tenant-screening company, or guarantee of housing.', sections: [
    ['RentReady review','Your RentReady score and rental outlook are educational estimates based on the information you provide and common rental screening factors. They are not an approval, credit decision, or guarantee.'],
    ['Apartment information','Apartment communities, pricing, availability, deposits, concessions, screening rules, and lease terms can change. Confirm all material details directly with the property before applying or paying a property fee.'],
    ['Purchases','The $10 RentReady review and any optional apartment-list or digital-guide purchase are separate one-time purchases unless a checkout clearly states otherwise. Charges are shown before you authorize payment.'],
    ['No guarantee','RentReady cannot guarantee approval, no-deposit leasing, reduced deposits, unit availability, specific pricing, or lease terms. Final decisions belong to each property.']
  ]}
};
export default function Legal({type}){ const x=TERMS[type]||TERMS.terms; return <main className="legal-page"><article className="legal-wrap"><div className="legal-brand">RentReady Network</div><h1>{x.title}</h1><p>{x.intro}</p>{x.sections.map(([h,b])=><section key={h}><h2>{h}</h2><p>{b}</p></section>)}<a className="legal-back" href="/">← Back to RentReady</a></article></main>}
