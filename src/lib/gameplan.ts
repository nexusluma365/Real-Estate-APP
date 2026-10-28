import type { Answers } from '../config/assessment';
import type { Rating } from './types';
import { money } from './validation';

/**
 * Rules-based RentReady Game Plan. Educational guidance only — it never predicts approval.
 * PRODUCTION INTEGRATION: replace or extend with the existing RentReady questionnaire
 * scoring by implementing the same `GamePlan` shape server-side (POST /api/gameplan).
 */
export interface PlanSection {
  id: 'income' | 'credit' | 'history' | 'concerns' | 'documents' | 'questions' | 'actions';
  title: string;
  rating?: Rating;
  summary: string;
  points: string[];
  /** Section expanded by the Property Manager Playbook */
  playbook?: { extra: string[] };
}

export interface GamePlan {
  generatedAt: string;
  firstName?: string;
  targetRent: number;
  income: number;
  ratio: number | null;
  urgency: 'now' | 'soon' | 'planning';
  sections: PlanSection[];
}

const n = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

export function buildGamePlan(a: Answers, firstName?: string): GamePlan {
  const rent = n(a.targetRent);
  const income = n(a.income);
  const ratio = rent > 0 ? Math.round((income / rent) * 10) / 10 : null;
  const urgency: GamePlan['urgency'] = a.applyWhen === 'now' || a.applyWhen === '2w' ? 'now' : a.applyWhen === '1m' ? 'soon' : 'planning';
  const first = a.firstApartment === 'yes';
  const sections: PlanSection[] = [];

  // ---------------- Income
  {
    let rating: Rating = 'review';
    let summary = '';
    const points: string[] = [];
    const at3 = income / 3;
    if (ratio === null || income === 0) {
      summary = 'We need a monthly income figure to compare against your target rent.';
    } else if (ratio >= 3) {
      rating = 'strong';
      summary = `Your income is about ${ratio}× your target rent of ${money(rent * 100)}. Many properties publish a requirement between 2.5× and 3×, so this may be a strength.`;
      points.push('Confirm the exact income requirement in the property’s written screening criteria.');
    } else if (ratio >= 2.5) {
      summary = `Your income is about ${ratio}× your target rent. That meets some published requirements and falls short of others.`;
      points.push(`At 3×, your income lines up with rent of about ${money(Math.floor(at3) * 100)}.`);
      points.push('Ask whether the property counts combined income from co-applicants.');
    } else {
      rating = 'attention';
      summary = `Your income is about ${ratio}× your target rent. Many properties publish a higher multiple, so this is worth planning around before you apply.`;
      points.push(`At 3×, your income lines up with rent of about ${money(Math.floor(at3) * 100)}.`);
      points.push('Options some properties offer: a co-applicant, a guarantor, or a larger deposit. Ask before applying.');
    }
    if (a.tenure === 'lt6') points.push('You’ve had this income for under six months. Be ready to show prior income or an offer letter.');
    if (a.employment === 'new' && a.offerLetter === 'no') {
      rating = rating === 'strong' ? 'review' : rating;
      points.push('Get a signed offer letter showing your pay and start date before you apply.');
    }
    sections.push({ id: 'income', title: 'Income position', rating, summary, points });
  }

  // ---------------- Credit
  {
    const r = String(a.creditRange);
    let rating: Rating = 'review';
    let summary = '';
    const points: string[] = [];
    if (r === '720' || r === '680') {
      rating = 'strong';
      summary = 'The range you shared is generally considered good to very good. Individual items on your report can still matter.';
    } else if (r === '640' || r === '620') {
      summary = 'The range you shared is near minimums some properties publish. A review of your reports before applying is worthwhile.';
    } else if (r === 'unknown') {
      summary = 'You don’t know your range yet, so step one is getting your reports from all three bureaus.';
    } else {
      rating = 'attention';
      summary = 'The range you shared is below some properties’ published minimums. It helps to know exactly what’s on your reports and to ask how the property weighs credit.';
    }
    points.push('Get all three bureau reports (CreditReady Module 1) and compare them side by side.');
    points.push('Mark anything you believe is inaccurate, incomplete or not yours (Module 2).');
    sections.push({ id: 'credit', title: 'Credit position', rating, summary, points });
  }

  // ---------------- Rental history
  {
    let rating: Rating = 'strong';
    let summary = 'You described a positive rental history. Have landlord contact details ready.';
    const points: string[] = [];
    if (first) {
      rating = 'review';
      summary = 'Without prior leases, a property may lean more on income, credit or a guarantor.';
      if (a.guarantor === 'yes') points.push('You may have a guarantor available — ask each property what they require from one.');
      else points.push('Ask whether the property offers alternatives for first-time renters, such as a larger deposit.');
    } else {
      if (a.rentalHistory === 'mostly') {
        rating = 'review';
        summary = 'Mostly positive history. A late payment or two may come up in a reference check.';
      }
      if (a.rentalHistory === 'issues') {
        rating = 'attention';
        summary = 'You noted things you may need to explain. Preparing a short, factual explanation can help.';
      }
      if (a.eviction === 'recent' || a.eviction === 'unsure') {
        rating = 'attention';
        points.push('Check whether an eviction filing appears on a tenant-screening report — you can request your file from screening companies.');
      }
      if (a.brokenLease === 'owed') {
        rating = 'attention';
        points.push('Find out whether a balance from a prior lease is owed or reported, and to whom.');
      }
      points.push('List your last two addresses with landlord names, dates and contact details.');
    }
    sections.push({ id: 'history', title: 'Rental history', rating, summary, points });
  }

  // ---------------- Reported concerns
  {
    const items: string[] = [];
    if (a.collections === 'yes') items.push(`Collection accounts reported (${a.collectionsCount || 'count unknown'}).`);
    if (a.collections === 'unsure') items.push('Possible collection accounts — confirm on your reports.');
    if (a.collectionsRental === 'yes') items.push('A collection tied to a prior landlord, apartment or utility.');
    if (a.chargeOffs === 'yes') items.push('Charged-off accounts reported.');
    if (a.eviction === 'recent') items.push('An eviction filing or judgment within the last 7 years.');
    if (a.brokenLease === 'owed') items.push('A possible balance from a broken lease.');
    if (a.denied === 'recent' || a.denied === 'older') items.push('A previous apartment denial.');
    const heavy = a.collectionsRental === 'yes' || a.eviction === 'recent' || a.brokenLease === 'owed';
    const rating: Rating = items.length === 0 ? 'strong' : heavy ? 'attention' : 'review';
    const points =
      items.length === 0
        ? ['Still worth a full report review — items you don’t know about are the ones that surprise you.']
        : [
            ...items,
            'For anything you believe is inaccurate or incomplete, use the matching CreditReady template.',
            'For anything accurate, focus on understanding it and being ready to explain it.',
          ];
    if (a.adverseNotice === 'yes') points.push('Use your adverse action notice to request the report that was used, free of charge.');
    sections.push({
      id: 'concerns',
      title: 'Reported concerns',
      rating,
      summary: items.length === 0 ? 'You didn’t report specific concerns.' : `You noted ${items.length} item${items.length > 1 ? 's' : ''} worth reviewing before you apply.`,
      points,
    });
  }

  // ---------------- Documents
  {
    const docs = ['Government-issued photo ID'];
    if (a.employment === 'w2' || a.employment === 'multiple') docs.push('Your two to three most recent pay stubs');
    if (a.employment === 'self' || a.employment === 'multiple') docs.push('Last two years of tax returns or 1099s', 'Three to six months of bank statements');
    if (a.employment === 'new') docs.push('Signed offer letter with salary and start date');
    if (a.employment === 'other') docs.push('Award letters or statements for benefits or retirement income');
    if (!first) docs.push('Prior landlord names and contact details');
    if (first && a.guarantor !== 'no') docs.push('Guarantor’s contact details, in case they’re requested');
    sections.push({
      id: 'documents',
      title: 'Documentation to prepare',
      summary: 'Have these ready before you apply so your application is complete and consistent.',
      points: docs,
      playbook: {
        extra: [
          'Make sure the income on your application matches your documents exactly.',
          'Use the same legal name and address history across every form.',
          'Keep a PDF folder ready to upload — some portals time out.',
        ],
      },
    });
  }

  // ---------------- Questions to ask
  sections.push({
    id: 'questions',
    title: 'Questions to ask before you pay a fee',
    summary: 'Ask the leasing office these before you pay an application fee.',
    points: [
      'Can I see your written screening criteria?',
      'What income multiple do you use, and do you combine co-applicants?',
    ],
    playbook: {
      extra: [
        'Which screening or credit company do you use?',
        'How do you treat collections — and medical collections specifically?',
        'Do you offer conditional approval, such as a larger deposit or a guarantor?',
        'Is any part of the application fee refundable?',
        'How long does a decision usually take?',
      ],
    },
  });

  // ---------------- Priority actions
  {
    const actions: string[] = [];
    if (urgency === 'now') actions.push('You’re applying soon. Pull your reports this week and prioritize anything that looks inaccurate — bureau investigations commonly take around 30 days.');
    else actions.push('Pull all three credit reports and read each section with Module 1.');
    if (a.collections === 'yes' || a.chargeOffs === 'yes') actions.push('Sort each collection or charge-off: “I believe this is inaccurate” vs. “this is accurate.” Only dispute the first group.');
    if (ratio !== null && ratio < 3) actions.push('Get the property’s income requirement in writing before you apply.');
    if (a.denied === 'recent' && a.adverseNotice !== 'yes') actions.push('Contact the property that denied you and ask for the adverse action notice and the name of the screening company.');
    actions.push('Gather your documents into one folder.');
    actions.push('Ask the questions above before you pay any application fee.');
    sections.push({ id: 'actions', title: 'Priority actions', summary: 'In this order, based on your timeline.', points: actions });
  }

  return { generatedAt: new Date().toISOString(), firstName, targetRent: rent, income, ratio, urgency, sections };
}

export const RATING_LABEL: Record<Rating, string> = {
  strong: 'Strong',
  review: 'Review',
  attention: 'Needs attention',
};
