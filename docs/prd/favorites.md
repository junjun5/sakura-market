# PRD: Favorites

| | |
| --- | --- |
| Status | Approved for planning |
| Owner | Product, Buyer Experience |
| Target | Next release |

## Background

Buyers often find an item they like but are not ready to buy it. Today the only
way back to that item is to search for it again. In interviews, 7 of 10 buyers
said they keep a list of items elsewhere (screenshots, notes).

Sellers have no signal of interest before a sale. They cannot tell an item
nobody looks at from an item that several people are considering.

## Goal

Let a buyer save listings and come back to them, and show sellers how many
people saved each listing.

## Users

- **Buyer**: a signed-in user who browses listings.
- **Seller**: the user who created a listing.

## Requirements

### Saving

1. A signed-in user can save a listing and remove it from their saved items.
2. Saving a listing that is already saved succeeds and changes nothing. The same holds for removing a listing that is not saved.
3. A user cannot save their own listing.
4. A user can keep at most 100 saved listings. Saving one more is rejected with a clear message.
5. Saving a listing that does not exist is rejected.

### Viewing saved items

6. A user can see their saved listings, most recently saved first.
7. A saved listing that is later sold stays in the list and is shown as sold.
8. Users can only see their own saved items.

### Signal for sellers and buyers

9. Every listing shows how many users have saved it. Everyone can see this number, signed in or not.
10. When a signed-in user views listings, each listing indicates whether that user has saved it.

### Web page

11. Each listing card has a heart button. It is filled when the listing is saved by the current user. Pressing it saves or removes the listing without reloading the page.
12. The heart button is not shown on the user's own listings.
13. Each listing card shows the saved count next to the heart.
14. A "Saved" view shows only the current user's saved listings. When it is empty, it says so and points the user back to all listings.
15. Switching the signed-in user updates hearts, counts and the Saved view.
16. If saving fails (for example, the limit is reached), the page shows the message from the server and the heart returns to its previous state.

## Acceptance criteria

- Hana saves Ken's helmet. The helmet's saved count goes from 0 to 1, and it appears first in Hana's Saved view.
- Hana saves the helmet again. Nothing changes, and no error is shown.
- Hana removes the helmet. The count returns to 0, and her Saved view no longer lists it.
- Ken tries to save his own helmet through the API. The request is rejected.
- Mio saves the helmet and Hana buys it. Mio's Saved view still lists the helmet, marked as sold.
- A user with 100 saved listings saves another. The request is rejected, and the user still has 100.
- A request without a signed-in user cannot save, remove or list saved items, but can still read saved counts.
- All existing tests still pass. New rules and new routes have tests.

## Out of scope

- Notifications of any kind, including price-drop alerts for saved items.
- Showing sellers *who* saved a listing.
- Sorting or filtering listings by saved count.
- Sharing a saved list with other users.
- Storing data outside the running process.

## Success measures

- 20% of weekly active buyers save one listing or more within four weeks of release.
- Purchases that start from the Saved view reach 5% of all purchases within eight weeks.

## Open questions

- Should a sold listing drop out of the Saved view after some time? Not for this release.
