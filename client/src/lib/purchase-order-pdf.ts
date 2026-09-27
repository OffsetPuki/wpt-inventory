import { ORDER_LABELS } from '@shared/purchase-orders';
import { businessShop } from '@shared/business.js';
export async function downloadOrderPdf(order: any, shop: any = {}) {
    const [{ default: pdfMake }, { default: fonts }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
    pdfMake.addVirtualFileSystem(fonts);
    const d = typeof order.details === 'string' ? JSON.parse(order.details) : order.details || {};
    shop = businessShop(shop, d.business || 'metals');
    const quote = typeof order.quoteSnapshot === 'string' ? JSON.parse(order.quoteSnapshot) : order.quoteSnapshot;
    const items = typeof order.items === 'string' ? JSON.parse(order.items) : order.items;
    const money = (v: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((v || 0) / 100);
    const names: any = { metals: 'CJM Metals', concrete: 'CJM Concrete', insulation: 'CJM Insulation', trades: 'CJM Trades' };
    const supplier = order.orderType === 'supplier';
    const business = shop.name || names[d.business] || 'CJM';
    const content: any[] = [
        { text: business, style: 'brand' },
        { text: [shop.location, shop.phone, shop.email].filter(Boolean).join(' | '), style: 'muted' },
        { text: supplier ? 'Supplier purchase order' : 'Customer purchase order record', style: 'title' },
        { text: `${order.number} | Revision ${order.revision || 1} | ${ORDER_LABELS[order.status as keyof typeof ORDER_LABELS] || order.status}`, bold: true, margin: [0, 0, 0, 12] },
        { columns: [{ text: `${supplier ? 'Supplier' : 'Customer'}\n${supplier ? order.vendor : order.customerName}\n${[d.contactName, d.email, d.phone, d.billingAddress].filter(Boolean).join('\n')}` }, { text: `Customer project: ${order.customerProjectNumber || 'Not specified'}\nCustomer PO number: ${order.customerPoNumber || 'Pending'}\nQuote: ${quote?.number || 'Not linked'}\nExpected delivery: ${order.expectedDate || 'To be confirmed'}` }], columnGap: 20, margin: [0, 0, 0, 18] },
    ];
    if (order.status === 'draft' || order.status === 'review')
        content.push({ text: 'DRAFT - FOR REVIEW', bold: true, color: '#9a5400', margin: [0, 0, 0, 10] });
    for (const [key, label] of [['scope', 'Scope'], ['specifications', 'Specifications'], ['finish', 'Finish'], ['customerMaterials', 'Customer-supplied materials'], ['exclusions', 'Exclusions']])
        if (d[key])
            content.push({ text: label, style: 'heading' }, { text: d[key], margin: [0, 0, 0, 9] });
    content.push({ table: { headerRows: 1, widths: ['*', 40, 42, 70, 76], body: [['Description', 'Qty', 'Unit', 'Unit price', 'Amount'].map(text => ({ text, bold: true, fillColor: '#edf0eb' })), ...items.map((i: any) => [i.description, String(i.qty), i.unit || 'each', money(i.unitPriceCents), money(Math.round(i.qty * i.unitPriceCents))])] }, layout: 'lightHorizontalLines', margin: [0, 8, 0, 12] });
    for (const [label, cents] of [['Subtotal', order.revision > 0 ? order.subtotalCents : items.reduce((sum: number, i: any) => sum + Math.round(i.qty * i.unitPriceCents), 0)], ['Discount', -order.discountCents], ['Freight / delivery', order.shippingCents], ['Tax', order.taxCents], ['TOTAL (USD)', order.totalCents], ['Deposit', order.depositCents], ['Balance after deposit', order.totalCents - order.depositCents]])
        content.push({ columns: [{ text: label, bold: label === 'TOTAL (USD)' }, { text: money(cents as number), alignment: 'right', bold: label === 'TOTAL (USD)' }], margin: [200, 3, 0, 3] });
    for (const [label, value] of [['Payment terms', d.paymentTerms], ['Delivery', `${d.deliveryIncluded ? 'Delivery included. ' : ''}${d.deliveryTerms || ''}`], ['Ship to', d.deliveryAddress], ['Notes', order.notes]])
        if (value)
            content.push({ text: label, style: 'heading' }, { text: value, margin: [0, 0, 0, 8] });
    if (!supplier)
        content.push({ text: 'Prepared by CJM from the customer order information. This record does not issue a purchase order on the customer\'s behalf. The original customer PO governs its assigned number and authorization.', style: 'muted', margin: [0, 14, 0, 0] });
    const definition = { pageSize: 'LETTER', pageMargins: [40, 38, 40, 42], defaultStyle: { font: 'Roboto', fontSize: 9, color: '#26383c' }, styles: { brand: { fontSize: 19, bold: true, color: '#2d484d' }, title: { fontSize: 23, bold: true, margin: [0, 18, 0, 12] }, heading: { fontSize: 10, bold: true, margin: [0, 8, 0, 4] }, muted: { fontSize: 8, color: '#647572' } }, content, footer: (p: number, n: number) => ({ text: `${order.number} | Rev ${order.revision || 1}                                      ${p} / ${n}`, alignment: 'center', fontSize: 8, color: '#647572' }) };
    pdfMake.createPdf(definition).download(`${order.number}-rev-${order.revision || 1}.pdf`);
}
