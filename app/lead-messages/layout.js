export default function LeadMessagesLayout({ children }) {
  return (
    <div className="messages-simple">
      <style>{`
        .messages-simple main > div > div:first-child > button:first-child,
        .messages-simple main > div > button:first-child {
          width: 3rem;
          height: 3rem;
          padding: 0;
          display: grid;
          place-items: center;
          font-size: 0 !important;
        }
        .messages-simple main > div > div:first-child > button:first-child::before,
        .messages-simple main > div > button:first-child::before {
          content: "←";
          font-size: 1.5rem;
          line-height: 1;
        }
        .messages-simple main > div > header > p:first-child { display: none; }
        .messages-simple main > div > header > div > p {
          border: 1px solid #cbd5e1;
          border-radius: .75rem;
          background: #f8fafc;
          padding: .6rem .8rem;
        }
        .messages-simple main > div > section.rounded-3xl { display: none; }
      `}</style>
      {children}
    </div>
  );
}
