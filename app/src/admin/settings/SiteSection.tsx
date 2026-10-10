/** `settings.coming_soon_global`: while it is on, every public page shows the coming-soon signup instead. */
export function SiteSection({
  comingSoon,
  pending,
  onChange,
}: {
  comingSoon: boolean;
  pending: boolean;
  onChange: (comingSoon: boolean) => void;
}) {
  return (
    <div className="admin-fields">
      <p>
        {comingSoon
          ? "The whole site shows the coming-soon page. Properties and stories stay hidden."
          : "The site is open. Markets that are still coming soon keep their own signup page."}
      </p>
      <button
        type="button"
        className={comingSoon ? "admin-button" : "admin-button admin-button--danger"}
        disabled={pending}
        onClick={() => {
          onChange(!comingSoon);
        }}
      >
        {comingSoon ? "Open the site" : "Show the coming-soon page"}
      </button>
    </div>
  );
}
