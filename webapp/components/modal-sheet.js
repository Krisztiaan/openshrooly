import { h } from "../vendor/preact.module.js";
import { useEffect, useRef } from "../vendor/hooks.module.js";
import htm from "../vendor/htm.module.js";

const html = htm.bind(h);

export function ModalSheet({
  open,
  title,
  labelledBy,
  onClose,
  dismissible = true,
  children,
  footer,
}) {
  const dialogRef = useRef(null);
  const closingByPropRef = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const container = dialog.querySelector(".sheet-modal__container");
    if (!container) return;

    const handleCancel = (event) => {
      event.preventDefault();
      if (!dismissible) return;
      onClose?.();
    };

    const handleClose = () => {
      dialog.dataset.state = "";
      if (closingByPropRef.current) {
        closingByPropRef.current = false;
        return;
      }
      if (dismissible) {
        onClose?.();
      }
    };

    const handleOpeningEnd = (event) => {
      if (event.target !== container) return;
      container.removeEventListener("animationend", handleOpeningEnd);
      dialog.dataset.state = "open";
    };

    const handleClosingEnd = (event) => {
      if (event.target !== container) return;
      container.removeEventListener("animationend", handleClosingEnd);
      closingByPropRef.current = true;
      dialog.dataset.state = "";
      if (dialog.open) dialog.close();
    };

    const removeAnimations = () => {
      container.removeEventListener("animationend", handleOpeningEnd);
      container.removeEventListener("animationend", handleClosingEnd);
    };

    dialog.addEventListener("cancel", handleCancel);
    dialog.addEventListener("close", handleClose);

    if (open) {
      removeAnimations();
      if (typeof dialog.showModal === "function") {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute("open", "");
      }
      if (dialog.dataset.state !== "open") {
        dialog.dataset.state = "opening";
        container.addEventListener("animationend", handleOpeningEnd);
      }
    } else if (dialog.open) {
      removeAnimations();
      if (dialog.dataset.state !== "closing") {
        dialog.dataset.state = "closing";
        container.addEventListener("animationend", handleClosingEnd);
      }
    } else {
      dialog.dataset.state = "";
      dialog.removeAttribute("open");
    }

    return () => {
      removeAnimations();
      dialog.removeEventListener("cancel", handleCancel);
      dialog.removeEventListener("close", handleClose);
      if (dialog.open) {
        closingByPropRef.current = true;
        dialog.close();
      }
      closingByPropRef.current = false;
    };
  }, [open, dismissible, onClose]);

  const handleDialogClick = (event) => {
    if (!dismissible) return;
    if (event.target === dialogRef.current) {
      onClose?.();
    }
  };

  const headingId =
    labelledBy ||
    (title
      ? `${title
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")}-sheet`
      : undefined);

  return html`
    <dialog
      ref=${dialogRef}
      className="sheet-modal"
      aria-modal="true"
      aria-labelledby=${headingId}
      onClick=${handleDialogClick}
    >
      <div
        className="sheet-modal__container"
        onClick=${(event) => event.stopPropagation()}
      >
        ${dismissible
          ? html`<button
              className="sheet-modal__close"
              aria-label="Close"
              type="button"
              onClick=${() => onClose?.()}
            ></button>`
          : null}
        <div className="sheet-modal__content">
          ${title
            ? html`<header className="sheet-modal__header">
                <h2 id=${headingId}>${title}</h2>
              </header>`
            : null}
          <div className="sheet-modal__body">${children}</div>
          ${footer ? html`<footer className="sheet-modal__footer">${footer}</footer>` : null}
        </div>
      </div>
    </dialog>
  `;
}
