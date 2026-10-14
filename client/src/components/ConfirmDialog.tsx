import type { ReactNode } from 'react';
import Modal from './Modal';
import {useLanguage} from '@/lib/language';
import { primaryBtn, secondaryBtn } from '@/lib/ui-styles';

export default function ConfirmDialog({ title, children, confirmLabel, busy = false, disabled = false, error, onConfirm, onClose }: {
  title: string; children: ReactNode; confirmLabel: string; busy?: boolean; disabled?: boolean;
  error?: string; onConfirm: () => void; onClose: () => void;
}) {
  const {t}=useLanguage();
  return <Modal open busy={busy} title={title} onClose={() => { if (!busy) onClose(); }} focusDialog hasUnsavedChanges={false}
    footer={<div className="flex justify-end gap-2"><button type="button" className={secondaryBtn} disabled={busy} onClick={onClose}>{t('Cancel')}</button><button type="button" className={primaryBtn} disabled={busy||disabled} onClick={onConfirm}>{busy ? t('Please wait…') : confirmLabel}</button></div>}>
    <div className="space-y-3 text-sm leading-relaxed">{children}{error && <p role="alert" className="text-destructive">{error}</p>}</div>
  </Modal>;
}
