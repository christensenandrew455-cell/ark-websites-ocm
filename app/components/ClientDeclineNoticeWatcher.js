"use client";

import { collection, onSnapshot } from "firebase/firestore";
import { useEffect } from "react";
import { useAuth } from "./AuthProvider";
import { db } from "../lib/firebase";

function text(value) { return String(value || "").trim(); }

export default function ClientDeclineNoticeWatcher() {
  const { user, profile, isEmployee, isAdmin } = useAuth();
  const clientId = text(profile?.clientId);

  useEffect(() => {
    if (!user || !clientId || isEmployee || isAdmin) return undefined;
    let active = true;
    let initialized = false;

    const unsubscribe = onSnapshot(
      collection(db, "ocmClients", clientId, "contactedMe"),
      (snapshot) => {
        if (!initialized) {
          initialized = true;
          return;
        }
        const removed = snapshot.docChanges().filter((change) => change.type === "removed");
        removed.forEach((change) => {
          const lead = change.doc.data() || {};
          user.getIdToken(true)
            .then((token) => fetch("/api/business/leads/client-decline-notice", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                leadId: change.doc.id,
                name: text(lead.Name || lead.name || lead.fullName),
                phone: text(lead.Phone || lead.phone || lead.phoneNumber || lead.contact),
              }),
            }))
            .then(async (response) => {
              if (response.ok || !active) return;
              const data = await response.json().catch(() => ({}));
              console.warn("Client decline notice was not sent", data.error || response.status);
            })
            .catch((error) => {
              if (active) console.warn("Client decline notice was not sent", error);
            });
        });
      },
      (error) => console.warn("Unable to watch contacted leads for decline notices", error),
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [clientId, isAdmin, isEmployee, user]);

  return null;
}
