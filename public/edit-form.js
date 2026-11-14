// The inline edit form on the seller's own card, and the card's small buttons.
// DOM only and nothing runs at import time: the draft and saving live in the
// controller, which rebuilds this form from them on every render.

/**
 * @typedef {import('./favorites-state.js').ClientListing} ClientListing
 * @typedef {import('./listing-actions.js').EditDraft} EditDraft
 * @typedef {import('./listing-actions.js').EditField} EditField
 * @typedef {{
 *   updateDraft: (listingId: string, field: EditField, value: string) => void,
 *   saveEdit: (listingId: string) => void,
 *   cancelEdit: (listingId: string) => void,
 * }} EditActions
 */

// `control` names the button in data-control, so focus can return to it after
// the card is rebuilt.
/**
 * @param {string} text
 * @param {string} control
 * @param {() => void} onClick
 */
export function controlButton(text, control, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.control = control;
  button.textContent = text;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * @param {ClientListing} listing
 * @param {EditDraft} draft
 * @param {EditActions} actions
 */
export function editForm(listing, draft, actions) {
  const form = document.createElement('form');
  form.className = 'edit-form';
  form.setAttribute('aria-label', `Edit ${listing.title}`);
  // The server checks every value and its message explains a rejection, so the
  // browser must not block the submit with its own validation.
  form.noValidate = true;

  /**
   * @param {string} labelText
   * @param {HTMLInputElement | HTMLTextAreaElement} input
   * @param {EditField} field
   */
  const labelled = (labelText, input, field) => {
    input.name = field;
    input.dataset.control = `edit-${field}`;
    input.value = draft[field];
    input.addEventListener('input', () => actions.updateDraft(listing.id, field, input.value));
    const label = document.createElement('label');
    label.append(labelText, input);
    return label;
  };

  const description = document.createElement('textarea');
  description.rows = 3;
  const price = document.createElement('input');
  price.type = 'number';
  price.inputMode = 'numeric';

  const save = document.createElement('button');
  save.type = 'submit';
  save.dataset.control = 'edit-save';
  save.textContent = draft.saving ? 'Saving…' : 'Save';
  const cancel = controlButton('Cancel', 'edit-cancel', () => actions.cancelEdit(listing.id));
  cancel.className = 'button-secondary';
  cancel.disabled = draft.saving;
  const buttons = document.createElement('div');
  buttons.className = 'edit-buttons';
  buttons.append(save, cancel);

  form.append(
    labelled('Title', document.createElement('input'), 'title'),
    labelled('Description', description, 'description'),
    labelled('Price (yen)', price, 'priceYen'),
    buttons,
  );
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    actions.saveEdit(listing.id);
  });
  return form;
}
