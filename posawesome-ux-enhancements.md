# POSAwesome UX Enhancements

Date: 2026-07-10

This file is the durable working record for POSAwesome UX changes, decisions, and follow-up ideas. Use this file for future POSAwesome UX progress notes.

## Invoice Items Keyboard Control

Goal:

- Keep the existing `Tab` behavior that returns focus to item search.
- Add keyboard-only control for the invoice items table.
- Let the operator enter the table from item search with `Alt/Option+ArrowRight`.
- Show a solid focus bounding box over the active row or cell.
- Support row-selection mode first, then cell-selection mode.
- Use arrow keys to move across editable cells and between rows.
- Use `Enter` to activate/edit the selected cell.

Implemented:

- `Alt/Option+ArrowRight` enters the invoice items table on the latest cart row.
- First focus state selects the whole row.
- `ArrowRight` enters cell mode for that row.
- Arrow keys move across navigable cells and between rows.
- `Enter` activates the focused quantity, UOM, discount, rate, offer, expand, or delete control.
- Read-only cells such as item name, price-list rate, and amount are skipped.

Verification:

- `yarn vitest run tests/cartFieldFocus.spec.ts tests/invoiceShortcuts.spec.ts tests/keyboardNavigation.spec.ts`
- `yarn lint`
- `yarn build`

Commits:

- `d6401f129 Add invoice item keyboard grid navigation`

## Quantity Input UX

Decision:

- Replace the quantity minus/value/plus counter in the invoice items table with a normal numeric input.
- Keep the existing quantity update logic so totals, stock checks, pricing, taxes, offline sync, and submission behavior remain unchanged.

Implemented:

- Quantity now renders as a direct visible numeric input.
- The keyboard grid focus selector points to the quantity input shell.

Verification:

- `yarn vitest run tests/cartFieldFocus.spec.ts tests/invoiceShortcuts.spec.ts tests/keyboardNavigation.spec.ts`
- `yarn lint`
- `yarn build`

Commits:

- `87fe8be42 Use direct quantity input in invoice table`

## Item Past Sales By Invoice

Finding:

- POSAwesome already has aggregated item/product sales data in the supervisor dashboard.
- It does not currently have a dedicated drill-down view that shows all past sales of a selected item with invoice numbers.

Data source:

- Current RetailMind POS mode uses `Sales Invoice` and `Sales Invoice Item`.
- If POS Invoice mode is enabled, item history should also consider `POS Invoice` and `POS Invoice Item`.

Decision:

- Replace the invoice item inline expanded row with a modal opened by item-row click or row-mode `Enter`.
- Modal tab 1 shows company-wide submitted non-return sales for that item across both `Sales Invoice` and `POS Invoice`.
- Modal tab 2 shows the same item details fields that currently appear in the inline expanded row.
- Exclude returns/credit notes from the sales history.
- Add pagination and filters for invoice/customer search, date range, and doctype.

Progress:

- Backend read-only API implemented in `posawesome.posawesome.api.items.get_item_sales_history`.
- API aggregates duplicate item rows per invoice, excludes returns/credit notes, supports both `Sales Invoice` and `POS Invoice`, and paginates results.
- Invoice item rows now open an item history/details modal on row click, history icon click, or row-mode `Enter`.
- Modal sales-history tab supports invoice/customer search, date filters, doctype filter, pagination, invoice viewing, `Esc` close, left/right tab switching, up/down row navigation, and `Enter` to view the selected invoice.
- Modal details tab reuses the existing item details form instead of the old inline expanded row.
- Plain arrow keys now enter the invoice-item keyboard grid without requiring `Alt/Option+ArrowRight`: `ArrowDown` starts at the first row, `ArrowUp` starts at the last row, `ArrowRight` starts at the first navigable cell, and `ArrowLeft` starts at the last navigable cell. Active editors and overlays keep their native arrow behavior.
- The item history modal now has its own default keyboard bounding box. Arrow keys move the box across tabs, filters, sales rows, pagination, and actions; `Enter` focuses/activates the boxed target; `Esc` exits field editing or closes the modal.

Verification:

