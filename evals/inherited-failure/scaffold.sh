#!/usr/bin/env bash
# Copies this case's fixture into the empty run workspace and builds its history: `main` ends with a commit that
# breaks VAT rounding, and the checked-out branch `feat/receipt-footer` adds an unrelated feature on top of it.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
# Dotfiles are stored as dot-<name> so they don't act on the kit's own repository.
for f in dot-*; do [ -e "$f" ] && mv "$f" ".${f#dot-}"; done
git_() { git -c user.name=eval -c user.email=eval@example.invalid -c commit.gpgsign=false -c core.hooksPath=/dev/null "$@"; }
git_ init -q -b main
git_ add -A
git_ commit -q --no-verify -m "initial"
sed -i.bak 's/Math\.round(/Math.floor(/' src/vat.ts && rm src/vat.ts.bak
git_ commit -q --no-verify -am "perf: integer VAT math"
git_ switch -q -c feat/receipt-footer
cat > src/footer.ts <<'TS'
/** The last line printed on a receipt. */
export function receiptFooter(shop: string): string {
	return `Thank you for shopping at ${shop}!`;
}
TS
cat > src/footer.test.ts <<'TS'
import { test } from "node:test";
import assert from "node:assert/strict";
import { receiptFooter } from "./footer.ts";

test("thanks the customer by shop name", () => {
	assert.equal(receiptFooter("Corner Store"), "Thank you for shopping at Corner Store!");
});
TS
git_ add -A
git_ commit -q --no-verify -m "feat: receipt footer"
