export interface FaqItem {
  id: string;
  q: string;
  a: string;
}

export const LANDING_FAQ: FaqItem[] = [
  {
    id: 'afford',
    q: 'I can afford the rent. Why would I get denied?',
    a: 'Income is often only one part of an application. Depending on the property, screening may also consider credit history, collections, past rental balances, landlord references or a tenant-screening report. Requirements vary, so it helps to understand what a property may review — and look at your own information first.',
  },
  {
    id: 'not-credit-repair',
    q: 'Is RentReady credit repair?',
    a: 'No. RentReady is self-guided education and preparation. We don’t contact credit bureaus or creditors for you, and accurate negative information can’t simply be removed. The templates help you dispute information you believe is inaccurate, incomplete or outdated — yourself.',
  },
  {
    id: 'what-reviewed',
    q: 'What do apartments usually review when I apply?',
    a: 'It varies by property. Applications commonly involve income, credit, rental history and identity verification, and some properties also use a tenant-screening report. RentReady helps you understand each piece and prepare your side of it.',
  },
  {
    id: 'minimum-score',
    q: 'Is there a minimum credit score for an apartment?',
    a: 'There’s no universal number. Some properties publish a minimum, some weigh credit alongside income or deposits, and some look at specific items like collections or prior rental balances. The most reliable source is the property’s own written screening criteria — we show you how to ask for it.',
  },
  {
    id: 'collections',
    q: 'Will a collection stop me from getting an apartment?',
    a: 'Not automatically. Some properties may review collections closely, especially ones tied to prior rentals or utilities; others may weigh them less. If you believe a collection is inaccurate or incomplete, you have the right to dispute it. If it’s accurate, the goal is to understand it and be prepared to explain it.',
  },
  {
    id: 'denied',
    q: 'I was already denied. Can this help?',
    a: 'Often, yes. If a property denied you based on a credit or screening report, they’re generally required to give you an adverse action notice that names the reporting company. That’s a starting point for reviewing what was reported before you apply again.',
  },
  {
    id: 'first-time',
    q: 'What if this is my first apartment?',
    a: 'First-time renters are commonly asked for proof of income, identification, and sometimes a guarantor or larger deposit. RentReady helps you understand what may be asked and gather it ahead of time.',
  },
  {
    id: 'screening-report',
    q: 'Can I see what a screening report says about me?',
    a: 'Generally, yes. Tenant-screening companies are consumer reporting agencies, and you can request your file and dispute information you believe is inaccurate. The Playbook walks through how.',
  },
  {
    id: 'credit-pull',
    q: 'Does RentReady check my credit?',
    a: 'No. We never pull your credit. Your plan is built from information you choose to share, and you get your own reports directly from the bureaus.',
  },
  {
    id: 'guarantee',
    q: 'Does RentReady guarantee I’ll be approved?',
    a: 'No. Approval is always the property’s decision, and requirements vary. RentReady is education and preparation — it helps you apply with more information, not with a promise.',
  },
];

export const OBJECTIONS: FaqItem[] = [
  {
    id: 'not-terrible',
    q: 'What if my credit isn’t terrible?',
    a: 'Then this is about not leaving anything to chance. Plenty of renters with fair or good credit still have one item — an old collection, a wrong address, a duplicate account — they didn’t know was there. Knowing before you apply is the point.',
  },
  {
    id: 'dont-know',
    q: 'What if I don’t know what’s on my reports?',
    a: 'Start with your free reports from all three bureaus at AnnualCreditReport.com — checking your own reports doesn’t affect your score. The book explains what a property may look at; the video guide walks through how to dispute items you believe are wrong.',
  },
  {
    id: 'guarantee-approval',
    q: 'Does this guarantee apartment approval?',
    a: 'No. Every property sets its own criteria and makes its own decision. RentReady helps you understand and prepare before you apply.',
  },
  {
    id: 'remove-items',
    q: 'Can RentReady remove items for me?',
    a: 'No. We don’t contact the bureaus or creditors on your behalf. You learn how the process works and use our templates to dispute information you believe is inaccurate or incomplete — yourself, for free.',
  },
  {
    id: 'credit-repair',
    q: 'Is this credit repair?',
    a: 'No. The Digital Bundle is self-guided education and templates. We don’t act for you, we don’t charge monthly, and we don’t promise outcomes.',
  },
  {
    id: 'how-fast',
    q: 'How quickly will my credit change?',
    a: 'We can’t promise it will change. Bureaus generally have about 30 days to investigate a dispute, so if you’re applying soon, RentReady helps you prioritize what to review now and what to be ready to explain.',
  },
  {
    id: 'accurate',
    q: 'What if the information is accurate?',
    a: 'Then it isn’t something to dispute. Accurate information can generally remain on your report. The book shows you how to understand it, address any balance if you choose, and be prepared to discuss it with a property.',
  },
];