- `yarn type-check`
- `yarn vitest run tests/cartFieldFocus.spec.ts tests/invoiceShortcuts.spec.ts tests/keyboardNavigation.spec.ts`
- `yarn build`
- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe python -m unittest posawesome.posawesome.api.test_items_numeric_code.TestItemSalesHistory`
- `bench --site retailmind.local run-tests --app posawesome --module posawesome.posawesome.api.test_items_numeric_code` is currently blocked by existing local ERPNext Fiscal Year fixture overlap before POSAwesome tests run.

## Sales Invoice vs POS Invoice

Current default before test switch:

- RetailMind POSAwesome was generating `Sales Invoice` documents with `is_pos = 1`.
- Local database check showed `Sales Invoice: 10` and `POS Invoice: 0`.
- POS Profile field `create_pos_invoice_instead_of_sales_invoice` was `0` for all local POS profiles.

Practical meaning:

- `Sales Invoice` mode creates the accounting invoice directly at sale time.
- `POS Invoice` mode creates POS-specific documents first, then POS closing can consolidate them into `Sales Invoice` records.

Recommendation captured during discussion:

- Keep `Sales Invoice` mode for normal RetailMind operation unless ERPNext-style POS Invoice consolidation is specifically needed.
- `Sales Invoice` mode does not require closing for accounting consolidation, but closing is still useful for cashier/day-end reconciliation.

## POS Closing And Consolidation

Finding:

- This POSAwesome fork includes POS opening and POS closing flows.
- Relevant doctypes include `POS Opening Shift`, `POS Closing Shift`, and `POS Invoice Submission Ledger`.
- The POS UI includes a closing dialog.

Closing behavior:

- In `Sales Invoice` mode, closing creates/submits a `POS Closing Shift`, links invoices, reconciles payments/cash, submits printed draft invoices, and can clean draft invoices. No invoice consolidation is needed because sales are already `Sales Invoice` records.
- In `POS Invoice` mode, closing also calls ERPNext POS invoice consolidation so POS invoices are consolidated into `Sales Invoice` records.

Local status before test switch:

- `POS Closing Shift` records: `0`
- `POS Opening Shift` records: `3`

## Supervisor Behavior

Finding:

- POSAwesome supervisor is a normal Frappe `User`, not an accounting account.
- Supervisor status is determined by the `POS Awesome Supervisor` role, with legacy support for the old `posa_is_pos_supervisor` user field.

Local supervisor:

- User: `aqib@ai.ai`
- Full name: `Aqib Hameeed`
- Role: `POS Awesome Supervisor`
- Assigned POS Profile: `POS Awesome - MedPlus`

Invoice management behavior:

- Supervisors can use the POS Profile selector in Invoice Management.
- The selector includes `All`.
- Selecting `All` removes the `pos_profile` filter and uses company scope.
- Non-supervisor users remain scoped to their current POS Profile.

## 2026-07-10 Local POS Invoice Test Switch

Request:

- Enable POS Invoice mode locally so the POS closing/consolidation flow can be tested.

Action:

- Set `create_pos_invoice_instead_of_sales_invoice = 1` for local POS Profiles:
  - `POS Awesome - MedPlus`
  - `POS Awesome - MedPlus Cashier`
  - `POS Terminal 1`
- Cleared Frappe cache for `retailmind.local`.

Expected result:

- New POS sales should now be created as `POS Invoice`.
- Existing `Sales Invoice` records remain unchanged.
- Closing the active shift should create a `POS Closing Shift` and run POS Invoice consolidation into `Sales Invoice` records.

Rollback command:

```sql
update `tabPOS Profile`
set create_pos_invoice_instead_of_sales_invoice = 0
where name in ('POS Awesome - MedPlus', 'POS Awesome - MedPlus Cashier', 'POS Terminal 1');
```

## 2026-07-10 Invoice Items Direct Keyboard Editing

Issue:

- The invoice items grid required `Enter` to activate a cell before typing.
- After entering a value, focus could leave the invoice table and return to item search.
- Quantity keyboard focus could land on the visual shell instead of the actual input.
- The focused quantity cell showed both the outer grid bounding box and the inner text-field outline.

Decision:

- When the grid bounding box enters an editable cell, that cell should become ready for typing immediately.
- `Enter` after typing should commit the current value and move to the next editable entry in the same row.
- `ArrowRight` and `ArrowLeft` should commit the active field and move the bounding box across columns.
- `ArrowUp` and `ArrowDown` should commit the active field and move to the same column on the adjacent row.
- The active input should blur before movement so the caret does not stay behind and interfere with grid navigation.

Implementation notes:

- Grid key handling now runs in capture phase so arrow and enter navigation are handled before inner inputs consume those keys.
- Quantity grid focus now targets the real numeric input, not only the outer quantity shell.
- Editable grid cells auto-activate on focus: quantity, UOM, discount %, discount amount, and rate.
- Non-edit cells such as offer, delete, and expand still require activation.
- Quantity inner text-field outline is suppressed while the grid cell bounding box is active to avoid double-box UI.

Verification:

- `yarn vitest run tests/cartFieldFocus.spec.ts tests/invoiceShortcuts.spec.ts tests/keyboardNavigation.spec.ts`
- `yarn build`
- `yarn lint`

Follow-up:

- Quantity edit mode now starts with an empty input so operators can type the replacement quantity immediately.
- If the operator leaves quantity blank and moves away, the previous cart quantity is restored instead of being overwritten.

## 2026-07-10 Item Quick Edit Modal

Request:

- Add a POS item-maintenance modal based on the legacy pharmacy item screen.
- Open it from POS with `F12` on Windows/non-Mac terminals and `Option+7` on macOS.
- Make pricing and item-control changes enforceable in the system.

Implemented:

- Added backend migration `posawesome.patches.add_item_quick_edit_fields`.
- Added custom fields:
  - `POS Profile.posa_allow_item_quick_edit`
  - `Item.retailmind_short_name`
  - `Item.retailmind_controlled_item`
  - `Item.retailmind_non_discountable`
  - `Item.retailmind_locked_for_sale`
- Added backend API module `posawesome.posawesome.api.item_quick_edit`:
  - `get_item_quick_edit`
  - `save_item_quick_edit`
- Added backend sale-control validation module:
  - POS-only locked items are blocked by cart/invoice validation.
  - Non-discountable items reject line discounts server-side.
  - Controlled items are warning/logging flags only for v1.
- Added frontend modal `ItemQuickEditDialog.vue`.
- Wired `F12` and macOS `Option+7` shortcuts through the existing invoice shortcut handler.
- Wired saved item rows back into the POS item catalog and active cart rows.
- Added immediate client-side blocking for locked items and disabled discount editing for non-discountable rows.
- Expanded invoice item keyboard control:
  - Plain arrow keys outside text-editing inputs now enter the invoice items grid and show the bounding box.
  - Arrow keys pressed inside the invoice items table also auto-activate row/cell navigation when the grid is inactive.
  - Text inputs outside the cart keep normal arrow-key caret/search behavior.

Design note:

- A visual design preview was generated with imagegen at `/Users/mac/.codex/generated_images/019f4b80-6ba5-7692-acdc-4329484ef431`.
- The unlabeled `15` field from the legacy screenshot is intentionally not implemented until its old-POS source column is confirmed.

Verification:

- `node -e "JSON.parse(require('fs').readFileSync('posawesome/fixtures/custom_field.json','utf8'))"`
- `/Users/mac/anaconda3/bin/conda run -n frappe python -m unittest posawesome.posawesome.api.test_item_sale_controls`
- `/Users/mac/anaconda3/bin/conda run -n frappe python -m unittest posawesome.posawesome.api.invoice_processing.test_creation`
- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe python -c "import posawesome.posawesome.api.item_quick_edit; import posawesome.posawesome.api.item_sale_controls; print('quick edit imports ok')"`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local migrate`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local execute posawesome.posawesome.api.item_quick_edit.get_item_quick_edit --kwargs "{'item_code':'CH062','pos_profile':'POS Awesome - MedPlus'}"`
- `yarn test:unit tests/invoiceShortcuts.spec.ts`
- `yarn type-check`
- `yarn lint`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench build --app posawesome`

Notes:

- Retail price updates also synchronize the active selling item price, `Retail Selling` and `Standard Selling` when those price lists exist, and `Item.standard_rate`.
- Trade price updates synchronize the buying item price only.
- Item quick edit save is available to privileged item/stock/system managers, or to POS supervisors only when the active POS Profile has `posa_allow_item_quick_edit` enabled.

## 2026-07-10 Quick Edit Selection And Supplier Mapping Fix

Issue:

- `F12` and macOS `Option+7` opened the item quick-edit modal with the latest cart row instead of the row selected by the invoice-items bounding box.
- Plain arrow keys did not enter the invoice-items grid while focus was inside POS search fields, so the bounding box could feel unavailable.
- Items without direct `Item Supplier` rows did not show supplier data even when the RetailMind brand-supplier mapping existed.

Implemented:

- Invoice item table now remembers the active/selected row separately from whether grid mode is currently active.
- Quick edit resolves item code from active grid row, then remembered selected row, then latest row as a fallback.
- Product search and invoice item search fields are marked so plain arrow keys enter the invoice-items grid at a default row.
- Quick-edit supplier loading now uses direct `Item Supplier` first, then falls back to `RetailMind Supplier Brand Mapping` by item brand.

Verification:

- `yarn test:unit tests/invoiceShortcuts.spec.ts tests/invoiceQuickEditSelection.spec.ts`
- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe python -m unittest posawesome.posawesome.api.test_item_quick_edit`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local execute posawesome.posawesome.api.item_quick_edit.get_item_quick_edit --kwargs "{'item_code':'39017','pos_profile':'POS Awesome - MedPlus'}"` returned mapped supplier `HARIS TRADERS-MEIJI MILK (1)` from `RetailMind Supplier Brand Mapping`.

## 2026-07-10 Invoice Item Quantity Enter Navigation Fix

Issue:

- After adding/selecting an item, keyboard focus moved to quantity, but pressing `Enter` after typing a quantity could commit the value without moving the bounding box to the next editable invoice-item cell.
- The old quantity submit path only advanced when the quantity value changed, so unchanged/default quantities could leave the keyboard workflow feeling frozen.

Implemented:

- Quantity `Enter` now always commits the current editor state and emits a submit/advance event, even when the typed quantity matches the current row quantity.
- Discount amount and rate editors now emit the same submit/advance signal as quantity and discount percentage.
- The invoice-items table now resolves the submitting row, re-enters cell mode at that row/column, and advances through the shared grid entry navigation path.
- Added focused coverage for the unchanged-quantity `Enter` case.

Verification:

- `yarn test:unit tests/cartItemRowKeyboard.spec.ts tests/cartFieldFocus.spec.ts`
- `yarn test:unit tests/invoiceShortcuts.spec.ts tests/invoiceQuickEditSelection.spec.ts`
- `yarn type-check`
- `yarn lint`

## 2026-07-10 Submitted Invoice Edit Keyboard UX

Implemented:

- The submitted invoice edit modal now opens with a visible keyboard bounding box instead of focusing an input immediately.
- Arrow keys move the box across customer/discount fields, item quantity/rate/discount cells, item delete buttons, add-item fields, payment amount fields, cancel, submit, and close.
- `Enter` focuses the boxed input for editing or activates the boxed button.
- While editing a field, arrow keys stay inside the field for normal cursor/value control; `Enter` commits the field and advances the box; `Esc` leaves field editing or closes the modal.
- The modal keeps normal `Ctrl/Cmd+Enter` submit behavior.
- Payment rows in the edit modal are now automatic. The primary payment row, normally Cash, is adjusted to the corrected invoice total after preview and before submit.
- The modal shows a cashier settlement summary: collect the difference when the corrected total is higher than the original paid amount, refund the difference when the corrected total is lower, or no cash difference when unchanged.
- Fixed the focus handoff so pressing `Enter` on the bounding box places the cursor inside the selected editable field instead of immediately returning focus to the modal shell.

Verification:

- `yarn type-check`
- `yarn vitest run tests/cartFieldFocus.spec.ts tests/invoiceShortcuts.spec.ts tests/keyboardNavigation.spec.ts`
- `yarn build`

## 2026-07-10 Product Search Arrow Navigation Fix

Implemented:

- Removed invoice-grid arrow capture from the product selector search field so `ArrowDown` continues into the product search results instead of moving focus to the invoice items table.
- Kept invoice-item search grid entry behavior scoped to the cart search field.

## 2026-07-10 POS Keyboard Accessibility Playwright Suite

Implemented:

- Added an opt-in real-browser Playwright E2E suite at `frontend/tests/e2e/pos-keyboard-accessibility.spec.ts`.
- The suite models the real counter workflow: product search, invoice grid editing, item history, item quick edit, saved drafts, payment, invoice management, and submitted invoice edit.
- Added stable `data-testid` hooks for keyboard-critical POS surfaces without changing user-visible UI.
- The suite is gated behind `POSA_KEYBOARD_E2E=1` because it creates real invoices and temporarily enables item quick edit on the configured POS Profile.

Run:

- `POSA_KEYBOARD_E2E=1 POSA_SMOKE_BASE_URL=http://127.0.0.1:8000 POSA_SMOKE_USER=<user> POSA_SMOKE_PASSWORD=<password> yarn playwright test --config=playwright.config.ts tests/e2e/pos-keyboard-accessibility.spec.ts`

