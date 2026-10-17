import {useEffect, useRef, type ReactNode} from 'react';
import {LoaderCircle, X} from 'lucide-react';

export default function Dialog({title, onClose, busy = false, status, children}: {title: string; onClose: () => void; busy?: boolean; status?: string; children: ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    return () => {dialog.close(); document.body.style.overflow = overflow; previous?.focus();};
  }, []);
  return <dialog ref={ref} className="app-dialog" aria-labelledby="dialog-title" onCancel={event => {event.preventDefault(); if (!busy) onClose();}} onClick={event => {if (event.target === event.currentTarget && !busy) onClose();}}>
    <div className="dialog-content"><div className="dialog-header"><h2 id="dialog-title">{title}</h2><button className="icon-button" aria-label="关闭弹窗" disabled={busy} onClick={onClose}><X size={19}/></button></div>{(busy || status) && <div className="dialog-status" role="status">{busy && <LoaderCircle size={15} className="spin"/>}<span>{busy ? '等待钱包签名与链上确认…' : status}</span></div>}{children}</div>
  </dialog>;
}
