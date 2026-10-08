/** jsdom has no showModal or close on `<dialog>`; these stand in for the browser's, which only toggle `open`. */
export function standInForDialogs(): void {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
}