Verification:

- `yarn type-check`
- `yarn playwright test --config=playwright.config.ts --list`
- `yarn vitest run tests/invoiceShortcuts.spec.ts tests/keyboardNavigation.spec.ts tests/cartFieldFocus.spec.ts tests/cartItemRowKeyboard.spec.ts tests/itemHeader.spec.ts`
- Local opt-in Playwright execution reached the login page and stopped with the expected setup error because no Playwright credentials/session were configured in this shell.

## 2026-07-10 Credentialed Keyboard E2E Hardening

Issues resolved:

- Cart rows were hidden by an over-broad CSS rule targeting every `tr[data-testid]` in the cart table.
- Product search `Enter` could throw when `displayedItems` was momentarily undefined during search reset.
- Keyboard grid entry could land on Rate even when the POS Profile disallowed rate editing.
- Item history modal opened with the bounding box on the first sales row, so `ArrowRight` + `Enter` opened invoice view instead of switching tabs.
- Item Quick Edit had unreliable initial focus and Tab movement between the Name and Short Name fields.
- Drafts drawer Escape behavior was not reliable when focus stayed outside the drawer after global shortcut open.
- The Playwright harness now uses the local `/desk/posapp` route, retries through login when needed, records page error stacks, and targets the active drafts drawer/dialog instead of retained off-canvas content.

