// Shipping price calculation. Written in 2019 for the first checkout; no tests.
// Used by checkout, the order confirmation email and the monthly invoice export.

export function shippingCost(order: any): number {
	var w = 0;
	for (var i = 0; i < order.items.length; i++) {
		w = w + order.items[i].weightGrams * order.items[i].qty;
	}
	var kg = Math.ceil(w / 1000);
	if (kg == 0) kg = 1;
	var cost;
	if (order.country == "DE") {
		cost = 490 + (kg - 1) * 120;
	} else if (order.country == "FR" || order.country == "NL" || order.country == "BE" || order.country == "AT") {
		cost = 890 + (kg - 1) * 180;
	} else {
		cost = 1590 + (kg - 1) * 350;
	}
	// free shipping in Germany over 50 EUR
	if (order.subtotalMinor > 5000 && order.country == "DE") cost = 0;
	if (order.coupon && order.coupon.indexOf("SHIP") == 0) cost = Math.round(cost / 2);
	return cost;
}
