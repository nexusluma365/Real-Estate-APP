/**
 * Post-purchase assessment. Questions are data so the existing RentReady
 * questionnaire can be mapped onto them (see INTEGRATION_GUIDE.md §Assessment).
 */
export type Answers = Record<string, string | number | undefined>;

export interface Option {
  value: string;
  label: string;
}

export interface Question {
  id: string;
  section: 'Your move' | 'Your income' | 'Your credit' | 'Your rental history' | 'Your timing';
  prompt: string | ((a: Answers) => string);
  help?: string;
  kind: 'currency' | 'choice';
  options?: Option[];
  min?: number;
  max?: number;
  when?: (a: Answers) => boolean;
}

const yn: Option[] = [
  { value: 'no', label: 'No' },
  { value: 'yes', label: 'Yes' },
  { value: 'unsure', label: 'I’m not sure' },
];

export const QUESTIONS: Question[] = [
  {
    id: 'targetRent',
    section: 'Your move',
    prompt: 'What monthly rent are you aiming for?',
    help: 'Use the rent for the apartment you actually want, not the one you’d settle for.',
    kind: 'currency',
    min: 300,
    max: 30000,
  },
  {
    id: 'firstApartment',
    section: 'Your move',
    prompt: 'Is this your first apartment in your own name?',
    kind: 'choice',
    options: [
      { value: 'no', label: 'No, I’ve rented before' },
      { value: 'yes', label: 'Yes, it’s my first' },
    ],
  },
  {
    id: 'income',
    section: 'Your income',
    prompt: 'Roughly what is your gross monthly income?',
    help: 'Before taxes. Include only income you could document. An estimate is fine.',
    kind: 'currency',
    min: 0,
    max: 500000,
  },
  {
    id: 'employment',
    section: 'Your income',
    prompt: 'How do you earn most of that income?',
    kind: 'choice',
    options: [
      { value: 'w2', label: 'Employee (W-2)' },
      { value: 'self', label: 'Self-employed or 1099' },
      { value: 'multiple', label: 'A mix of sources' },
      { value: 'new', label: 'I’m starting a new job' },
      { value: 'other', label: 'Benefits, retirement or other' },
    ],
  },
  {
    id: 'offerLetter',
    section: 'Your income',
    prompt: 'Do you have a signed offer letter showing your pay?',
    kind: 'choice',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'Not yet' },
    ],
    when: (a) => a.employment === 'new',
  },
  {
    id: 'tenure',
    section: 'Your income',
    prompt: (a) => (a.employment === 'self' ? 'How long have you run your business?' : 'How long have you had your current income source?'),
    kind: 'choice',
    options: [
      { value: 'lt6', label: 'Less than 6 months' },
      { value: '6to12', label: '6 to 12 months' },
      { value: '1to2', label: '1 to 2 years' },
      { value: 'gt2', label: 'More than 2 years' },
    ],
    when: (a) => a.employment !== 'new',
  },
  {
    id: 'creditRange',
    section: 'Your credit',
    prompt: 'What’s your approximate credit score range?',
    help: 'Your best guess is fine. We don’t check your credit.',
    kind: 'choice',
    options: [
      { value: '720', label: '720 or higher' },
      { value: '680', label: '680–719' },
      { value: '640', label: '640–679' },
      { value: '620', label: '620–639' },
      { value: '580', label: '580–619' },
      { value: '0', label: 'Below 580' },
      { value: 'unknown', label: 'I don’t know' },
    ],
  },
  { id: 'collections', section: 'Your credit', prompt: 'Are any collection accounts reported on your credit?', kind: 'choice', options: yn },
  {
    id: 'collectionsCount',
    section: 'Your credit',
    prompt: 'About how many?',
    kind: 'choice',
    options: [
      { value: '1', label: 'One' },
      { value: '2-3', label: 'Two or three' },
      { value: '4+', label: 'Four or more' },
    ],
    when: (a) => a.collections === 'yes',
  },
  {
    id: 'collectionsRental',
    section: 'Your credit',
    prompt: 'Is any of it from a past landlord, apartment or utility company?',
    help: 'Some properties may look at these more closely.',
    kind: 'choice',
    options: yn,
    when: (a) => a.collections === 'yes',
  },
  { id: 'chargeOffs', section: 'Your credit', prompt: 'Any charged-off accounts?', kind: 'choice', options: yn },
  {
    id: 'rentalHistory',
    section: 'Your rental history',
    prompt: 'How would you describe your rental history?',
    kind: 'choice',
    options: [
      { value: 'positive', label: 'Positive — paid on time, left on good terms' },
      { value: 'mostly', label: 'Mostly positive, a late payment or two' },
      { value: 'issues', label: 'There are things I may need to explain' },
    ],
    when: (a) => a.firstApartment === 'no',
  },
  {
    id: 'eviction',
    section: 'Your rental history',
    prompt: 'Have you had an eviction filing or judgment?',
    kind: 'choice',
    options: [
      { value: 'no', label: 'No' },
      { value: 'recent', label: 'Yes, in the last 7 years' },
      { value: 'older', label: 'Yes, more than 7 years ago' },
      { value: 'unsure', label: 'I’m not sure' },
    ],
    when: (a) => a.firstApartment === 'no',
  },
  {
    id: 'brokenLease',
    section: 'Your rental history',
    prompt: 'Have you ever broken a lease?',
    kind: 'choice',
    options: [
      { value: 'no', label: 'No' },
      { value: 'settled', label: 'Yes, and it’s settled' },
      { value: 'owed', label: 'Yes, and there may be a balance' },
    ],
    when: (a) => a.firstApartment === 'no',
  },
  {
    id: 'guarantor',
    section: 'Your rental history',
    prompt: 'If a property asked, could someone act as a guarantor or co-signer?',
    kind: 'choice',
    options: [
      { value: 'yes', label: 'Yes, probably' },
      { value: 'maybe', label: 'Maybe' },
      { value: 'no', label: 'No' },
    ],
    when: (a) => a.firstApartment === 'yes' || Number(a.income) < Number(a.targetRent) * 2.5,
  },
  {
    id: 'denied',
    section: 'Your rental history',
    prompt: 'Have you been denied for an apartment before?',
    kind: 'choice',
    options: [
      { value: 'no', label: 'No' },
      { value: 'recent', label: 'Yes, in the last year' },
      { value: 'older', label: 'Yes, more than a year ago' },
    ],
  },
  {
    id: 'adverseNotice',
    section: 'Your rental history',
    prompt: 'Did you get a written notice explaining why?',
    help: 'Often called an adverse action notice. It usually names the screening or credit company used.',
    kind: 'choice',
    options: yn,
    when: (a) => a.denied === 'recent' || a.denied === 'older',
  },
  {
    id: 'applyWhen',
    section: 'Your timing',
    prompt: 'When do you expect to submit an application?',
    kind: 'choice',
    options: [
      { value: 'now', label: 'I’m applying now' },
      { value: '2w', label: 'Within 2 weeks' },
      { value: '1m', label: 'Within a month' },
      { value: '3m', label: 'In 1 to 3 months' },
      { value: 'later', label: 'Later — I’m planning ahead' },
    ],
  },
  {
    id: 'moveDate',
    section: 'Your timing',
    prompt: 'When would you like to move in?',
    kind: 'choice',
    options: [
      { value: '30', label: 'Within 30 days' },
      { value: '90', label: 'In 1 to 3 months' },
      { value: '180', label: 'In 3 to 6 months' },
      { value: 'later', label: 'More than 6 months away' },
    ],
  },
  {
    id: 'concern',
    section: 'Your timing',
    prompt: 'What worries you most about applying?',
    kind: 'choice',
    options: [
      { value: 'score', label: 'My credit score' },
      { value: 'collections', label: 'Collections or old accounts' },
      { value: 'income', label: 'Whether my income is enough' },
      { value: 'history', label: 'My rental history' },
      { value: 'docs', label: 'Proving my income' },
      { value: 'unknown', label: 'Not knowing what they’ll look at' },
    ],
  },
];

export const visibleQuestions = (a: Answers) => QUESTIONS.filter((q) => !q.when || q.when(a));
export const promptOf = (q: Question, a: Answers) => (typeof q.prompt === 'function' ? q.prompt(a) : q.prompt);