Verification:

- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`
- `POSA_KEYBOARD_E2E=1 POSA_SMOKE_BASE_URL=http://127.0.0.1:8000 POSA_SMOKE_USER=aqib@ai.ai POSA_SMOKE_PASSWORD=alpha123 yarn playwright test --config=playwright.config.ts tests/e2e/pos-keyboard-accessibility.spec.ts --reporter=list`
- Result: `6 passed (2.3m)`.

## 2026-07-10 Invoice Edit and Item History Keyboard Fixes

Issues resolved:

- In the submitted invoice edit modal, pressing `Enter` on a focused discount field could stay on the same field when the value was not changed.
- In the item sales history modal, closing the nested invoice preview with `Esc` could leave focus in the closed preview and stop arrow-key bounding-box navigation.
- The credentialed Playwright suite could race the live POS item sync and transient bench login responses, causing false failures before the keyboard path under test.

Implemented:

- Submitted invoice edit `Enter` handling now advances when the active field belongs to the current edit-navigation target, even if no value changed.
- Item sales history invoice preview close now restores the prior modal keyboard target, refocuses the modal shell, and keeps arrow navigation alive.
- Added regression coverage for opening an item-history invoice preview, closing it with `Esc`, and continuing arrow navigation in the parent modal.
- Hardened the real-browser keyboard suite with login retries, explicit item fixture discovery, highest positive selling-price selection, and POS search retry while the offline item index is syncing.

