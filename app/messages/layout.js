"use client";

import BackButton from "../components/BackButton";

export default function MessagesLayout({ children }) {
  return (
    <>
      <div className="bg-transparent px-3 pt-3 sm:px-6 md:px-8">
        <div className="mx-auto max-w-3xl">
          <BackButton href="/settings" label="Back to Settings" />
        </div>
      </div>
      {children}
    </>
  );
}
