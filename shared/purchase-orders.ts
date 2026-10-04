import { z } from 'zod';
import { lineItemSchema, type LineItem } from './biz-common';
export const ORDER_TYPES = ['supplier', 'customer'] as const;
export const ORDER_STATUSES = ['draft', 'review', 'approved', 'sent', 'open', 'received', 'confirmed', 'in_production', 'delivered', 'invoiced', 'closed', 'cancelled'] as const;
export type OrderType = typeof ORDER_TYPES[number];
export type OrderStatus = typeof ORDER_STATUSES[number];
export const ORDER_LABELS: Record<OrderStatus, string> = { draft: 'Draft', review: 'Needs review', approved: 'Approved', sent: 'Sent to supplier', open: 'Open', received: 'Received', confirmed: 'Confirmed', in_production: 'In production', delivered: 'Delivered', invoiced: 'Invoiced', closed: 'Closed', cancelled: 'Cancelled' };
export const ORDER_TRANSITIONS: Record<OrderType, Partial<Record<OrderStatus, OrderStatus[]>>> = {
    supplier: { draft: ['review', 'cancelled'], review: ['draft', 'approved', 'cancelled'], approved: ['sent', 'cancelled'], sent: ['cancelled'], open: ['cancelled'], received: ['closed'], closed: [], cancelled: [] },
    customer: { draft: ['review', 'cancelled'], review: ['draft', 'confirmed', 'cancelled'], confirmed: ['in_production', 'cancelled'], in_production: ['delivered', 'cancelled'], delivered: ['invoiced'], invoiced: ['closed'], closed: [], cancelled: [] },
};
const text = (max = 4000) => z.string().trim().max(max).default('');
export const calendarDate = z.string().refine(v => {
    if (!v)
        return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v))
        return false;
    const date = new Date(v + 'T12:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === v;
}, 'Use a valid calendar date.');
export const orderDetailsSchema = z.object({
    business: z.enum(['metals', 'concrete', 'insulation', 'trades']).default('metals'),
    contactName: text(160), email: text(254).refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email.'), phone: text(60),
    billingAddress: text(1000), deliveryAddress: text(1000), deliveryTerms: text(2000), paymentTerms: text(2000),
    scope: text(10000), exclusions: text(4000), finish: text(2000), specifications: text(10000), customerMaterials: text(4000),
    issueDate: calendarDate.default(''), receivedDate: calendarDate.default(''), deliveryIncluded: z.boolean().default(false),
}).strict();
export type OrderDetails = z.infer<typeof orderDetailsSchema>;
export const emptyOrderDetails = () => orderDetailsSchema.parse({});
export const orderLineSchema = lineItemSchema.extend({
    description: z.string().trim().min(1).max(1000), qty: z.number().positive().finite().max(1000000),
    unitPriceCents: z.number().int().min(0).max(100000000000), unit: z.string().trim().max(30).optional(),
});
const id = z.number().int().positive().nullable().optional();
const cents = z.number().int().min(0).max(100000000000);
export const orderInputSchema = z.object({
    orderType: z.enum(ORDER_TYPES), vendor: text(200), customerName: text(200),
    clientId: id, leadId: id, quoteId: id, projectId: id,
    customerPoNumber: text(100), customerProjectNumber: text(100),
    items: z.preprocess(v => typeof v === 'string' ? JSON.parse(v) : v, z.array(orderLineSchema).min(1).max(200)),
    expectedDate: calendarDate.nullable().optional(), notes: text(10000).nullable().optional(),
    details: orderDetailsSchema.default({}), discountCents: cents.default(0), shippingCents: cents.default(0),
    taxRateBp: z.number().int().min(0).max(10000).default(0), taxShipping: z.boolean().default(false),
    depositCents: cents.default(0),
}).strict();
export type OrderInput = z.infer<typeof orderInputSchema>;
export function orderTotals(items: LineItem[], input: {
    discountCents?: number;
    shippingCents?: number;
    taxRateBp?: number;
    taxShipping?: boolean;
    depositCents?: number;
}) {
    const subtotalCents = items.reduce((s, l) => s + Math.round(l.qty * l.unitPriceCents), 0);
    const discountCents = input.discountCents || 0, shippingCents = input.shippingCents || 0, depositCents = input.depositCents || 0;
    if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 100000000000)
        throw new Error('Order amount is too large.');
    if (subtotalCents < 0 || discountCents > subtotalCents)
        throw new Error('Discount cannot exceed the subtotal.');
    const taxCents = Math.round((subtotalCents - discountCents + (input.taxShipping ? shippingCents : 0)) * (input.taxRateBp || 0) / 10000);
    const totalCents = subtotalCents - discountCents + shippingCents + taxCents;
    if (depositCents > totalCents)
        throw new Error('Deposit cannot exceed the total.');
    return { subtotalCents, discountCents, shippingCents, taxCents, totalCents, depositCents, balanceCents: totalCents - depositCents };
}
// Apply order-level costs cumulatively so split deliveries sum to the exact
// approved total, including the final rounding cent. Credits use the legacy path.
export function receivedOrderCost(order: any, lines: LineItem[], received: Map<number, number>) {
    return lines.reduce((sum, _line, index) => sum + receivedLineCost(order, lines, index, received.get(index) || 0), 0);
}
export function receivedLineCost(order: any, lines: LineItem[], index: number, quantity: number) {
    const line = lines[index];
    if (!(order.revision > 0))
        return Math.round(quantity * line.unitPriceCents);
    const full = order.total_cents ?? order.totalCents;
    const amounts = lines.map(l => Math.round(l.qty * l.unitPriceCents));
    const subtotal = amounts.reduce((s, v) => s + v, 0);
    const before = amounts.slice(0, index).reduce((s, v) => s + v, 0);
    const allocation = subtotal > 0 ? Math.round(full * (before + amounts[index]) / subtotal) - Math.round(full * before / subtotal) : (index === lines.length - 1 ? full : 0);
    return Math.round(allocation * Math.min(quantity, line.qty) / line.qty);
}