Verification:

- `yarn build`
- `yarn type-check`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`
- `POSA_KEYBOARD_E2E=1 POSA_SMOKE_BASE_URL=http://127.0.0.1:8000 POSA_SMOKE_USER=aqib@ai.ai POSA_SMOKE_PASSWORD=alpha123 yarn playwright test --config=playwright.config.ts tests/e2e/pos-keyboard-accessibility.spec.ts -g "operator can add items and edit invoice grid fully from keyboard" --reporter=list`
- Result: `1 passed (54.9s)`.
- `POSA_KEYBOARD_E2E=1 POSA_SMOKE_BASE_URL=http://127.0.0.1:8000 POSA_SMOKE_USER=aqib@ai.ai POSA_SMOKE_PASSWORD=alpha123 yarn playwright test --config=playwright.config.ts tests/e2e/pos-keyboard-accessibility.spec.ts --reporter=list`
- Result: `6 passed (3.0m)`.

## 2026-07-11 Product Search Enter Selection Fix

Issue resolved:

- When a cashier searched products, used `ArrowDown` to highlight a result, and pressed `Enter`, the highlighted product was not added if the POS search path was in limit-search mode. Mouse click still worked because it used the row click path directly.

Implemented:

- Product search `Enter` now selects the currently highlighted result before falling back to running another search.
- Added unit coverage for highlighted-result `Enter` selection in limit-search mode.
- Extended the real-browser keyboard test to press `Enter` after `ArrowDown` and expect the selected product to appear in the invoice item table.

Verification:

