/** Open a modal and return focus to its invoker after the dialog closes. */
export function openModalWithFocusReturn(dialog, invoker) {
  if (typeof dialog?.showModal !== "function") throw new Error("Accessible modal requires a dialog");
  dialog.showModal();
  const focusable = dialog.querySelector?.("input:not([disabled]), select:not([disabled]), button:not([disabled])");
  focusable?.focus?.();
  dialog.addEventListener?.("close", () => invoker?.focus?.(), { once: true });
}
