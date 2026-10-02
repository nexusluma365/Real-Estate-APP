# Landing Page to Checkout Alignment

## Purpose

This document reviews whether the RentReady landing page promise matches the checkout experience, where the wording is strong, where the funnel creates confusion, and how to make the message cleaner.

The main funnel reviewed is:

```text
/ -> /check-my-rental-readiness -> /results-processing -> /rentready-review-checkout -> /after-payment-results -> /apartment-approval-preparation-kit -> /real-estate-list
```

## Overall Assessment

The primary landing page mostly aligns with the $10 checkout.

The landing page promises:

- second-chance apartment search help
- apartment options that may fit the renter's situation
- guidance on what could help or hurt approval chances
- no credit pull
- no approval guarantee

The $10 checkout sells:

- RentReady results
- apartment options/listings that fit the renter's search
- what could help or hurt the next application
- one-time $10 access
- no subscription
- no credit pull

That is a good core match. The user is not being taken from a vague landing page to a completely different checkout. The language, price, and product are broadly consistent.

The biggest weakness happens after the $10 payment. The results page tells the user they are about to see apartment options, but the CTA sends them to the $47 Apartment Approval Preparation Kit upsell before listings. That can feel like a bait-and-switch because the user just paid $10 to unlock results and apartment options.

## Current Strengths

### Landing Page

The home page clearly names the audience:

```text
Looking for a Second-Chance Apartment?
```

It also explains the value:

```text
See apartment options that may fit your situation and find out what could help or hurt your chances before you apply.
```

This matches the checkout promise well.

### Questionnaire

The questionnaire continues the same message:

```text
Answer a few quick questions about your apartment search and rental situation.
We'll use your answers to help show where you stand and find apartment options that may fit.
```

This is aligned with the landing page and does not overpromise approval.

### Results Processing

The processing page keeps the promise narrow:

```text
Rental situation reviewed
Common application factors checked
Results ready
Apartment search prepared
```

This is good because it avoids implying a real credit pull, landlord review, or official screening report.

### $10 Checkout

The checkout page is mostly clear:

```text
See Your Results and Apartment Options
Unlock Your Results — $10
One-time payment
No subscription
No credit pull
```

The disclaimer is also strong:

```text
This is not a rental application, landlord approval, or guarantee of approval.
```

That protects trust and sets the right expectations.

## Main Alignment Issue

After the user pays $10, the results page says:

```text
Ready to See Your Apartment Options?
SEE APARTMENTS THAT FIT MY SEARCH →
```

But the CTA routes to:

```text
/apartment-approval-preparation-kit
```

That page is not the apartment list. It is a $47 upsell for the RentReady Kit.

This creates a promise gap:

- The user expects apartment options/listings.
- The user lands on another sales page.
- The button text does not clearly prepare them for a paid kit offer.
- The skip link to listings exists, but it appears lower on the upsell page instead of being clearly offered as a parallel choice.

This is the main thing to improve.

## Wording Risks

### Risk 1: "Get Your Keys"

The $47 page uses phrases like:

```text
Let's Get You Into Your Next Apartment.
Get Your Keys.
YES — LET'S GO GET THOSE KEYS →
```

These lines are emotionally strong, but they imply an outcome the product cannot control. The kit can help someone prepare, but it cannot get them keys or approval.

Better wording:

```text
Prepare for Your Next Apartment Application.
Walk Into Your Next Search More Prepared.
YES — GET MY RENTREADY KIT →
```

### Risk 2: "Better Approval Odds"

Current copy says:

```text
put yourself in a stronger position for better approval odds
```

This is better than guaranteeing approval, but it still leans close to a promise. Safer wording:

```text
put yourself in a stronger position before you apply
```

Or:

```text
understand what to review before spending money on another application
```

### Risk 3: "See Apartments" CTA Goes to an Upsell

Current CTA:

```text
SEE APARTMENTS THAT FIT MY SEARCH →
```

But the next page is the prep-kit offer. Better choices:

```text
CONTINUE TO YOUR NEXT STEP →
```

Or, if keeping the upsell:

```text
SEE HOW TO PREPARE BEFORE VIEWING LISTINGS →
```

Best option:

```text
GET THE PREP KIT
SKIP TO APARTMENT LISTINGS
```

Show both choices immediately after the paid results.

## Recommended Funnel Copy