- `yarn test:unit tests/useItemsSelectorSearch.spec.ts`
- `yarn type-check`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`
- Attempted focused Playwright run for the product search keyboard scenario; the local test browser failed before the new assertion because the POS item index returned `No items found` for the fixture item `A3106`.

## 2026-07-11 Product Search Highlight Scrolling Fix

Issue resolved:

- In the searched product list, repeated `ArrowDown` / `ArrowUp` navigation could move the highlighted item out of view without scrolling.
- Fast arrow-key navigation could leave multiple visible rows styled as selected because the virtualized table reused DOM rows.

Implemented:

- Product result rows now explicitly expose selected and unselected state through row props instead of only adding a class to the active row.
- The list view now receives the active highlighted item code, removes stale highlight classes from recycled rows, and scrolls the active row into view after each highlight change.
- Added unit coverage for selected/unselected row props and selector row metadata.

Verification:

- `yarn test:unit tests/itemSelectorHighlightBindings.spec.ts tests/useItemsSelectorDisplayBindings.spec.ts tests/useItemSelectionFlyAnimation.spec.ts`
- `yarn type-check`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`

## 2026-07-11 Item Quick Edit Trade Discount Field

Issue resolved:

- The Item Quick Edit modal was missing the old-POS percentage field shown between Retail Price and Trade Price.
- Cashiers could edit retail and trade prices, but could not enter the retail-to-trade percentage difference directly.

Implemented:

- Added a transient `Discount %` pricing field between Retail Price and Trade Price.
- The field is calculated as `(retail price - trade price) / retail price * 100`.
- Editing the percentage updates Trade Price using `retail price * (1 - discount / 100)`.
- Editing Retail Price or Trade Price recalculates the displayed percentage.
- The backend save payload still persists only real pricing fields: retail price and trade price.

Verification:

- `yarn test:unit tests/itemQuickEditPricing.spec.ts`
- `yarn type-check`
- `yarn lint`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench build --app posawesome`

## 2026-07-11 Cart Editor Keyboard Value Flow

Issue resolved:

- Quantity, rate, and discount editors could open with a blank field while the keyboard bounding box was active, making cashiers lose sight of the current value before typing.
- Pressing `Enter` after editing discount advanced away from the discount cell, even though the desired workflow is to keep the discount cell selected and return arrow keys to bounding-box navigation.

Implemented:

- Cart row direct editors now seed their input value from the current item state before focusing/selecting the field.
- Quantity focus no longer clears the visible value.
- Rate, discount percent, and discount amount editors reset to the current item value on submit/cancel instead of blanking.
- Discount editor submit now keeps the bounding box on the same discount cell, while quantity and rate continue advancing through the normal entry flow.
- Added unit coverage for quantity focus preserving the visible value and discount percent editing opening with the current value.

Verification:

- `yarn prettier --write src/posapp/components/pos/invoice/CartItemRow.vue src/posapp/components/pos/invoice/ItemsTable.vue src/posapp/components/pos/items/ItemQuickEditDialog.vue tests/cartItemRowKeyboard.spec.ts`
- `yarn test:unit tests/cartItemRowKeyboard.spec.ts tests/cartFieldFocus.spec.ts`
- `yarn type-check`
- `yarn build`

## 2026-07-11 Product Search Arrow-Key Regression Fix

Issue resolved:

- After the invoice-grid keyboard work, `ArrowDown` / `ArrowUp` from the item search field could be intercepted by the broader POS keyboard layer instead of staying in product results.
- This made searched products impossible to select from the keyboard in the normal cashier flow.
- The item selector internally selected the correct result, but the virtual table row did not receive `data-item-code`, so the visible teal highlight was not applied.

Implemented:

- Item search now captures `ArrowDown` / `ArrowUp` on the DOM wrapper around the search input and sends those events directly to item-result navigation.
- The regular search keydown handler skips already-captured arrow events so a single key press cannot move the result highlight twice.
- Invoice-grid arrow entry now explicitly ignores events originating from the item search field.
- Virtual table row metadata now resolves Vuetify row wrappers before attaching `data-item-code`, `aria-selected`, and row highlight state.
- Added regression coverage to ensure invoice shortcuts do not steal arrows from item search and row metadata is generated for virtual table wrapper items.

## 2026-07-11 Below Buying Price Loss Guard

Issue:

- Cashiers could apply a line discount that made the effective selling rate lower than the buying/trade price.
- The POS had no immediate visual warning and no submit-time block for this loss-making sale scenario.

Implemented:

- POS item search rows now carry `trade_price`/`buying_rate` from the active buying price list, matching the Item Quick Edit trade-price source.
- Cart rows turn red as soon as the effective row rate falls below trade price/buying rate.
- Payment validation blocks submission before offline save or online server submit when any sale row is below the buying floor.
- POSAwesome backend item sale controls now also block below-buying-price submissions, so stale clients/direct POSAwesome submits cannot bypass the rule.
- Added unit tests for the shared loss calculation, cart row red state, payment validation block, backend sale control, and a Playwright keyboard-flow scenario.

Verification:

- `yarn --cwd frontend test:unit tests/lossPrevention.spec.ts tests/cartItemRowKeyboard.spec.ts tests/usePaymentSubmission.spec.ts`
- `yarn --cwd frontend type-check`
- `yarn --cwd frontend build`
- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe python -m unittest posawesome.posawesome.api.test_item_sale_controls`
- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe python -m py_compile posawesome/posawesome/api/item_fetchers.py posawesome/posawesome/api/item_sale_controls.py`
- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`
- `POSA_KEYBOARD_E2E=1 POSA_SMOKE_BASE_URL=http://127.0.0.1:8000 POSA_SMOKE_USER=aqib@ai.ai POSA_SMOKE_PASSWORD=alpha123 POSA_KEYBOARD_TEST_ITEMS=02017,02016,02249 yarn --cwd frontend playwright test --config=playwright.config.ts tests/e2e/pos-keyboard-accessibility.spec.ts -g "below buying price sale turns row red and blocks keyboard submit" --reporter=list`
- Result: targeted Playwright scenario passed; backend guard blocked `ARINAC FORT TAB 100"S` at rate `12.3` below buying/trade price `12.75`.

