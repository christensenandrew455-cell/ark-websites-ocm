import ReviewClients from "../components/ReviewClients";

export default function ReviewMyClientsPage() {
  return (
    <div className="review-clients-shell">
      <style>{`.review-clients-shell > main > div > nav:first-child { display: none; }`}</style>
      <ReviewClients />
    </div>
  );
}
