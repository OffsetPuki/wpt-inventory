import {L,useLanguage} from '@/lib/language';
import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';

export default function CustomerFields({ customer = {}, onChange, compact = false }) {
  const {t}=useLanguage();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const listId = useId();
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const { data: clients = [], isFetching, error } = useQuery({
    queryKey: ['quote-customers', query],
    queryFn: async () => (await apiRequest('GET', `/api/crm/clients?q=${encodeURIComponent(query)}&limit=12`)).json(),
    enabled: query.length > 0,
  });
  const pick = (client) => {
    onChange('clientId', client.id);
    for (const key of ['name', 'company', 'phone', 'email']) onChange(key, client[key] || '');
    onChange('preferredLanguage', client.preferredLanguage || 'en');
    onChange('location', client.address || '');
    setSearch(''); setQuery('');
  };
  const field = (key, label, props = {}) => <label className="field"><span><L>{label}</L></span>
    <input value={customer[key] || ''} onChange={e => onChange(key, e.target.value)} {...props} /></label>;
  return <div className="customer-fields">
    <label className="field"><span><L>{"Find customer"}</L></span>
      <input type="search" value={search} placeholder={t("Name, company, phone or email")} autoComplete="off"
        aria-controls={search ? listId : undefined} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); setQuery(''); } }} />
    </label>
    {search && <div className="customer-results" id={listId}>
      {isFetching || search.trim() !== query ? <p role="status" className="hint"><L>{"Searching…"}</L></p>
        : error ? <p role="alert" className="field-error"><L>{"Search unavailable. Enter the customer below."}</L></p>
          : clients.length ? clients.map(c => <button key={c.id} type="button" onClick={() => pick(c)}><strong>{c.name}</strong><span>{[c.company,c.phone,c.email].filter(Boolean).join(' · ')}</span></button>)
            : <p className="hint"><L>{"No match. Enter a new customer below."}</L></p>}
      {clients.length === 12 && <p className="hint"><L>{"Showing 12 matches. Keep typing to narrow the search."}</L></p>}
    </div>}
    {customer.clientId && <p className="hint"><L>{"Linked customer"}</L>{" "}<button type="button" className="back-link" onClick={() => onChange('clientId', null)}><L>{"Use as a new customer"}</L></button></p>}
    <div className="fields two">
      {field('name', 'Customer name', { autoComplete: 'name' })}
      {field('company', 'Company (optional)', { autoComplete: 'organization' })}
      {!compact && <>{field('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}{field('email', 'Email', { type: 'email', autoComplete: 'email' })}</>}
    </div>
    {!compact && <div className="fields two"><label className="field"><span><L>{"Customer language"}</L></span><select aria-label={t("Customer language")} value={customer.preferredLanguage || 'en'} onChange={e => onChange('preferredLanguage', e.target.value)}><option value="en">English</option><option value="es">Español</option></select></label>
      {field('location', 'Project location')}</div>}
  </div>;
}