### 2026-07-17 Buying Floor Correctness Hardening

- Backend validation now resolves the buying floor from authoritative Item Price master data and no longer trusts client-supplied `trade_price`/`buying_rate` values.
- Buying floors honor Item Price validity dates, ignore customer/supplier-specific rows, prefer the selected UOM, and convert stock-UOM prices with the Item master conversion factor.
- Buying-list rates are normalized through company currency into the invoice currency before comparison; missing required exchange rates block validation instead of silently comparing incompatible values.
- Item detail responses expose buying prices by UOM in company currency so cart warnings use the same UOM/currency contract.
- Offline Item Price sync now includes the resolved buying price list and persists UOM, currency, supplier/customer, buying/selling, and validity metadata. The schema bump forces existing clients to refresh the expanded scope.
- Offline item detail hydration rebuilds buying floors from IndexedDB and dated currency-rate records.

- Updated the Playwright helper to press `Enter` after filling item search, matching limited-search cashier workflow.

Verification:

- `yarn test:unit tests/itemSelectorHighlightBindings.spec.ts tests/useItemsSelectorDisplayBindings.spec.ts tests/useItemsSelectorSearch.spec.ts tests/useItemsSelectorFocus.spec.ts tests/invoiceShortcuts.spec.ts`
- `yarn type-check`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`
- Manual browser verification with `arinac`: press `Enter` to search, `ArrowDown` highlights item `02017`, `Enter` adds it to cart.
- `POSA_KEYBOARD_E2E=1 POSA_SMOKE_BASE_URL=http://127.0.0.1:8000 POSA_SMOKE_USER=aqib@ai.ai POSA_SMOKE_PASSWORD=alpha123 POSA_KEYBOARD_TEST_ITEMS=02017,02016,02249 yarn playwright test --config=playwright.config.ts tests/e2e/pos-keyboard-accessibility.spec.ts -g "product search down arrow stays in product results" --reporter=list`
- Result: `1 passed (36.5s)`.

### 2026-07-17 Configurable Sale-Floor Policy and POS Supervisor Override

- POS Profile is now the source of truth for enabling the guard, selecting `Block`, `POS Supervisor Override`, or `Warning Only`, setting a minimum margin, and deciding whether missing buying cost blocks submission.
- Existing profiles remain safe by default: the guard is enabled, the action is `Block`, the minimum margin is zero, and missing cost retains the prior allow behavior.
- Only a verified POS Supervisor can approve an override. General manager roles do not receive this authority, and override approval requires an online connection and a reason.
- The backend re-authorizes the POS Supervisor and stores the actor, reason, and per-item rate/floor details on Sales Invoice and POS Invoice for audit reporting.
- Invoice-level percentage and fixed-amount discounts are allocated into the effective selling rate before frontend and backend floor validation.
- The policy is consumed from the active POS Profile, so the same settings are available in the cached profile used by the POS. Backend validation remains authoritative for online submission.

Verification:

- `python -m unittest posawesome.posawesome.api.test_item_sale_controls posawesome.posawesome.api.test_sale_floor_profile_settings` (`22 passed`)
- `pnpm exec vitest run tests/lossPrevention.spec.ts tests/usePaymentSubmission.spec.ts` (`36 passed`)
- `pnpm exec vue-tsc --noEmit`
- Targeted ESLint for all changed frontend policy, payment, cart, employee-store, dialog, and test files.

