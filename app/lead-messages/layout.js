export default function LeadMessagesLayout({ children }) {
  return (
    <div className="messages-balanced">
      <style>{`
        .messages-balanced main > div > header {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          align-items: end;
          gap: .75rem;
        }
        .messages-balanced main > div > header > h1 {
          grid-column: 1;
          grid-row: 1;
        }
        .messages-balanced main > div > header > p {
          display: none;
        }
        .messages-balanced main > div > header > div {
          grid-column: 2;
          grid-row: 1;
          justify-self: end;
          margin-top: 0 !important;
          padding: .7rem .9rem !important;
          font-size: .75rem !important;
        }
        @media (max-width: 420px) {
          .messages-balanced main > div > header > div {
            gap: .45rem !important;
            padding: .65rem .75rem !important;
          }
        }
      `}</style>
      {children}
    </div>
  );
}
