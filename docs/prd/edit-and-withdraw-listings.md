# PRD: Edit and withdraw listings

| | |
| --- | --- |
| Status | Draft |
| Owner | Product, Seller Experience |
| Target | Next release |

## Background

Once a listing is published, the seller cannot change it. A seller who wants to
lower the price, fix a typo or add a detail has no way to do so, and a seller
who no longer wants to sell (the item broke, or was sold elsewhere) cannot take
the listing down. Buyers then see outdated prices and try to buy items that are
no longer available.

Since Favorites shipped, buyers also keep listings in their Saved view. When a
seller changes or withdraws a listing, those buyers need to see what happened
instead of finding a listing that silently changed or vanished.

## Goal

Let sellers keep their listings accurate: change the details of a listing that
is still on sale, and withdraw a listing they no longer want to sell. Buyers
always see the current details, and saved listings that were withdrawn stay
understandable.

## Users

- **Seller**: the user who created a listing.
- **Buyer**: a signed-in user who browses, saves or buys listings.

## Requirements

### Editing

1. A seller can change the title, description and price of their own listing while it is on sale. A change may update one, two or all three of these fields; fields that are not part of the change keep their value.
2. The same rules as for a new listing apply to the changed values: title required and at most 80 characters, description at most 1000 characters, price an integer between 300 and 9,999,999 yen.
3. A change with no valid field, or with any invalid field, is rejected with a clear message, and the listing stays exactly as it was.
4. Only the seller can edit a listing. Any other user, and a request without a signed-in user, is rejected.
5. A listing that is sold or withdrawn cannot be edited.
6. Editing does not change the listing's position in the All listings view (newest first by creation time). The listing records when it was last edited.
7. Editing keeps the listing's saves: saved count, who saved it, and its position in each buyer's Saved view do not change.

### Withdrawing

8. A seller can withdraw their own listing while it is on sale. Its status becomes withdrawn.
9. Withdrawing a listing that is already withdrawn succeeds and changes nothing.
10. Only the seller can withdraw a listing. A sold listing cannot be withdrawn.
11. A withdrawn listing does not appear in the All listings view or in search results, for anyone, including the seller.
12. A withdrawn listing cannot be bought and cannot be newly saved.
13. A withdrawn listing can still be opened by its ID, so links and Saved views keep working, and it shows that it was withdrawn.

### Saved listings

14. A saved listing that is later withdrawn stays in the buyer's Saved view and is shown as withdrawn. The buyer can remove it from Saved.
15. Withdrawn listings keep their saved count and still count toward the buyer's limit of 100 saved listings, the same as sold listings.

### Web page

16. On the seller's own listings that are on sale, the card shows an "Edit" button and a "Withdraw" button. Other users never see them.
17. "Edit" opens a form on the card with the current title, description and price. Saving the form updates the card without reloading the page. If the change is rejected, the page shows the server's message and keeps what the seller typed.
18. "Withdraw" asks for confirmation first. After confirming, the listing disappears from All listings without reloading the page.
19. In the Saved view, a withdrawn listing is marked "Withdrawn" and has no Buy button. Its heart still works for removing it.

## Acceptance criteria

- Ken changes the price of his road bike helmet from 4,500 to 3,900 yen. Every user now sees 3,900 yen, the helmet keeps its place in All listings, and its saved count does not change.
- Ken changes only the description of the helmet. The title and price stay the same.
- Ken tries to set the helmet's price to 100 yen. The change is rejected with a clear message, and the price stays 3,900 yen.
- Hana tries to edit or withdraw Ken's helmet through the API. The request is rejected.
- Mio tries to edit her camping stove, which is sold. The request is rejected.
- Hana saves Ken's mechanical keyboard, then Ken withdraws it. The keyboard is gone from All listings and search for everyone. Hana's Saved view still lists it, marked withdrawn, and she can remove it.
- Ken withdraws the keyboard again. Nothing changes, and no error is shown.
- Mio tries to buy or save the withdrawn keyboard. Both requests are rejected.
- A request without a signed-in user cannot edit or withdraw any listing.
- All existing tests still pass. New rules and new routes have tests, and every new route is described in docs/api/openapi.json.

## Out of scope

- Putting a withdrawn listing back on sale.
- Editing a listing after it is sold, or editing its seller, status or creation time directly.
- Deleting a listing permanently.
- A history of past edits, or showing buyers what changed.
- Notifications of any kind, including telling buyers who saved a listing that its price changed or that it was withdrawn.
- Photos or other new listing fields.
- Storing data outside the running process.

## Success measures

- 30% of sellers with an on-sale listing edit at least one listing within four weeks of release.
- Purchase attempts on items the seller no longer wants to sell drop, measured as fewer purchases followed by a seller support request to cancel.

## Open questions

- Should a buyer who saved a listing see a "price changed" marker in the Saved view? Not for this release; it overlaps with notifications.
- Should a seller be able to see their own withdrawn listings somewhere, for example in a future My page? Not for this release.