/**
 * Buying objections for the landing page, the Digital Bundle page and checkout. Answers are built from
 * live config (prices, refund window, delivery note) so they can never drift from what checkout does.
 */
export function buyFaq(o: { guidePrice: string; bundlePrice: string; upgradePrice: string; refundDays: number; deliveryNote: string; supportEmail: string }): FaqItem[] {
  const refund =
    o.refundDays > 0
      ? `Yes. If RentReady isn’t useful to you, email ${o.supportEmail} within ${o.refundDays} days of purchase for a full refund. No forms, no hoops.`
      : `Email ${o.supportEmail} with any problem with your order and we’ll make it right under our published terms.`;
  return [
    {
      id: 'bad-credit',
      q: 'Will this help if my credit is bad?',
      a: 'That’s who it was written for. The book shows what a property may look at and how to prepare an application that explains what you can’t change. The Digital Bundle adds 20 dispute letter templates and a video guide for challenging items you believe are inaccurate, incomplete or outdated. Nothing honest can erase accurate history — but you stop walking in blind.',
    },
    {
      id: 'already-denied',
      q: 'What if I was already denied?',
      a: 'Start there. If a denial was based on a credit or screening report, the property generally has to give you an adverse action notice naming the company that supplied it. The book shows you how to use that notice to request your report, check it, and decide what to fix before you pay another application fee.',
    },
    {
      id: 'first-time',
      q: 'Is this only for first-time renters?',
      a: 'No. It’s for anyone about to apply — first-time renters, people who were denied, and people with collections, past balances or thin credit who can afford the rent but aren’t sure they’ll qualify.',
    },
    {
      id: 'applying-soon',
      q: 'I’m applying in the next few days. Is it too late?',
      a: 'No — that’s when knowing matters most. The book is physical and ships to you, while the Digital Bundle’s letters and videos unlock right after checkout. Disputes can take about 30 days, so with a short timeline the focus is on knowing what’s on your reports, asking the right questions before you pay a fee, and having your documents and explanations ready.',
    },
    {
      id: 'which-one',
      q: 'What’s the difference between the book and the Digital Bundle?',
      a: `The book (${o.guidePrice}) is a physical copy of Before They Say No™, mailed to you. The RentReady Digital Bundle (${o.bundlePrice}) includes the same physical book plus 20 Essential Credit Dispute Letter templates you can edit in Microsoft Word and a step-by-step video guide showing how to dispute negative items. Bought the book first? Upgrade for ${o.upgradePrice} — your purchase counts in full.`,
    },
    {
      id: 'physical',
      q: 'Is it a physical book or a digital download?',
      a: `Before They Say No™ is a physical book, mailed to the address you enter at checkout — in both options. In the Digital Bundle, the letter templates (Microsoft Word) and the video guide are digital and unlock right after checkout.${o.deliveryNote ? ` ${o.deliveryNote}` : ''}`,
    },
    {
      id: 'delivery',
      q: 'How do I get my purchase?',
      a: 'Your book ships to the address you enter at checkout. Right after checkout you land on your access page and we email you a confirmation. Digital Bundle letters and videos open from that access page on any device — if you switch devices, request a secure sign-in link with the email you used at checkout.',
    },
    {
      id: 'guarantee',
      q: 'Does RentReady guarantee I’ll be approved?',
      a: 'No, and you should be wary of anyone who does. Every property sets its own criteria and makes its own decision. RentReady gives you the knowledge and preparation to apply with a clearer plan.',
    },
    {
      id: 'subscription',
      q: 'Is this a subscription?',
      a: 'No. It’s a one-time payment. No monthly fees, and you won’t be charged again unless you choose to buy something else.',
    },
    {
      id: 'credit-pull',
      q: 'Will this check or affect my credit?',
      a: 'No. RentReady never pulls your credit. You get your own reports directly from the bureaus, which doesn’t affect your score.',
    },
    { id: 'refund', q: 'What if it’s not right for me?', a: refund },
  ];
}