### Home Hero

Current:

```text
Looking for a Second-Chance Apartment?
```

This is good. Keep it.

Suggested supporting copy:

```text
Answer a few questions to see your RentReady results, understand what could affect your next application, and continue to apartment options that may fit your search.
```

This introduces "results" earlier, so the $10 checkout feels expected.

### Primary CTA

Current:

```text
FIND MY APARTMENT OPTIONS
```

Better:

```text
CHECK MY RENTREADY RESULTS
```

Alternative:

```text
SEE WHERE I STAND
```

Reason: the first paid step is not only apartment options. It is a readiness result plus apartment options. The CTA should set that expectation earlier.

### Questionnaire Intro

Current wording is good. Slight improvement:

```text
Answer a few quick questions about your apartment search and rental situation. We'll use your answers to prepare your RentReady results and help you continue toward apartment options that may fit.
```

### Results Processing

Current wording is good. Keep it conservative.

### $10 Checkout Headline

Current:

```text
See Your Results and Apartment Options
```

This is good. Keep it.

### $10 Checkout Includes

Current list is good, but the first line should avoid making listings sound guaranteed:

Current:

```text
See Apartment Listings That Fit Your Search
```

Better:

```text
Continue to Apartment Options Based on Your Search
```

Or:

```text
See Apartment Options for the Area You Chose
```

### After-Payment CTA

Current:

```text
Ready to See Your Apartment Options?
SEE APARTMENTS THAT FIT MY SEARCH →
```

Better if routing to the prep kit:

```text
Your Results Are Ready. Want Help Preparing Before You View Listings?
```

Buttons:

```text
GET THE RENTREADY PREP KIT
SKIP TO APARTMENT LISTINGS
```

Better if routing straight to listings:

```text
Ready to See Your Apartment Options?
CONTINUE TO APARTMENT LISTINGS →
```

Then show the prep kit as an optional offer after or beside the listings flow.

## Recommended Structural Improvements

### 1. Make the $10 Product Name Consistent

Use one product name everywhere:

```text
RentReady Results
```

Avoid switching between:

- results
- review
- pre-screen
- rental path
- outlook

Internal code can still use `prescreen`, but customer-facing copy should stay consistent.

### 2. Put the Upsell Choice on the Results Page

Instead of making "See Apartments" route to the prep kit, show two clear choices:

```text
Prepare Before You Apply
Get the RentReady Kit for $47.

Continue to Listings
Skip the kit and view apartment options now.
```

This preserves the upsell while reducing friction and mistrust.

### 3. Change the $47 CTA

Current:

```text
YES — LET'S GO GET THOSE KEYS →
```

Better:

```text
YES — GET MY RENTREADY KIT →
```

Or:

```text
GET THE PREP KIT — $47
```

The button should name exactly what is being purchased.

### 4. Keep "No Guarantee" Language Visible

The current disclaimers are useful and should stay visible near both payment moments:

```text
RentReady does not guarantee approval, availability, pricing, deposit terms, or lease approval.
```

This should appear before purchase, not only in footer-style legal text.

### 5. Reduce Outcome-Based Language

Replace high-outcome phrases with preparation-focused phrases.

Use:

```text
prepare before applying
know what to ask
understand what may need attention
continue your search with better information
```

Avoid:

```text
get approved
get your keys
get you into your next apartment
better approval odds
```

Unless those phrases are heavily qualified.

## Priority Fixes

1. Change the after-payment CTA so it does not say "See Apartments" if it routes to the $47 prep-kit page.
2. Add a clear "Skip to Apartment Listings" option immediately after the $10 results.
3. Rename the $47 CTA to "Get My RentReady Kit — $47".
4. Soften "get your keys" and "get into your next apartment" language.
5. Use "RentReady Results" consistently as the $10 product name.

## Best Version of the Funnel

The cleanest user journey would be:

```text
Landing:
Check your RentReady Results before you apply.

Questionnaire:
Tell us your search details.

$10 Checkout:
Unlock your RentReady Results and continue to apartment options.

Results Page:
Here is where you stand.

Choice:
1. Get the $47 Prep Kit before applying.
2. Skip to apartment listings.

Listings:
Show apartment options based on the user's selected city, rent, bedrooms, and profile.
```

This keeps the sales strategy intact while making the customer journey feel honest and coherent.