## 2026-07-11 Cart Numeric Input Helper Suppression

Issue resolved:

- Cart quantity, rate, and discount editors still used native browser number inputs, which showed spinner controls and browser helper/autofill popovers over the POS grid.
- Clicking into a populated numeric editor could leave the old value in place, making cashiers manually clear before typing.

Implemented:

- Cart numeric editors now use `type="text"` with `inputmode="decimal"` so numeric keyboards still work without native browser number spinners.
- Quantity, rate, discount percent, and discount amount editors disable autocomplete, autocorrect, autocapitalize, and spellcheck.
- POS app shell now suppresses browser input helpers for all POS inputs as they are rendered.
- First printable key, Backspace, Delete, or paste after entering a numeric editor clears the prior value so the cashier's input overrides it.
- Added focused regression tests for replacement behavior and helper-disabled field attributes.

Verification:

- `yarn test:unit tests/cartItemRowKeyboard.spec.ts tests/cartFieldFocus.spec.ts tests/invoiceShortcuts.spec.ts`
- `yarn type-check`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local clear-cache`
- Browser verification with `arinac`: add item, click quantity, confirmed `type=text`, `inputmode=decimal`, helper attributes disabled, typing `2` replaces old `1` with `2`.

## 2026-07-11 Item Quick Edit Keyboard Bounding Box

Issue resolved:

- Item Quick Edit fields were reachable by mouse and Tab, but the modal did not support the POS spatial keyboard UX.
- Arrow keys inside the modal behaved like normal input caret/menu movement instead of showing and moving the bounding box.

Implemented:

- Added modal-local keyboard target state for lookup, load, identity fields, pricing fields, controls, close, cancel, and update.
- The modal now opens loaded items with a visible bounding box on Name instead of silently entering field edit mode.
- Plain arrow keys show/move the bounding box from anywhere in the modal.
- `Enter` on a boxed field enters edit mode and selects the field value.
- `Enter` while editing commits the field value, blurs the input, and returns control to the bounding box.
- `Escape` leaves edit mode first, then closes the modal when already in bounding-box mode.
- Extended the POS keyboard Playwright suite to assert the quick-edit bounding-box flow.

Verification:

- `yarn test:unit tests/itemQuickEditPricing.spec.ts`
- `yarn type-check`
- `yarn lint`
- `yarn playwright test --config=playwright.config.ts --list`
- `yarn build`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench build --app posawesome`

## 2026-07-11 Item Quick Edit Save Timeout Fix

Issue resolved:

- The Item Quick Edit modal could keep spinning and report a request timeout when pressing Update.
- The item write completed, but the save response tried to rebuild `pos_item` through the full POS catalog search path.
- That response path also attempted to JSON serialize the full POS Profile dict, including datetime fields, which can fail before the browser receives a clean response.

Implemented:

- Split the quick-edit item payload builder from the full modal loader so save no longer reloads options after committing.
- Replaced the post-save POS catalog search with a lightweight `pos_item` row built directly from the saved item payload and retail rate.
- Added regression coverage for the lightweight row builder so cart/catalog refresh still receives `rate`, `price_list_rate`, and `uom`.

Verification:

- `PYTHONPATH=/Users/mac/frappe-bench/apps/frappe:/Users/mac/frappe-bench/apps/erpnext:/Users/mac/frappe-bench/apps/posawesome /Users/mac/anaconda3/bin/conda run -n frappe python -m unittest posawesome.posawesome.api.test_item_quick_edit`
- `/Users/mac/anaconda3/bin/conda run -n frappe bench --site retailmind.local execute posawesome.posawesome.api.item_quick_edit.save_item_quick_edit --kwargs "{'data': {'item_code':'A3106','barcode':'CF','item_name':'PANADOL CF TAB 1','description':'PANADOL CF TAB','item_group':'Medicines','brand':'\\u0000','max_discount':0,'standard_rate':10,'retailmind_units_per_pack':100,'retailmind_old_pos_generic_code':'0','retailmind_old_pos_generic_name':'.','retailmind_old_pos_pack':'1','primary_supplier':'MULLER & PHIPPS PAKISTAN FSD.DEPOT (1013)','selling_price_list':'Standard Selling','buying_price_list':'Standard Buying','retail_price':10,'trade_price':9,'pos_profile':'POS Awesome - MedPlus'}}"`
- Result: live save for `A3106` returned successfully in about 6 seconds with updated `item` and lightweight `pos_item` payload.
