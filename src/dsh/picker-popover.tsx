import { useText } from './i18n.js';
import React, { useLayoutEffect, useRef } from 'react';

/** Native top-layer popover keeps the composer's theme without ancestor clipping. */
export function PickerPopover({ anchor, onDismiss, children }: { anchor: React.RefObject<HTMLButtonElement | null>; onDismiss: (restoreFocus?: boolean) => void; children: React.ReactNode }) {
 const t=useText();
  const panel = useRef<HTMLElement>(null);
  const dismiss = useRef(onDismiss); dismiss.current = onDismiss;
  useLayoutEffect(() => {
    const element = panel.current; const button = anchor.current;
    if (!element || !button) return;
    const view = element.ownerDocument.defaultView!;
    const viewport = view.visualViewport;
    const position = () => {
      const rect = button.getBoundingClientRect();
      const leftEdge = viewport?.offsetLeft ?? 0; const topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? view.innerWidth; const height = viewport?.height ?? view.innerHeight;
      const margin = 12; const gap = 8;
      const top = topEdge + margin; const bottom = topEdge + height - margin;
      const anchorTop = Math.max(top, Math.min(bottom, rect.top));
      const anchorBottom = Math.max(top, Math.min(bottom, rect.bottom));
      const above = Math.max(0, anchorTop - top - gap); const below = Math.max(0, bottom - anchorBottom - gap);
      const upwards = above >= below;
      const panelWidth = Math.max(0, Math.min(432, width - 2 * margin));
      element.style.width = `${panelWidth}px`;
      element.style.left = `${Math.max(leftEdge + margin, Math.min(rect.left, leftEdge + width - margin - panelWidth))}px`;
      const available = upwards ? above : below;
      const useViewport = available < Math.min(360, height - 2 * margin);
      const panelHeight = Math.max(0, Math.min(560, useViewport ? height - 2 * margin : available));
      // A definite height bounds percentage-sized details; a cramped composer
      // must not reserve half the viewport at the expense of sending controls.
      element.style.height = element.style.maxHeight = `${panelHeight}px`;
      element.style.top = useViewport ? `${top}px` : upwards ? 'auto' : `${anchorBottom + gap}px`;
      element.style.bottom = useViewport ? 'auto' : upwards ? `${view.innerHeight - anchorTop + gap}px` : 'auto';
    };
    position();
    // The current dsh Web browser exposes this standard API. Fixed positioning
    // remains usable in DOM fixtures/older browsers without the top-layer API.
    element.showPopover?.();
    element.querySelector<HTMLButtonElement>('.amoji-picker-head .icon-button')?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      const path = event.composedPath();
      if (!path.includes(element) && !path.includes(button)) dismiss.current(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss.current(true); }
    };
    element.ownerDocument.addEventListener('pointerdown', outside, true);
    element.ownerDocument.addEventListener('click', outside, true);
    element.ownerDocument.addEventListener('focusin', outside, true);
    element.ownerDocument.addEventListener('keydown', escape, true);
    view.addEventListener('resize', position); view.addEventListener('scroll', position, true);
    viewport?.addEventListener('resize', position); viewport?.addEventListener('scroll', position);
    const observer = view.ResizeObserver ? new view.ResizeObserver(position) : undefined; observer?.observe(button);
    return () => {
      element.ownerDocument.removeEventListener('pointerdown', outside, true);
      element.ownerDocument.removeEventListener('click', outside, true);
      element.ownerDocument.removeEventListener('focusin', outside, true);
      element.ownerDocument.removeEventListener('keydown', escape, true);
      observer?.disconnect(); view.removeEventListener('resize', position); view.removeEventListener('scroll', position, true);
      viewport?.removeEventListener('resize', position); viewport?.removeEventListener('scroll', position);
      element.hidePopover?.();
    };
  }, [anchor]);
  return <section ref={panel} popover="manual" role="dialog" aria-label={t("Amoji 表情选择")} className="amoji-picker" style={{ position: 'fixed', inset: 'auto', margin: 0, zIndex: 30, boxSizing: 'border-box', overflow: 'hidden' }}>{children}</section>;
}
