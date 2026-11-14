# PRD: Trade progress

| | |
| --- | --- |
| Status | Draft |
| Owner | Product, Trust and Safety |
| Target | Next release (Milestone 1, then Milestone 2) |

## Background

Today a purchase ends the moment the buyer presses Buy: the listing becomes
sold and nothing else happens. The seller has no place to record that the item
was shipped, and the buyer has no way to say it arrived. When something goes
wrong, support cannot tell whether the item was never sent or was sent and
lost. Neither side can see which of their purchases or sales still need
something from them.

## Goal

Give every purchase a clear trade that the seller and the buyer move forward
together, from purchase to receipt, and let each of them see at a glance which
of their trades wait for them.

## Users

- **Seller**: the user who created a listing.
- **Buyer**: the user who bought it.
- **Visitor**: anyone else, signed in or not.

## Milestones

The work ships in two milestones. Milestone 1 makes the trade rules and the API
complete and usable on their own. Milestone 2 builds the web page on top of
them and needs no new rules.

| Milestone | Scope | Requirements |
| --- | --- | --- |
| 1. Trade rules and API | A purchase starts a trade; the seller marks it shipped and the buyer confirms receipt. Users can list their own trades and see which ones wait for them. | 1-14 |
| 2. Web page | A Trades view with the next step for each trade, and trade status on the cards the parties see. | 15-21 |

## Requirements

### Milestone 1: Trade rules and API

#### Trade steps

1. Buying a listing starts a trade between the seller and the buyer. The trade starts as awaiting shipment, and records when the listing was bought.
2. The seller can mark the trade as shipped. The trade records when it was shipped.
3. After the trade is shipped, the buyer can confirm receipt. The trade becomes completed and records when it was completed.
4. The steps happen only in this order. The buyer cannot confirm receipt before the item is shipped, and a completed trade cannot go back.
5. Only the seller can mark a trade as shipped, and only the buyer can confirm receipt. Any other user, and a request without a signed-in user, is rejected.
6. Repeating a step that already happened (marking a shipped trade as shipped again, confirming receipt of a completed trade again) succeeds and changes nothing.
7. A step on a listing that does not exist, or on a listing that has no trade because it is on sale or withdrawn, is rejected with a clear message.
8. Listings that were sold before this release count as completed trades. Nothing is left to do on them, and they still appear in their parties' trade lists.

#### Who sees a trade

9. Only the seller and the buyer see a trade's step and its times. For every other user and for guests, the listing looks exactly as it does today: sold, with no trade details.
10. Saving, the saved count and the Saved view are unchanged. A buyer who saved a listing that someone else bought sees it as sold, with no trade details.

#### Listing trades

11. A signed-in user can list their own trades, as seller and as buyer, most recently bought first.
12. The list can be narrowed to trades where the user is the seller, or to trades where the user is the buyer.
13. Each trade in the list says the user's role and whether it waits for the user: a trade awaiting shipment waits for the seller, a shipped trade waits for the buyer, and a completed trade waits for nobody.
14. Users can only list their own trades. A request without a signed-in user is rejected.

### Milestone 2: Web page

15. A "Trades" view lists the signed-in user's trades, most recently bought first. Each entry shows the item, the price, the other party's name, the trade step and the user's role.
16. Entries that wait for the current user are marked, and the view shows how many trades wait for the user.
17. The entry offers the next step: "Mark as shipped" for the seller of a trade awaiting shipment, "Confirm receipt" for the buyer of a shipped trade. Pressing it updates the entry and the count without reloading the page.
18. "Confirm receipt" asks for confirmation first, because it cannot be undone.
19. If a step is rejected, the page shows the server's message and the entry stays as it was.
20. In All listings and Saved, a sold listing shows its trade step ("Awaiting shipment", "Shipped", "Completed") only to its seller and its buyer. Everyone else sees "Sold" as today.
21. Switching the signed-in user updates the Trades view, the count and the trade steps on cards.

## Acceptance criteria

### Milestone 1

- Hana buys Ken's road bike helmet. Both Ken's and Hana's trade lists show it as awaiting shipment; for Ken it waits for him, for Hana it does not. Mio sees the helmet as sold, with no trade details.
- Hana tries to confirm receipt of the helmet before Ken ships it. The request is rejected.
- Ken marks the helmet as shipped, then marks it again. The second request changes nothing, and no error is shown. The trade now waits for Hana.
- Mio tries to mark the helmet as shipped, or to confirm its receipt, through the API. Both requests are rejected.
- Hana confirms receipt. The trade is completed for both of them, waits for nobody, and cannot be moved back.
- Ken tries to mark his mechanical keyboard, which is on sale, as shipped. The request is rejected.
- Hana's trade list includes the camping stove she bought from Mio before this release, as completed. Narrowed to trades where she is the seller, her list does not include it.
- A request without a signed-in user cannot list trades or move any trade forward.

### Milestone 2

- Hana buys Ken's helmet. Signed in as Ken, the Trades view marks the helmet as waiting for him and shows a count of 1. He presses "Mark as shipped"; the entry shows "Shipped" and the count drops to 0 without a reload.
- Signed in as Hana, the helmet card in All listings shows "Shipped". Signed in as Mio, it shows "Sold".
- Hana presses "Confirm receipt" and cancels the confirmation. Nothing changes. She presses it again and confirms; the entry shows "Completed".
- When a step is rejected, for example because the trade was moved forward in another tab, the page shows the server's message.

### Both milestones

- All existing tests still pass. New rules and new routes have tests, including their error cases, and every new or changed route is described in docs/api/openapi.json.

## Out of scope

- Ratings or reviews between the buyer and the seller, and user profiles. They build on completed trades and get their own PRD.
- Cancelling a trade, refunds, or disputes.
- Payment, shipping labels, tracking numbers or delivery companies.
- Messages between the buyer and the seller.
- Deadlines: automatic receipt confirmation or reminders when a step takes too long.
- Notifications of any kind.
- Storing data outside the running process.

## Relation to other PRDs

- Edit and withdraw listings (docs/prd/edit-and-withdraw-listings.md) has shipped, and its rules stay as they are. A withdrawn listing can never be bought, so it never has a trade. A listing with a trade is sold, so it can be neither edited nor withdrawn.

## Success measures

- 90% of trades reach completed within two weeks of purchase.
- Support requests asking "where is my item?" drop by 30% within eight weeks of release.

## Open questions

- Should sold listings stop showing who bought them? Today `buyerId` is public on every listing. This PRD keeps it as it is and only hides the trade details.
- Should a trade that stays awaiting shipment for a long time be cancelled automatically? Not for this release; it overlaps with cancellation and deadlines.
